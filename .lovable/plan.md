
## Goal

Give the app a ready-to-play Study Pack section so you tap play once, lock your phone, and drive everything from the BLE ring buttons while walking. One long mp3, 49 chapters, next/prev = jump chapter, ±10s seek = review a step.

## What you'll see in the app

New card on `/` titled **"Study Pack"**, above the existing Live Capture / PDF sections:

- **Load Study Pack** — two file pickers:
  - `physics-study-guide.mp3` (the 47-min file you'll upload)
  - `physics-study-guide.md` (chapter list; optional — falls back to "Chapter N" labels)
- Once loaded: single big `<audio controls>` with a **Download mp3** link.
- **Chapter list** below the player: numbered rows ("1. Terminal speed timing — 00:00 → 01:17"), current chapter highlighted, tap a row to jump to that timestamp.
- **⏮ Prev chapter · ⏯ Play/Pause · ⏭ Next chapter · ⏪ −10s · ⏩ +10s** buttons for on-screen control mirroring the ring.
- Selection persists in `localStorage` (filename + last chapter + last position) so reopening the tab resumes where you stopped.

## How the controller works (the important part)

The player wires `navigator.mediaSession` to a real `<audio>` element playing real mp3 bytes. That is the only setup where phone lock-screen and Bluetooth remotes reliably work:

- `play` / `pause` handler → toggle audio (middle button on most rings).
- `nexttrack` / `previoustrack` → jump to next/previous chapter timestamp (right / left on ring).
- `seekforward` / `seekbackward` → ±10 s inside the current chapter (long-press or volume rockers on some rings).
- `MediaMetadata` updates on every chapter change so the lock screen shows the current chapter title.

Because it's a real HTMLAudioElement (not SpeechSynthesis), audio keeps playing when the screen locks on iOS and Android, and the OS forwards standard AVRCP / Media-Session events from the BLE ring to the tab — no ESP32 relay needed for playback control.

Same handlers also bind to keyboard (Space, ←, →, J, L) so you can test on desktop.

## Chapter parsing

Parse the uploaded `physics-study-guide.md` with a small regex pass:

- Section headers: `### Chapter N. Title`
- Timestamp line: `- **Audio:** chapter N @ HH:MM:SS.mmm–HH:MM:SS.mmm`

Produces `[{ n, title, startSec, endSec }]`. If no markdown is loaded, chapters fall back to evenly-numbered `Chapter 1..N` with no timestamps and next/prev degrade to ±30 s skip.

## Files

- **New** `src/components/study-pack.tsx` — the whole card (file pickers, audio element, chapter list, MediaSession wiring, keyboard handlers, localStorage resume).
- **Edit** `src/routes/index.tsx` — mount `<StudyPack />` near the top of the page.
- No backend changes. The mp3 stays local in the browser via `URL.createObjectURL`, so nothing is uploaded to the server and there's no cost.

## Explicit non-goals for this step

- Not re-generating the mp3 from PDFs (you already have it).
- Not touching the existing Live Capture / PDF → TTS flow.
- Not shipping the mp3 as a bundled asset (kept as user-loaded so you can swap versions without a redeploy).

## Test-and-verify pass (before I call it done)

Using Playwright against the running preview:

1. Load the app, open Study Pack, load a small sample mp3 + the markdown.
2. Assert chapter list renders with the correct count and timestamps parsed.
3. Click **Play**, wait 2 s, confirm `audio.currentTime > 0` and `navigator.mediaSession.playbackState === "playing"`.
4. Fire `nexttrack` → assert `currentTime` snapped to chapter 2's `startSec`.
5. Fire `previoustrack` → back to chapter 1.
6. Fire `seekbackward` → `currentTime` decreased by ~10 s.
7. Reload the page → confirm last chapter + position restored from localStorage.
8. Screenshot the card in playing state so you can see what it looks like on the phone.

I'll only report done after all 8 checks pass.
