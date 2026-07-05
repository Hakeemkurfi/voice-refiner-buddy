## Goal

Turn the uploaded `pyhsics-2.pdf` (8 solved physics questions) into a single ready-to-play audio guide where **each question and its full solution are read out loud, then repeated a second time, before moving on to the next question**. Voice must be natural, moderate-slow, and speak math the way a tutor dictates it ("sine theta two equals two multiplied by sine theta one", not "sin θ₂ = 2 sin θ₁"). The finished MP3 shows up in the existing **Study Pack** card so you tap Play once and control it with the BLE ring.

## Pipeline (run once in the sandbox, not in the browser)

1. **Parse** — already done via `document--parse_document`. 8 questions extracted, each with a full worked solution.
2. **Rewrite every Q+A into spoken-math English** using Lovable AI (`google/gemini-3-flash-preview`) with a strict style prompt:
   - Read the question in plain English first ("Question one. A small ball of mass m is thrown upward…").
   - Then read the solution step by step, converting every symbol to spoken form (`∫`, `dv/dt`, `θ`, subscripts, fractions, integrals, vectors) exactly like the example you gave.
   - No LaTeX, no symbol names left unspoken.
   - End each question with a short pause phrase ("End of round one, question one. Now repeating.") before the second reading, and ("End of question one. Moving on to question two.") after the second reading.
3. **Duplicate** — emit the spoken text for each question **twice back-to-back** so playback naturally reads it twice.
4. **TTS** — call `POST https://ai.gateway.lovable.dev/v1/audio/speech` with:
   - `model: openai/gpt-4o-mini-tts`
   - `voice: sage` (calm tutor voice already used in the app)
   - `speed: 0.9` (moderate slow, matches your dictation example)
   - `response_format: mp3`
   - `instructions`: "Speak as a calm, patient physics tutor dictating step by step. Pause slightly between clauses. Pronounce every math word fully so the listener can write it down."
   - Chunked per question round (16 chunks total = 8 questions × 2 rounds) so no request hits the input cap and we get chapter-accurate timestamps.
5. **Concatenate** the 16 MP3 chunks into one `physics-2-study.mp3` with `ffmpeg -f concat`.
6. **Emit `physics-2-study.md`** in the exact format the Study Pack parser already understands:
   ```
   ### Chapter 1. Question 1 — round 1
   - **Audio:** chapter 1 @ 00:00:00.000–00:03:12.480
   ### Chapter 2. Question 1 — round 2
   - **Audio:** chapter 2 @ 00:03:12.480–00:06:24.960
   …
   ### Chapter 16. Question 8 — round 2
   ```
   Timestamps come from `ffprobe -show_entries format=duration` on each chunk, summed.

## Delivery into the app

- Save both files under `public/study-packs/physics-2/` so they're served by Vite as static assets.
- **Edit `src/components/study-pack.tsx`** to add a **"Load bundled: Physics 2"** button next to the two file pickers. Clicking it `fetch()`s `/study-packs/physics-2/physics-2-study.mp3` + `.md`, wraps the mp3 in a Blob, and feeds it into the existing loader path — same code path as manual upload, so all lock-screen + ring controls keep working unchanged.
- Also keep a **Download MP3** link so you can AirDrop / save the file to your phone's Files app as a backup.

## Explicit non-goals

- Not touching the Live Capture / image-solving flow (separate issue).
- Not changing the PDF upload → analyze pipeline.
- Not re-running TTS on every page load — the MP3 is generated once and bundled.

## Technical details

- Sandbox scripts used: `knowledge://skill/ai-gateway/scripts/lovable_ai.py` for the rewrite step, direct `curl` to `ai.gateway.lovable.dev/v1/audio/speech` for TTS (script doesn't do TTS). `ffmpeg`/`ffprobe` are pre-installed.
- Chunk size stays well under the TTS input cap (target ≤ ~1500 chars per chunk; longer solutions get split at paragraph boundaries and the chapter timestamp is the sum of the sub-chunks).
- Total expected audio length: ~35–45 min (8 questions × 2 rounds, moderate-slow pace).
- Cost: one-off gateway spend at generation time; zero runtime cost since the MP3 is static.

## Verify-before-done checklist

1. `ffprobe` reports the concatenated MP3 duration matches the sum of chunk durations (no truncation).
2. Open the app, tap **Load bundled: Physics 2** — the player shows 16 chapters with correct titles and timestamps.
3. Play chapter 1 for 5 seconds, confirm audible speech at moderate-slow pace, math spoken in words (spot-check by ear against Question 5's angle values).
4. Press "next chapter" — jumps to chapter 2 = "Question 1 — round 2" (i.e. same question again).
5. Lock screen on a phone / trigger `nexttrack` via MediaSession in Playwright — chapter advances.
6. Reload page → Study Pack restores position from `localStorage`.
7. Screenshot the loaded Study Pack card.

Only report done after all 7 pass.
