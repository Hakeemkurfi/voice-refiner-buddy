import { createFileRoute } from "@tanstack/react-router";

// Simplest possible bridge: send a photo and/or a question, get Gemini's plain
// text answer back. No speech, no JSON schema, no key on the device.
//
//   POST /api/public/ask
//     Content-Type: image/jpeg        -> raw JPEG bytes (optional ?q=your question)
//     Content-Type: text/plain        -> just a question
//     Content-Type: application/json  -> { "prompt": "...", "image_b64": "...", "model": "flash|pro" }
//
//   Response: plain text answer (add ?format=json for { "answer": "..." })

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_BYTES = 8 * 1024 * 1024;

const MODELS: Record<string, string[]> = {
  flash: [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.5-flash-lite",
    "gemini-1.5-flash",
  ],
  pro: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
};

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function askGemini(
  apiKey: string,
  prompt: string,
  imageB64: string | undefined,
  tier: "flash" | "pro",
): Promise<string> {
  const parts: unknown[] = [{ text: prompt }];
  if (imageB64) parts.push({ inlineData: { mimeType: "image/jpeg", data: imageB64 } });

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
  };

  let lastError = "Gemini request failed.";
  for (const model of MODELS[tier]) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify(body),
      },
    ).catch((error) => {
      lastError = `${model}: ${(error as Error).message}`;
      return null;
    });
    if (!res) continue;

    if (!res.ok) {
      const text = await res.text();
      lastError = `${model} HTTP ${res.status}: ${text.slice(0, 200)}`;
      if ([429, 500, 503].includes(res.status) || text.toLowerCase().includes("not found")) continue;
      throw new Error(lastError);
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const answer =
      json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("\n").trim() ?? "";
    if (answer) return answer;
    lastError = `${model} returned an empty answer.`;
  }
  throw new Error(lastError);
}

export const Route = createFileRoute("/api/public/ask")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      GET: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            usage:
              "POST a JPEG (image/jpeg), plain text question (text/plain), or JSON {prompt, image_b64, model}. Returns plain text; add ?format=json for {answer}.",
            models: ["flash", "pro"],
          }),
          { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
        ),

      POST: async ({ request }) => {
        const url = new URL(request.url);
        const asJson = url.searchParams.get("format") === "json";
        const respond = (text: string, status = 200) =>
          asJson
            ? new Response(JSON.stringify(status === 200 ? { answer: text } : { error: text }), {
                status,
                headers: { "Content-Type": "application/json", ...CORS },
              })
            : new Response(text, {
                status,
                headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS },
              });

        try {
          const apiKey = process.env["GEMINI_API_KEY"];
          if (!apiKey) return respond("Server has no GEMINI_API_KEY configured.", 500);

          const contentType = request.headers.get("content-type") ?? "";
          let prompt = url.searchParams.get("q") ?? "";
          let imageB64: string | undefined;
          let tier: "flash" | "pro" = url.searchParams.get("model") === "pro" ? "pro" : "flash";

          if (contentType.includes("application/json")) {
            const body = (await request.json().catch(() => ({}))) as {
              prompt?: string;
              image_b64?: string;
              model?: string;
            };
            prompt = body.prompt?.slice(0, 20000) || prompt;
            if (body.image_b64) {
              imageB64 = body.image_b64.replace(/^data:image\/\w+;base64,/, "");
            }
            if (body.model === "pro") tier = "pro";
          } else if (contentType.startsWith("image/")) {
            const buf = new Uint8Array(await request.arrayBuffer());
            if (buf.byteLength > MAX_BYTES) return respond("Image too large (max 8 MB).", 413);
            imageB64 = toBase64(buf);
          } else {
            const text = await request.text();
            if (text.trim()) prompt = text.slice(0, 20000);
          }

          if (!imageB64 && !prompt.trim()) {
            return respond("Send a question, an image, or both.", 400);
          }

          if (!prompt.trim()) {
            prompt =
              "Read this page and answer or solve it. Reply in clear plain text only: the answer first, then short steps. No markdown, no LaTeX.";
          }

          const answer = await askGemini(apiKey, prompt, imageB64, tier);
          return respond(answer);
        } catch (e) {
          return respond((e as Error).message, 502);
        }
      },
    },
  },
});
