import { createFileRoute } from "@tanstack/react-router";
import { analyzeImage } from "@/lib/analyze.functions";

// Public "solve a page" endpoint for external hardware (Raspberry Pi Zero 2 W,
// ESP32, phone scripts). The AI key stays on the server — the device only
// needs this URL.
//
//   POST /api/public/solve
//     Content-Type: image/jpeg          -> raw JPEG bytes
//     Content-Type: application/json    -> { "image_b64": "...", "model": "auto" }
//
// Response JSON: { title, summary, steps[], extractedText, confidence, modelUsed }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const JSON_HEADERS = { "Content-Type": "application/json", ...CORS };
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB image cap

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export const Route = createFileRoute("/api/public/solve")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      GET: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            usage: "POST a JPEG (Content-Type: image/jpeg) or JSON {image_b64} to this URL.",
            models: ["auto", "flash", "pro", "deepseek"],
          }),
          { status: 200, headers: JSON_HEADERS },
        ),

      POST: async ({ request }) => {
        try {
          const contentType = request.headers.get("content-type") ?? "";
          let image_b64 = "";
          let contextText: string | undefined;
          let model: "auto" | "flash" | "pro" | "deepseek" = "deepseek";
          let course: string | undefined;
          let question: string | undefined;

          if (contentType.includes("application/json")) {
            const body = (await request.json().catch(() => ({}))) as {
              image_b64?: string;
              contextText?: string;
              model?: string;
              course?: string;
              question?: string;
            };
            image_b64 = (body.image_b64 ?? "").replace(/^data:image\/\w+;base64,/, "");
            contextText = body.contextText?.slice(0, 12000);
            course = body.course?.slice(0, 120);
            question = body.question?.slice(0, 2000);
            if (body.model === "flash" || body.model === "pro" || body.model === "deepseek") {
              model = body.model;
            }
          } else {
            const buf = new Uint8Array(await request.arrayBuffer());
            if (buf.byteLength > MAX_BYTES) {
              return new Response(
                JSON.stringify({ error: "Image too large (max 8 MB)" }),
                { status: 413, headers: JSON_HEADERS },
              );
            }
            image_b64 = toBase64(buf);
            const url = new URL(request.url);
            const q = url.searchParams.get("model");
            if (q === "flash" || q === "pro" || q === "deepseek" || q === "auto") model = q;
            course = url.searchParams.get("course") ?? undefined;
            question = url.searchParams.get("q") ?? undefined;
          }

          if (image_b64.length < 100) {
            return new Response(
              JSON.stringify({ error: "No image received. Send JPEG bytes or image_b64." }),
              { status: 400, headers: JSON_HEADERS },
            );
          }

          const result = await analyzeImage({ data: { image_b64, contextText, model, course, question } });
          return new Response(JSON.stringify(result), { status: 200, headers: JSON_HEADERS });
        } catch (e) {
          return new Response(
            JSON.stringify({ error: (e as Error).message }),
            { status: 500, headers: JSON_HEADERS },
          );
        }
      },
    },
  },
});
