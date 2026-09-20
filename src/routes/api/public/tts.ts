import { createFileRoute } from "@tanstack/react-router";
import { createHash, createHmac } from "crypto";

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

function openaiToTencentSpeed(speed?: number): number {
  // OpenAI speed is 0.5–1.5; Tencent Speed is -2 to 2.
  const s = Number(speed) || 0.9;
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
      speed,
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
      speed,
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
          const text = (body.text ?? "").toString().slice(0, 3500);
          if (!text.trim()) {
            return new Response(
              JSON.stringify({ error: "text required" }),
              { status: 400, headers: { "Content-Type": "application/json", ...CORS } },
            );
          }

          // 1. Tencent Cloud first (your account, no Lovable credits).
          const tencent = await tencentTts(text, body.voice, body.speed);
          if (tencent.ok) {
            return new Response(tencent.audio, {
              status: 200,
              headers: {
                "Content-Type": "audio/mpeg",
                "Cache-Control": "public, max-age=86400",
                ...CORS,
              },
            });
          }

          // 2. Your own OpenAI account.
          const openai = await openaiTts(text, String(body.voice ?? "sage"), body.speed ?? 0.9);
          if (openai.ok) {
            return new Response(openai.audio, {
              status: 200,
              headers: {
                "Content-Type": "audio/mpeg",
                "Cache-Control": "public, max-age=86400",
                ...CORS,
            },
            });
          }

          // 3. Lovable AI Gateway last resort.
          const gateway = await gatewayTts(text, String(body.voice ?? "sage"), body.speed ?? 0.9);
          if (gateway.ok) {
            return new Response(gateway.audio, {
              status: 200,
              headers: {
                "Content-Type": "audio/mpeg",
                "Cache-Control": "public, max-age=86400",
                ...CORS,
              },
            });
          }

          // All failed — tell the client to fall back to its own voice.
          return new Response(
            JSON.stringify({
              error: "All TTS providers failed",
              fallback: "local",
              tencentHint: typeof tencent === "object" && "hint" in tencent ? tencent.hint : undefined,
              openaiHint: typeof openai === "object" && "hint" in openai ? openai.hint : undefined,
              gatewayHint: typeof gateway === "object" && "hint" in gateway ? gateway.hint : undefined,
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
