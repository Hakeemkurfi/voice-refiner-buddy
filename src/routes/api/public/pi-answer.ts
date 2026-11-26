import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { commandIsFresh, constantTimeEqual, decidePublish, deviceIdSchema, piPostSchema } from "@/lib/pi-answer";

// Pi -> phone answer relay (Phone Audio Mode). Separate from pi-say.
// Pi calls need X-Axon-Pi-Key; phone calls need X-Axon-Device-Token (from pairing).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Axon-Pi-Key, X-Axon-Device-Token",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
function randomHex(bytes: number) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}
function piKeyOk(request: Request) {
  const expected = process.env["AXON_PI_KEY"];
  const got = request.headers.get("x-axon-pi-key") ?? "";
  return !!expected && expected.length >= 16 && constantTimeEqual(got, expected);
}
async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}
async function deviceForToken(request: Request) {
  const tok = request.headers.get("x-axon-device-token") ?? "";
  if (tok.length < 32 || tok.length > 128) return null;
  const db = await admin();
  const { data } = await db.from("pi_devices").select("device_id").eq("token_hash", await sha256(tok)).maybeSingle();
  return data?.device_id ?? null;
}

const pairSchema = z.object({ type: z.literal("pair"), code: z.string().regex(/^\d{6}$/) });
const getSchema = z.object({ after: z.coerce.number().int().min(0).default(0), cmd_after: z.coerce.number().int().min(0).default(0) });

export const Route = createFileRoute("/api/public/pi-answer")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      // Phone: changes after its cursor.
      GET: async ({ request }) => {
        const device = await deviceForToken(request);
        if (!device) return json({ error: "not paired" }, 401);
        const q = getSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
        if (!q.success) return json({ error: "bad query" }, 400);
        const db = await admin();
        const { data: answers, error } = await db
          .from("pi_answers")
          .select("question_id, capture_sequence, revision, sections, voice, title, status, error, event_cursor, updated_at")
          .eq("device_id", device)
          .gt("event_cursor", q.data.after)
          .order("event_cursor", { ascending: true })
          .limit(50);
        if (error) return json({ error: "read failed" }, 500);
        const { data: cmds } = await db
          .from("pi_commands")
          .select("id, question_id, action, created_at")
          .eq("device_id", device)
          .gt("id", q.data.cmd_after)
          .order("id", { ascending: true })
          .limit(20);
        const now = Date.now();
        const list = answers ?? [];
        const cmdList = cmds ?? [];
        return json({
          device_id: device,
          answers: list,
          cursor: list.length ? list[list.length - 1]!.event_cursor : q.data.after,
          more: list.length === 50,
          commands: cmdList.filter((c) => commandIsFresh(Date.parse(c.created_at), now)),
          cmd_cursor: cmdList.length ? cmdList[cmdList.length - 1]!.id : q.data.cmd_after,
        });
      },

      POST: async ({ request }) => {
        const raw = await request.json().catch(() => null);
        const db = await admin();

        // Phone pairing (no Pi key; one-time code instead).
        const pair = pairSchema.safeParse(raw);
        if (pair.success) {
          const h = await sha256(pair.data.code);
          const { data: code } = await db.from("pi_pair_codes").select("device_id, expires_at").eq("code_hash", h).maybeSingle();
          if (!code || Date.parse(code.expires_at) < Date.now()) return json({ error: "code wrong or expired" }, 401);
          await db.from("pi_pair_codes").delete().eq("code_hash", h);
          const token = randomHex(32);
          const { error } = await db
            .from("pi_devices")
            .upsert({ device_id: code.device_id, token_hash: await sha256(token), paired_at: new Date().toISOString() }, { onConflict: "device_id" });
          if (error) return json({ error: "pair failed" }, 500);
          return json({ ok: true, device_id: code.device_id, token });
        }

        if (!piKeyOk(request)) return json({ error: "unauthorized" }, 401);
        const p = piPostSchema.safeParse(raw);
        if (!p.success) return json({ error: "invalid", issues: p.error.issues.slice(0, 5) }, 400);
        const b = p.data;

        if (b.type === "pair_code") {
          const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 900000));
          await db.from("pi_pair_codes").delete().eq("device_id", b.device_id);
          const { error } = await db.from("pi_pair_codes").insert({
            code_hash: await sha256(code),
            device_id: b.device_id,
            expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
          });
          if (error) return json({ error: "code failed" }, 500);
          return json({ ok: true, code, expires_in_s: 600 });
        }

        if (b.type === "capture_start") {
          const { data: seq, error } = await db.rpc("pi_next_capture", { _device: b.device_id });
          if (error || seq == null) return json({ error: "capture start failed" }, 500);
          const token = randomHex(24);
          const { data: row, error: e2 } = await db
            .from("pi_answers")
            .insert({ device_id: b.device_id, capture_sequence: seq, capture_token: token, boot_session_id: b.boot_session_id ?? null })
            .select("question_id")
            .single();
          if (e2 || !row) return json({ error: "capture start failed" }, 500);
          return json({ ok: true, question_id: row.question_id, capture_sequence: seq, capture_token: token });
        }

        if (b.type === "command") {
          const { error } = await db.from("pi_commands").insert({ device_id: b.device_id, action: b.action, question_id: b.question_id ?? null });
          return error ? json({ error: "command failed" }, 500) : json({ ok: true });
        }

        // publish / failed: check the capture is still current.
        const { data: row } = await db
          .from("pi_answers")
          .select("capture_token, capture_sequence, revision, status")
          .eq("question_id", b.question_id)
          .eq("device_id", b.device_id)
          .maybeSingle();
        if (!row) return json({ error: "unknown question" }, 404);
        const { data: dev } = await db.from("pi_devices").select("capture_seq").eq("device_id", b.device_id).maybeSingle();
        const decision = decidePublish({
          rowToken: row.capture_token,
          rowSequence: row.capture_sequence,
          rowRevision: row.revision,
          rowStatus: row.status,
          deviceSequence: dev?.capture_seq ?? 0,
          token: b.capture_token,
          revision: b.type === "publish" ? b.revision : row.revision + 1,
        });
        if (decision === "bad_token") return json({ error: "bad capture token" }, 403);
        if (decision === "stale") return json({ ok: false, stale: true, error: "a newer photo replaced this one" }, 409);
        if (decision === "duplicate") return json({ ok: true, duplicate: true });

        const update =
          b.type === "publish"
            ? { sections: b.sections, revision: b.revision, voice: b.voice ?? null, title: b.title ?? null, status: "ready", error: null }
            : { status: "failed", error: b.error };
        const { error } = await db.from("pi_answers").update(update).eq("question_id", b.question_id);
        return error ? json({ error: "save failed" }, 500) : json({ ok: true });
      },
    },
  },
});
