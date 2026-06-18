# Burst Capture + Security Fix

## What we're building

When you press **M** on the ring, the ESP32 records a ~4-second burst of ~24 JPEG frames (6 fps) at QXGA and streams them to the server as they're captured. You can slowly pan over half an A4 page. The server picks the 3 sharpest, most-different frames and sends them as a multi-image request to Gemini, which merges the text across frames.

## Why this beats single-shot

- 24 chances at sharp focus instead of 1
- Slow pan covers half-A4 even though OV3660 only resolves a small sharp window at any distance
- Server-side Laplacian-variance scoring throws away blurry frames before Gemini sees them
- Perceptual-hash dedup means holding still doesn't waste tokens

## Plan

### 1. DB migration (one migration, two purposes)

- New table `bursts(id uuid pk, device_id text, status text, created_at)` with grants + RLS.
- New table `burst_frames(id uuid pk, burst_id uuid fk, seq int, image_b64 text, sharpness float, created_at)` with grants + RLS.
- **Security fix #1**: drop the public SELECT policy on `events`. Web UI will poll via a new server function (`getRecentEvents`) that uses the admin client server-side, so the browser never reads `image_b64` or `device_id` directly.
- **Security fix #2**: remove `events` from the `supabase_realtime` publication (kills the realtime subscription risk). UI switches from realtime to a 1.5s poll — same UX, no anon channel exposure.

### 2. Backend

- `/api/public/event` POST: when `?burst=<id>&seq=<n>` is present, insert into `burst_frames` instead of `events`. If `seq=0`, also create the `bursts` row.
- New `/api/public/burst/finalize` (called by ESP32 after the last frame, or auto-finalized when no frames arrive for 1.5s): score all frames (Laplacian variance via pure-JS `jpeg-js` decode + 8×8 perceptual hash for dedup), keep top 3, mark burst `ready`, kick off analyze.
- `analyze.functions.ts`: accept an array of image_b64. Send all 3 as `image_url` content blocks in one Gemini call with a "these are 1–3 frames of the SAME document, merge their text" instruction.
- New `getRecentEvents` server fn (admin client, server-side only) returning the 5 most recent events with safe columns only — replaces the browser's direct query / realtime sub.

### 3. Firmware

- New `BURST_MS = 4000`, `BURST_FPS = 6`, `BURST_QUALITY = 6` (slightly lower per-frame quality so 24 frames fit).
- **M button** now triggers `runBurst()` instead of `captureAndSend()`. Single-shot stays available on a long-press of M (>1s).
- `runBurst()`: generate uuid, loop until `BURST_MS` elapsed, POST each frame with `?burst=<id>&seq=<n>` (chunked TLS upload as today), LED on during burst, blink at each frame, off when done, then POST `/burst/finalize`.

### 4. UI

- Replace realtime `events-stream` subscription with `useQuery({ queryFn: getRecentEvents, refetchInterval: 1500 })`.
- Add a small "Burst" indicator that appears while a burst is in progress.

## Tradeoffs you should know

- **Total time per question rises** from ~4 s (single shot) to ~8–10 s (4 s burst + ~3 s upload + ~2 s Gemini). If that's too slow we can drop to `BURST_MS = 2500` / `FPS = 8`.
- **Gemini cost ~3×** per question (3 images instead of 1). Worth it for reliability on hard frames.
- **Per-frame JPEG quality drops slightly** (Q=6 vs Q=4) to fit the burst in memory + bandwidth — the *sharpest selected frame* will still be sharper than today's single shot because we get 24 tries.

## Files I'll change

- `supabase/migrations/<new>.sql` — bursts + burst_frames tables, drop events SELECT policy, drop events from realtime publication
- `src/routes/api/public/event.ts` — handle `?burst=&seq=` route
- `src/routes/api/public/burst.finalize.ts` — new finalize endpoint
- `src/lib/analyze.functions.ts` — multi-image input + `getRecentEvents` server fn
- `src/routes/index.tsx` — swap realtime for polled query, burst indicator
- `public/firmware/esp32_smart_camera.ino` — burst mode on M button

Ready to build all six?
