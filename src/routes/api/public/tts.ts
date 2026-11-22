import { createFileRoute } from "@tanstack/react-router";
import { createHash, createHmac } from "crypto";
import { SILENCE_B64 } from "@/lib/voice-silence";

// Server-side TTS proxy.
// Priority:
//   1. Tencent Cloud TTS (your own account, no Lovable credits).
//   2. OpenAI TTS with your own OPENAI_API_KEY.
//   3. Lovable AI Gateway (last resort; can consume Lovable credits).
// Returns audio/mpeg bytes so the Pi / browser can play through a real
// HTMLAudioElement — the only way audio keeps playing when the screen locks.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const TENCENT_HOST = "tts.tencentcloudapi.com";
const TENCENT_SERVICE = "tts";
const TENCENT_VERSION = "2019-08-23";
const TENCENT_REGION = process.env.TENCENT_REGION || "ap-guangzhou";

function sha256Hex(input: string | Buffer) {
  return createHash("sha256").update(input).digest("hex");
}

function hmacSha256(key: string | Buffer, msg: string | Buffer): Buffer {
  return createHmac("sha256", key).update(msg).digest();
}

function signTencentRequest(
  secretId: string,
  secretKey: string,
  payload: string,
  timestamp: number,
  date: string,
) {
  const method = "POST";
  const canonicalUri = "/";
  const canonicalQueryString = "";
  const canonicalHeaders = `content-type:application/json\nhost:${TENCENT_HOST}\n`;
  const signedHeaders = "content-type;host";
  const hashedPayload = sha256Hex(payload);

  const canonicalRequest =
    `${method}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;

  const credentialScope = `${date}/${TENCENT_SERVICE}/tc3_request`;
  const stringToSign =
    `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

  const secretDate = hmacSha256("TC3" + secretKey, date);
  const secretService = hmacSha256(secretDate, TENCENT_SERVICE);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = hmacSha256(secretSigning, stringToSign).toString("hex");

  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function tencentVoiceType(voice?: string | number): number {
  if (typeof voice === "number") return voice;
  const known: Record<string, number> = {
    sage: 1001,
    alloy: 1002,
    echo: 1002,
    fable: 1004,
    onyx: 1002,
    nova: 1003,
    shimmer: 1003,
  };
  return known[voice ?? ""] ?? 1001; // 1001 = clear English female
}

// Classroom dictation slowdown: answers are spoken this much slower than a
// client asks for, so every written step can be copied down. One knob for all
// three voice providers; the Pi's own AXON_SPEED setting sits on top of it.
const DICTATION_SLOWDOWN = 0.25;

function requestedSpeed(speed?: number): number {
  const s = Number(speed) || 0.9;
  return Math.min(1.5, Math.max(0.5, s - DICTATION_SLOWDOWN));
}

function openaiToTencentSpeed(speed?: number): number {
  // OpenAI speed is 0.5–1.5; Tencent Speed is -2 to 2.
  const s = requestedSpeed(speed);
  return Math.round(Math.min(2, Math.max(-2, (s - 1) * 4)) * 10) / 10;
}

async function tencentTts(text: string, voice: string | number | undefined, speed: number) {
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  if (!secretId || !secretKey) {
    return { ok: false, status: 500, fallback: "local", hint: "Tencent credentials not configured" } as const;
  }

  const sessionId = `axon-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const payload = JSON.stringify({
    Text: text,
    SessionId: sessionId,
    ModelType: 1,
    VoiceType: tencentVoiceType(voice),
    Volume: 0,
    Speed: openaiToTencentSpeed(speed),
    Codec: "mp3",
    SampleRate: 16000,
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const authorization = signTencentRequest(secretId, secretKey, payload, timestamp, date);

  const res = await fetch(`https://${TENCENT_HOST}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: TENCENT_HOST,
      "X-TC-Action": "TextToVoice",
      "X-TC-Version": TENCENT_VERSION,
      "X-TC-Region": TENCENT_REGION,
      "X-TC-Timestamp": String(timestamp),
      Authorization: authorization,
    },
    body: payload,
  });

  const txt = await res.text().catch(() => "");
  let json: { Response?: { Audio?: string; Error?: { Code?: string; Message?: string } } } = {};
  try {
    json = JSON.parse(txt);
  } catch {
    // non-JSON error
  }

  if (!res.ok || json.Response?.Error) {
    const code = json.Response?.Error?.Code ?? `HTTP ${res.status}`;
    const msg = json.Response?.Error?.Message ?? txt.slice(0, 200);
    return {
      ok: false,
      status: res.ok ? 500 : res.status,
      fallback: "local",
      hint: `Tencent TTS error: ${code} — ${msg}`,
    } as const;
  }

  const audioB64 = json.Response?.Audio;
  if (!audioB64) {
    return { ok: false, status: 500, fallback: "local", hint: "Tencent returned no audio" } as const;
  }

  return { ok: true, audio: Buffer.from(audioB64, "base64") } as const;
}

async function openaiTts(text: string, voice: string, speed: number) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, status: 500, fallback: "local", hint: "OpenAI key not configured" } as const;

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      input: text,
      voice: voice ?? "sage",
      speed: requestedSpeed(speed),
      response_format: "mp3",
      instructions:
        "Speak as a calm, patient tutor dictating math step by step on the phone. " +
        "Pause slightly between clauses. Keep a warm conversational tone. " +
        "Pronounce every math word fully so the listener can write it down.",
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      fallback: "local",
      hint: res.status === 402 ? "OpenAI voice unavailable (no credit). Use the device voice." : undefined,
      detail: txt.slice(0, 300),
    } as const;
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: true, audio: buf } as const;
}

async function gatewayTts(text: string, voice: string, speed: number) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) {
    return { ok: false, status: 500, fallback: "local", hint: "No TTS credentials configured" } as const;
  }

  const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini-tts",
      input: text,
      voice: voice ?? "sage",
      speed: requestedSpeed(speed),
      response_format: "mp3",
      stream_format: "audio",
      instructions:
        "Speak as a calm, patient tutor dictating math step by step on the phone. " +
        "Pause slightly between clauses. Keep a warm conversational tone. " +
        "Pronounce every math word fully so the listener can write it down.",
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      fallback: "local",
      hint: res.status === 402 ? "Hosted voice unavailable (no credit). Use the device voice." : undefined,
      detail: txt.slice(0, 300),
    } as const;
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: true, audio: buf } as const;
}

// Long inputs make the voice models drop words ("skipping"). Every request is
// split into short pieces (one dictation line or sentence each), each piece is
// voiced on its own, and the MP3 pieces are joined back in order.
const PIECE_MAX = 260;
export function splitForVoice(text: string): string[] {
  const parts = text
    .replace(/\s*\n+\s*/g, "\n")
    .split(/(?<=[.!?])\s+|\n|(?<!Repeat |Repeat draw |draw )(?=\b(?:Repeat )?(?:draw )?line [a-z-]+:)/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    let rest = part;
    while (rest.length > PIECE_MAX) {
      const cut = Math.max(rest.lastIndexOf(", ", PIECE_MAX), rest.lastIndexOf(" equals ", PIECE_MAX));
      const at = cut > 80 ? cut + 1 : rest.lastIndexOf(" ", PIECE_MAX);
      out.push(rest.slice(0, at > 0 ? at : PIECE_MAX).trim());
      rest = rest.slice(at > 0 ? at : PIECE_MAX).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

type Voiced = { ok: true; audio: Buffer } | { ok: false };

async function voicePieces(
  pieces: string[],
  one: (t: string) => Promise<Voiced>,
): Promise<Buffer | null> {
  const results: (Buffer | null)[] = new Array(pieces.length).fill(null);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < pieces.length) {
      const i = next++;
      let r = await one(pieces[i]!);
      if (!r.ok) r = await one(pieces[i]!); // one retry per piece
      if (!r.ok) { failed = true; return; }
      results[i] = r.audio;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, pieces.length) }, worker));
  if (failed || results.some((b) => !b)) return null;
  return joinWithPauses(pieces, results as Buffer[]);
}

// Sample rate of the first MPEG audio frame (skips an ID3 tag if present).
export function mp3SampleRate(buf: Uint8Array): number | null {
  let i = 0;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33 && buf.length > 10) {
    i = 10 + (((buf[6]! & 0x7f) << 21) | ((buf[7]! & 0x7f) << 14) | ((buf[8]! & 0x7f) << 7) | (buf[9]! & 0x7f));
  }
  for (; i + 3 < buf.length; i++) {
    if (buf[i] !== 0xff || (buf[i + 1]! & 0xe0) !== 0xe0) continue;
    const ver = (buf[i + 1]! >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const idx = (buf[i + 2]! >> 2) & 3;
    if (ver === 1 || idx === 3) continue;
    const base = [44100, 48000, 32000][idx]!;
    return ver === 3 ? base : ver === 2 ? base / 2 : base / 4;
  }
  return null;
}

// A new dictation line (or its repeat) gets a longer pause before it; every
// other piece gets a short breath so its first syllable is never clipped.
const LINE_START = /^(?:repeat\s+)?(?:draw\s+)?line\b/i;
export function pauseBefore(piece: string, index: number): "short" | "long" {
  return index > 0 && LINE_START.test(piece) ? "long" : "short";
}

export function joinWithPauses(pieces: string[], audio: Buffer[]): Buffer {
  const rate = audio[0] ? mp3SampleRate(audio[0]) : null;
  const sil = rate ? SILENCE_B64[rate] : undefined;
  if (!sil) return Buffer.concat(audio);
  const short = Buffer.from(sil.short, "base64");
  const long = Buffer.from(sil.long, "base64");
  const out: Buffer[] = [];
  // Longer lead-in at the very start: Bluetooth earbuds and audio devices
  // take about a second to wake, which otherwise swallows the first words.
  out.push(long, long);
  audio.forEach((a, i) => {
    if (i > 0) out.push(pauseBefore(pieces[i] ?? "", i) === "long" ? long : short);
    out.push(a);
  });
  out.push(short);
  return Buffer.concat(out);
}

export const Route = createFileRoute("/api/public/tts")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as {
            text?: string;
            voice?: string | number;
            speed?: number;
          };
          const text = (body.text ?? "").toString().slice(0, 20000);
          if (!text.trim()) {
            return new Response(
              JSON.stringify({ error: "text required" }),
              { status: 400, headers: { "Content-Type": "application/json", ...CORS } },
            );
          }

          const pieces = splitForVoice(text);
          const mp3 = (audio: Buffer) =>
            new Response(new Uint8Array(audio), {
              status: 200,
              headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400", ...CORS },
            });

          // 1. Lovable voice first (chosen by the user for exam reliability; uses
          //    Lovable credits). Tencent / own OpenAI stay as backups below.
          let gateway: Awaited<ReturnType<typeof gatewayTts>> | undefined;
          const gAudio = await voicePieces(pieces, async (t) => {
            const r = await gatewayTts(t, String(body.voice ?? "sage"), body.speed ?? 0.85);
            if (!r.ok) gateway = r;
            return r.ok ? { ok: true, audio: r.audio } : { ok: false };
          });
          if (gAudio) return mp3(gAudio);

          // 2. Tencent Cloud backup (your account, no Lovable credits).
          let tencent: Awaited<ReturnType<typeof tencentTts>> | undefined;
          const tAudio = await voicePieces(pieces, async (t) => {
            const r = await tencentTts(t, body.voice, body.speed ?? 0.85);
            if (!r.ok) tencent = r;
            return r.ok ? { ok: true, audio: r.audio } : { ok: false };
          });
          if (tAudio) return mp3(tAudio);

          // 3. Your own OpenAI account backup.
          let openai: Awaited<ReturnType<typeof openaiTts>> | undefined;
          const oAudio = await voicePieces(pieces, async (t) => {
            const r = await openaiTts(t, String(body.voice ?? "sage"), body.speed ?? 0.85);
            if (!r.ok) openai = r;
            return r.ok ? { ok: true, audio: r.audio } : { ok: false };
          });
          if (oAudio) return mp3(oAudio);


          // All failed — tell the client to fall back to its own voice.
          return new Response(
            JSON.stringify({
              error: "All TTS providers failed",
              fallback: "local",
              tencentHint: tencent && "hint" in tencent ? tencent.hint : undefined,
              openaiHint: openai && "hint" in openai ? openai.hint : undefined,
              gatewayHint: gateway && "hint" in gateway ? gateway.hint : undefined,
            }),
            { status: 502, headers: { "Content-Type": "application/json", ...CORS } },
          );
        } catch (e) {
          return new Response(
            JSON.stringify({ error: (e as Error).message, fallback: "local" }),
            { status: 500, headers: { "Content-Type": "application/json", ...CORS } },
          );
        }
      },
    },
  },
});
