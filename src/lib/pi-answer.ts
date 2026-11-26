// Browser-safe rules for Phone Audio Mode (Pi answers played on the phone).
import { z } from "zod";

export const MAX_SECTIONS = 60;
export const MAX_SECTION_CHARS = 2000;
export const MAX_TOTAL_CHARS = 20000;
export const COMMAND_MAX_AGE_MS = 10_000;
export const RESTART_THRESHOLD_S = 3;

export const sectionsSchema = z
  .array(z.string().trim().min(1).max(MAX_SECTION_CHARS))
  .min(1)
  .max(MAX_SECTIONS)
  .refine((s) => s.reduce((n, x) => n + x.length, 0) <= MAX_TOTAL_CHARS, "answer too long");

export const deviceIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.-]+$/);

export const piPostSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("capture_start"), device_id: deviceIdSchema, boot_session_id: z.string().max(64).optional() }),
  z.object({
    type: z.literal("publish"),
    device_id: deviceIdSchema,
    question_id: z.string().uuid(),
    capture_token: z.string().min(16).max(128),
    revision: z.number().int().min(1).max(1000),
    sections: sectionsSchema,
    voice: z.string().max(32).optional(),
    title: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal("failed"),
    device_id: deviceIdSchema,
    question_id: z.string().uuid(),
    capture_token: z.string().min(16).max(128),
    error: z.string().max(300),
  }),
  z.object({ type: z.literal("command"), device_id: deviceIdSchema, action: z.enum(["prev", "next"]), question_id: z.string().uuid().optional() }),
  z.object({ type: z.literal("pair_code"), device_id: deviceIdSchema }),
]);

export type PublishDecision = "accept" | "duplicate" | "stale" | "bad_token";

/** Should a publish for this capture be accepted? */
export function decidePublish(opts: {
  rowToken: string;
  rowSequence: number;
  rowRevision: number;
  rowStatus: string;
  deviceSequence: number;
  token: string;
  revision: number;
}): PublishDecision {
  if (opts.token !== opts.rowToken) return "bad_token";
  if (opts.rowSequence < opts.deviceSequence || opts.rowStatus === "superseded") return "stale";
  if (opts.revision < opts.rowRevision) return "stale";
  if (opts.revision === opts.rowRevision && opts.rowStatus === "ready") return "duplicate";
  return "accept";
}

/** Previous button: restart the part if >3 s played (or at part 1), else go back a part. */
export function previousTarget(index: number, currentTime: number): number {
  if (index <= 0 || currentTime > RESTART_THRESHOLD_S) return Math.max(0, index);
  return index - 1;
}

/** Next button: next part, or null at the end (idle). */
export function nextTarget(index: number, total: number): number | null {
  return index + 1 < total ? index + 1 : null;
}

export function commandIsFresh(createdAtMs: number, nowMs: number): boolean {
  return nowMs - createdAtMs <= COMMAND_MAX_AGE_MS;
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
