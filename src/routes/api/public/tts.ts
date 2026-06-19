import { createFileRoute } from "@tanstack/react-router";

// Server-side TTS proxy using Lovable AI Gateway.
// Returns audio/mpeg (MP3) bytes so the browser can play via a real
// HTMLAudioElement — this is the only way audio keeps playing when
// the phone screen locks / app goes background. SpeechSynthesis
// stops on lock (Safari/iOS) so we cannot rely on it.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/public/tts")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      POST: async ({ request }) => {
        try {
          const key = process.env.LOVABLE_API_KEY;
          if (!key) {
            return new Response(
              JSON.stringify({ error: "Missing LOVABLE_API_KEY" }),
              { status: 500, headers: { "Content-Type": "application/json", ...CORS } },
            );
          }
          const body = (await request.json().catch(() => ({}))) as {
            text?: string;
            voice?: string;
            speed?: number;
          };
          const text = (body.text ?? "").toString().slice(0, 3500);
          if (!text.trim()) {
            return new Response(
              JSON.stringify({ error: "text required" }),
              { status: 400, headers: { "Content-Type": "application/json", ...CORS } },
            );
          }
          const voice = body.voice ?? "sage";
          const speed = Math.min(1.5, Math.max(0.5, Number(body.speed) || 0.9));

          const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "openai/gpt-4o-mini-tts",
              input: text,
              voice,
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
            return new Response(
              JSON.stringify({ error: `TTS ${res.status}`, detail: txt.slice(0, 300) }),
              { status: res.status, headers: { "Content-Type": "application/json", ...CORS } },
            );
          }
          return new Response(res.body, {
            status: 200,
            headers: {
              "Content-Type": "audio/mpeg",
              "Cache-Control": "public, max-age=86400",
              ...CORS,
            },
          });
        } catch (e) {
          return new Response(
            JSON.stringify({ error: (e as Error).message }),
            { status: 500, headers: { "Content-Type": "application/json", ...CORS } },
          );
        }
      },
    },
  },
});
