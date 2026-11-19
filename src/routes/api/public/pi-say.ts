import { createFileRoute } from "@tanstack/react-router";

// Phone -> Pi speaker relay.
//   POST { text }  -> the website (phone photo) queues an answer for the Pi.
//   GET  ?after=ISO -> the Pi polls and speaks any newer answers.
// Stored in the existing `events` table as type='pi_say' (text in image_b64 column).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const JH = { "Content-Type": "application/json", ...CORS };

export const Route = createFileRoute("/api/public/pi-say")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { text?: unknown };
        const text = typeof body.text === "string" ? body.text.trim().slice(0, 20000) : "";
        if (!text) return new Response(JSON.stringify({ error: "text required" }), { status: 400, headers: JH });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("events")
          .insert({ type: "pi_say", device_id: "phone", image_b64: text })
          .select("id, created_at")
          .single();
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JH });
        return new Response(JSON.stringify({ ok: true, ...data }), { status: 200, headers: JH });
      },
      GET: async ({ request }) => {
        const after = new URL(request.url).searchParams.get("after");
        const since = after && !Number.isNaN(Date.parse(after))
          ? new Date(after).toISOString()
          : new Date(Date.now() - 60_000).toISOString();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("events")
          .select("id, created_at, image_b64")
          .eq("type", "pi_say")
          .gt("created_at", since)
          .order("created_at", { ascending: true })
          .limit(5);
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JH });
        return new Response(
          JSON.stringify({
            now: new Date().toISOString(),
            items: (data ?? []).map((r) => ({ id: r.id, created_at: r.created_at, text: r.image_b64 ?? "" })),
          }),
          { status: 200, headers: JH },
        );
      },
    },
  },
});
