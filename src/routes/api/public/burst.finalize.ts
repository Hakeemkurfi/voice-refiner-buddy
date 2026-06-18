import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Device-Id",
};

// POST /api/public/burst/finalize?id=<burst_id>
// Called by the ESP32 once it has uploaded the last frame of a burst.
// Server scores frames by JPEG byte-size (sharpness proxy), picks the top 3
// spread across the burst, marks the burst ready, and inserts a normal
// `events` row pointing back at the burst so the web UI picks it up.
export const Route = createFileRoute("/api/public/burst/finalize")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const burstId = url.searchParams.get("id");
          if (!burstId) {
            return new Response(JSON.stringify({ error: "missing ?id" }), {
              status: 400,
              headers: { "Content-Type": "application/json", ...CORS },
            });
          }
          const device_id = request.headers.get("x-device-id") ?? "esp32-cam-01";

          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );

          const { data: frames, error: fErr } = await supabaseAdmin
            .from("burst_frames")
            .select("seq, sharpness, byte_size, image_b64")
            .eq("burst_id", burstId)
            .order("seq", { ascending: true });
          if (fErr) throw fErr;
          if (!frames || frames.length === 0) {
            return new Response(JSON.stringify({ error: "no frames for burst" }), {
              status: 404,
              headers: { "Content-Type": "application/json", ...CORS },
            });
          }

          // ----- Pick the 3 sharpest frames, spread across the burst. -----
          // We sort by sharpness desc and greedily keep the next-best frame
          // only if its `seq` differs from already-picked seqs by >= GAP.
          // That way a 4-second pan gives one frame from each part of the page,
          // instead of three near-identical frames from the steadiest moment.
          const sorted = [...frames].sort(
            (a, b) => (b.sharpness ?? 0) - (a.sharpness ?? 0),
          );
          const GAP = Math.max(2, Math.floor(frames.length / 6));
          const picked: typeof frames = [];
          for (const f of sorted) {
            if (picked.length >= 3) break;
            if (picked.every((p) => Math.abs(p.seq - f.seq) >= GAP)) {
              picked.push(f);
            }
          }
          // If the GAP filter was too strict (very short bursts), top up to 3 anyway.
          for (const f of sorted) {
            if (picked.length >= 3) break;
            if (!picked.includes(f)) picked.push(f);
          }
          picked.sort((a, b) => a.seq - b.seq);

          // Mark burst ready
          await supabaseAdmin
            .from("bursts")
            .update({
              status: "ready",
              frame_count: frames.length,
              picked_seqs: picked.map((p) => p.seq),
            })
            .eq("id", burstId);

          // Drop the best-frame's image_b64 into events so the web UI's
          // existing preview/polling pipeline shows the same image immediately.
          // We mark device_id with the burst prefix so the UI knows to ask the
          // analyzer for a multi-image read using burst_id.
          const best = picked[0];
          const { data: ev, error: eErr } = await supabaseAdmin
            .from("events")
            .insert({
              type: "capture",
              image_b64: best.image_b64,
              device_id: `burst:${burstId}:${device_id}`,
            })
            .select("id, created_at")
            .single();
          if (eErr) throw eErr;

          return new Response(
            JSON.stringify({
              ok: true,
              burst: burstId,
              frames: frames.length,
              picked: picked.map((p) => ({ seq: p.seq, bytes: p.byte_size })),
              event: ev,
            }),
            { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
          );
        } catch (e) {
          return new Response(JSON.stringify({ error: (e as Error).message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }
      },
    },
  },
});
