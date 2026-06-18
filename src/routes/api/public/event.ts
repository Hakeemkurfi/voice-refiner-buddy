import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Device-Secret, X-Device-Id",
};

const ALLOWED = new Set(["capture", "next", "prev", "replay", "stop", "trigger"]);

export const Route = createFileRoute("/api/public/event")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => {
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { data, error } = await supabaseAdmin
          .from("events")
          .select("id, type, device_id, created_at, image_b64")
          .order("created_at", { ascending: false })
          .limit(5);

        return new Response(
          JSON.stringify({
            ok: !error,
            error: error?.message,
            recent: (data ?? []).map((row) => ({
              id: row.id,
              type: row.type,
              device_id: row.device_id,
              created_at: row.created_at,
              image_b64: row.image_b64,
              image_chars: row.image_b64?.length ?? 0,
            })),
          }),
          { status: error ? 500 : 200, headers: { "Content-Type": "application/json", ...CORS } },
        );
      },
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
            const looksLikeJpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
            if (!looksLikeJpeg) {
              return new Response(JSON.stringify({ error: "image body was received, but it is not a JPEG file" }), {
                status: 400,
                headers: { "Content-Type": "application/json", ...CORS },
              });
            }
            // Fast base64 encode via Buffer (server runtime). The previous
            // per-byte String.fromCharCode loop blew the call stack on QXGA
            // frames > 200 KB and stalled the request for seconds.
            image_b64 = Buffer.from(buf).toString("base64");
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
