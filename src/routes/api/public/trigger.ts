import { createFileRoute } from "@tanstack/react-router";

// Ring-button "M" capture trigger.
//   POST  -> web app calls this when user presses M on the ring.
//            We insert an event of type='trigger' into the events table.
//   GET   -> ESP32 polls this every ~2s. Returns {capture:true} if a
//            'trigger' event was inserted in the last 10 seconds AND that
//            event has not already been consumed by this device. The ESP
//            stores the last consumed id locally so it only fires once.
//
// We piggy-back on the existing `events` table to avoid a migration.
// type='trigger' rows are ignored by the web UI's processEvent switch.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Device-Id",
};

export const Route = createFileRoute("/api/public/trigger")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: CORS }),

      POST: async ({ request }) => {
        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          let device_id: string | null =
            request.headers.get("x-device-id") ?? null;
          if ((request.headers.get("content-type") ?? "").includes("json")) {
            const body = (await request.json().catch(() => ({}))) as {
              device_id?: string;
            };
            device_id = body.device_id ?? device_id;
          }
          const { data, error } = await supabaseAdmin
            .from("events")
            .insert({ type: "trigger", device_id, image_b64: null })
            .select("id, created_at")
            .single();
          if (error) {
            return new Response(
              JSON.stringify({ error: error.message }),
              { status: 500, headers: { "Content-Type": "application/json", ...CORS } },
            );
          }
          return new Response(
            JSON.stringify({ ok: true, id: data.id, created_at: data.created_at }),
            { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
          );
        } catch (e) {
          return new Response(
            JSON.stringify({ error: (e as Error).message }),
            { status: 500, headers: { "Content-Type": "application/json", ...CORS } },
          );
        }
      },

      GET: async ({ request }) => {
        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const url = new URL(request.url);
          const since = url.searchParams.get("since"); // last trigger id ESP already saw
          const cutoff = new Date(Date.now() - 10_000).toISOString();
          const { data, error } = await supabaseAdmin
            .from("events")
            .select("id, created_at")
            .eq("type", "trigger")
            .gte("created_at", cutoff)
            .order("created_at", { ascending: false })
            .limit(1);
          if (error) {
            return new Response(
              JSON.stringify({ capture: false, error: error.message }),
              { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
            );
          }
          const newest = data?.[0];
          const fire = !!newest && newest.id !== since;
          return new Response(
            JSON.stringify({ capture: fire, id: newest?.id ?? null }),
            { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
          );
        } catch (e) {
          return new Response(
            JSON.stringify({ capture: false, error: (e as Error).message }),
            { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
          );
        }
      },
    },
  },
});
