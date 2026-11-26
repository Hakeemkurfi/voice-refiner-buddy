# Phone Audio Mode — build the website side (Stages 1 and 2)

The five choices are approved. This round builds only the website part. The Pi code comes next, after your assistant sends the backup report and the two parts of main.py.

## What you will get
- A new **Phone output (Pi answers)** switch on the home page. It is OFF by default, so the page works exactly as today until you turn it on.
- A **Pair phone** box: enter a one-time 6-digit code once, and after that only your phone gets your Pi answers.
- When the switch is on, each Pi answer plays part by part on your phone. Each part is fully downloaded before it plays, and the next part loads while the current one plays.
- Earbud and lock-screen buttons: play/pause, next part, and previous (restarts the part if more than 3 s has played, otherwise goes back a part).
- A banner appears when a new answer arrives. There is no sound.
- A new photo stops the old answer straight away. A late answer from an old photo is always thrown away.
- Nothing changes on the Pi in this round.

## Before I start
Please export your website data first: More -> Database -> Manage -> Settings -> Export data, then keep the download on your computer.

## Testing (done by me, with a pretend Pi)
- Photo A, then photo B, then a late answer A: A is rejected and B plays.
- The same answer sent twice shows up once.
- A 6-part answer plays in order, and next/previous work.
- With the switch OFF, the page works exactly as before.

## Technical details
- Migration (additive): `pi_answers`, `pi_devices` (stores the hashed phone token and a per-device capture counter), `pi_pair_codes`, `pi_commands`. RLS is on with no public policies, so only the server can read them. Grants go to service_role only.
- New secret `AXON_PI_KEY`, which I generate.
- `src/routes/api/public/pi-answer.ts`: requests are checked with Zod and size limits.
  - Pi actions (need the `X-Axon-Pi-Key` header): `capture_start` (returns question_id, sequence and token, and replaces older answers), `publish` (idempotent upsert, rejects stale captures), `command` (prev/next, ignored after 10 s), `pair_code` (6 digits, valid for 10 minutes).
  - Phone actions (need the `X-Axon-Device-Token` header): `pair` exchanges the code for the token, and GET `?after=cursor` returns 50 changes per page.
- Timing-safe key comparison. Tokens are stored only as SHA-256 hashes.
- `src/hooks/use-tts-queue.ts`: an additional section-player mode with blob downloads, one part preloaded, no speech fallback and Media Session actions. Polling runs every 3 s while the page is awake and also on focus.
- `src/routes/index.tsx`: the switch, the pairing box and the banner.
- `src/lib/pi-answer.test.ts`: tests for stale rejection, deduplication, the previous-part rule and payload limits.
- Next round (Pi): `phone_output.py`, plus branches in main.py that are used only when `AXON_OUTPUT=phone`.
