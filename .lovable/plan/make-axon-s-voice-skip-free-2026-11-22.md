# Make Axon's voice skip-free

## What I found today
- I pulled fresh audio from the live site (short lines, a long 6-line answer, and speeds 0.75 to 1.25) and ran each through a speech checker and a dropout scanner. Every word and number was there, with no cut-offs or sudden silences, and the Pi's own player (mpg123) decoded the files cleanly.
- One weak spot is real: at every join between two voiced pieces, the first word ("Line ...") came out unclear (checker confidence 0.07 to 0.45, where normal words are about 0.9). Each piece starts with no breathing room, so its first syllable can sound clipped. That would sound like the start of each line skipping.
- Your recent requests all succeeded. None failed and none fell back to the Pi's offline voice.
- You said it skips most at the start and less later. That pattern usually means the Pi is still downloading while it plays. On a Pi Zero 2 W, Wi-Fi and Bluetooth share one radio chip, so heavy downloading while playing to earbuds makes the earbud audio stutter. Longer answers (since the "answer every part fully" update) mean more downloading during playback.

## The fix

1. **Website: clean joins.** Add a short real pause (about 0.35 s) before each piece and a longer pause (about 0.6 s) after each line and its repeat. This way no first syllable gets clipped, and the dictation rhythm stays calm. The total pace stays the same slow speed you approved.
2. **Website: one complete file.** Keep sending the whole answer as one finished file, so the Pi does all its downloading before it starts playing.
3. **Pi (instructions for your agent, no file replacement).** In your existing tts.py playback step only: download the whole answer first, save it, convert it to WAV, then play it with a large buffer. Don't fetch the next answer while one is playing. Your camera, Bluetooth startup, Piper paths, speed settings and controls stay as they are.
4. **A 2-minute test to prove where the skip is.** I'll give your agent one command that saves a long test answer to the Pi and plays it from the saved file while Wi-Fi is idle. If that plays perfectly, the skipping comes from playing while downloading, and step 3 fixes it. If it still skips, the problem is in the file and I keep working on the website side.

## How I'll check it
- Re-run the speech checker on a long answer after the change. Target: every join word above 0.8 confidence, and no word or digit missing.
- Keep the existing "no words lost" test, and add one that checks every piece gets its lead-in pause.

## Technical details
- `src/routes/api/public/tts.ts`: in `voicePieces`, put a pre-encoded silent MP3 frame run between pieces. Use one for 24 kHz mono (gateway/OpenAI) and one for 16 kHz mono (Tencent), so the formats match and decoders don't hiccup. Store them as small base64 constants.
- No change to `splitForVoice`, speed handling, or the provider order.
- Add a test in `src/lib/tts-split.test.ts` for the join padding.
- Pi agent snippet: `requests.get/post` to a file, then `mpg123 -w out.wav`, then `aplay --buffer-time=500000 out.wav`, plus the A/B test command.
