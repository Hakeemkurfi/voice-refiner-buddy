import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Device-Secret",
};

const ALLOWED = new Set(["capture", "next", "prev", "replay", "stop"]);

export const Route = createFileRoute("/api/public/event")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        try {
          // Endpoint intentionally OPEN for ESP32 testing — no shared secret.

          const ctype = request.headers.get("content-type") ?? "";
          let type = "capture";
          let image_b64: string | null = null;
          let device_id: string | null =
            request.headers.get("x-device-id") ?? null;

          if (ctype.includes("application/json")) {
            const body = (await request.json()) as {
              type?: string;
              image_b64?: string;
              device_id?: string;
            };
            type = body.type ?? "capture";
            image_b64 = body.image_b64 ?? null;
            device_id = body.device_id ?? device_id;
          } else if (ctype.startsWith("image/")) {
            // Raw JPEG body from the ESP32. Treat as capture.
            const url = new URL(request.url);
            type = url.searchParams.get("type") ?? "capture";
            const buf = new Uint8Array(await request.arrayBuffer());
            // base64 encode
            let bin = "";
            for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
            image_b64 = btoa(bin);
          } else {
            const url = new URL(request.url);
            type = url.searchParams.get("type") ?? "capture";
          }

          if (!ALLOWED.has(type)) {
            return new Response(JSON.stringify({ error: "bad type" }), {
              status: 400,
              headers: { "Content-Type": "application/json", ...CORS },
            });
          }

          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const { data, error } = await supabaseAdmin
            .from("events")
            .insert({ type, image_b64, device_id })
            .select("id, type, created_at")
            .single();
          if (error) {
            return new Response(JSON.stringify({ error: error.message }), {
              status: 500,
              headers: { "Content-Type": "application/json", ...CORS },
            });
          }
          return new Response(JSON.stringify({ ok: true, event: data }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        } catch (e) {
          return new Response(
            JSON.stringify({ error: (e as Error).message }),
            {
              status: 500,
              headers: { "Content-Type": "application/json", ...CORS },
            },
          );
        }
      },
    },
  },
});
