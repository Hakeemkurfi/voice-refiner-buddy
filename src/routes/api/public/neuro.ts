import { createFileRoute } from "@tanstack/react-router";

// Axon Dynamics — NeuroTech bridge endpoint.
//   POST /api/public/neuro  { emotion?, intensity?, bulb?, toggle_bulb?, cycle_emotion?, eeg?[] }
//   GET  /api/public/neuro  -> current live brain state
//
// The ESP32 (with the BLE HID ring paired to it) posts here. The web
// dashboard polls GET and mirrors the state: emotion, bulb, EEG samples.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Device-Id",
};

const JSON_HEADERS = { "Content-Type": "application/json", ...CORS };

const EMOTIONS = ["neutral", "rest", "happy", "laugh", "excitement", "stressed", "anger"] as const;
const ROW_ID = "default";

export const Route = createFileRoute("/api/public/neuro")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin
            .from("neuro_state")
            .select("id, device_id, client_name, emotion, intensity, bulb, eeg, updated_at")
            .eq("id", ROW_ID)
            .maybeSingle();
          if (error) {
            return new Response(JSON.stringify({ ok: false, error: error.message }), {
              status: 500,
              headers: JSON_HEADERS,
            });
          }
          return new Response(JSON.stringify({ ok: true, state: data }), {
            status: 200,
            headers: JSON_HEADERS,
          });
        } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
            status: 500,
            headers: JSON_HEADERS,
          });
        }
      },

      POST: async ({ request }) => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const url = new URL(request.url);
          const ctype = request.headers.get("content-type") ?? "";

          type Body = {
            emotion?: string;
            intensity?: number;
            bulb?: boolean;
            toggle_bulb?: boolean;
            cycle_emotion?: boolean;
            eeg?: number[];
            device_id?: string;
            client_name?: string;
          };

          let body: Body = {};
          if (ctype.includes("json")) {
            body = ((await request.json().catch(() => ({}))) ?? {}) as Body;
          }
          // Query-string form so the ESP32 can fire simple GET-style POSTs.
          const qEmotion = url.searchParams.get("emotion");
          const qBulb = url.searchParams.get("bulb");
          const qClient = url.searchParams.get("client_name");
          if (qClient) body.client_name = qClient;
          if (qEmotion) body.emotion = qEmotion;
          if (url.searchParams.get("toggle_bulb") === "1") body.toggle_bulb = true;
          if (url.searchParams.get("cycle_emotion") === "1") body.cycle_emotion = true;
          if (qBulb === "1" || qBulb === "0") body.bulb = qBulb === "1";

          const { data: current } = await supabaseAdmin
            .from("neuro_state")
            .select("emotion, bulb, intensity, eeg, client_name")
            .eq("id", ROW_ID)
            .maybeSingle();

          let emotion = current?.emotion ?? "neutral";
          let bulb = current?.bulb ?? false;
          let intensity = current?.intensity ?? 0.5;
          let clientName = current?.client_name ?? "Unnamed Subject";
          if (typeof body.client_name === "string" && body.client_name.trim()) {
            clientName = body.client_name.trim().slice(0, 60);
          }

          if (body.cycle_emotion) {
            const i = EMOTIONS.indexOf(emotion as (typeof EMOTIONS)[number]);
            emotion = EMOTIONS[(i + 1) % EMOTIONS.length];
          }
          if (body.emotion && EMOTIONS.includes(body.emotion as (typeof EMOTIONS)[number])) {
            emotion = body.emotion;
          }
          if (typeof body.bulb === "boolean") bulb = body.bulb;
          if (body.toggle_bulb) bulb = !bulb;
          if (typeof body.intensity === "number" && Number.isFinite(body.intensity)) {
            intensity = Math.min(1, Math.max(0, body.intensity));
          }

          const eeg = Array.isArray(body.eeg)
            ? body.eeg.filter((n) => typeof n === "number" && Number.isFinite(n)).slice(-256)
            : (current?.eeg as number[] | null) ?? [];

          const { data, error } = await supabaseAdmin
            .from("neuro_state")
            .upsert(
              {
                id: ROW_ID,
                device_id: body.device_id ?? request.headers.get("x-device-id") ?? "esp32-neuro-01",
                client_name: clientName,
                emotion,
                intensity,
                bulb,
                eeg,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "id" },
            )
            .select("id, device_id, client_name, emotion, intensity, bulb, eeg, updated_at")
            .single();

          if (error) {
            return new Response(JSON.stringify({ ok: false, error: error.message }), {
              status: 500,
              headers: JSON_HEADERS,
            });
          }
          return new Response(JSON.stringify({ ok: true, state: data }), {
            status: 200,
            headers: JSON_HEADERS,
          });
        } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
            status: 500,
            headers: JSON_HEADERS,
          });
        }
      },
    },
  },
});
