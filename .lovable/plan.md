I found three concrete problems to fix:

1. The ring is correctly detecting `prev`, but the ESP32 upload uses `HTTPClient` and returns `HTTP -1 connection refused`; I will replace command posting with the same raw HTTPS method already used by image upload, add WiFi checks, and print clearer network diagnostics.
2. The current mouse-mode up/down actions call `volup` and `voldn`, but `ringAction()` does not handle those names, so up/down can silently do nothing; I will map down to camera ON/OFF toggle as you requested, up to stop/replay or stop audio, and keep left/right as previous/next.
3. The photo in your upload is badly blurred/overexposed, so the AI cannot read the text reliably even if the model is good; I will adjust capture settings to prioritize document readability: stronger exposure control, less overexposure, better focus wait for OV5640, higher quality JPEG, and a better burst selection path.

Implementation plan:

- Firmware networking
  - Replace `postCommand()` with a raw `WiFiClientSecure` HTTPS POST, matching `postJpeg()`.
  - If WiFi is not connected, do not attempt POST; print `WiFi DOWN` instead of confusing HTTP -1.
  - Keep printing the local dashboard IP every 15 seconds.
  - Add serial/audit text showing `https://voice-refiner-buddy.lovable.app/api/public/event` and local `http://<ip>/`.

- Ring button mapping
  - Middle short press: capture and send.
  - Down button/swipe: camera ON/OFF toggle, no long press needed.
  - Left: previous audio step.
  - Right: next audio step.
  - Up: stop/replay audio control.
  - Remove the broken `volup`/`voldn` action names.
  - Improve the S10 report handling so noisy reports like `00 BC 42 1F`, `02 BC 42 1F`, `07 BC 92 1F` trigger only one clean action instead of repeats.

- Camera/readability fix
  - Confirm the code treats PID `0x5640` as OV5640 and PID `0x3660` as OV3660; the firmware already does this, but I will make the serial output clearer.
  - Reduce over-bright washed-out captures by lowering brightness/AE level and using stronger contrast for paper.
  - Increase JPEG quality for OCR.
  - For OV5640, use the updated autofocus command sequence from Espressif’s OV5640 AF work: release/start/wait before capture.
  - Keep QXGA capture for text, but ensure preview does not leave stale low-resolution frames.
  - Add a simple capture checklist in Serial/local dashboard: hold 20–30 cm, good light, fill page, tap autofocus/capture.

- App-side audio response reliability
  - Verify `/api/public/event` accepts `prev`, `next`, `replay`, and `stop` already; it does.
  - Keep app processing of those events unchanged, because the app already calls `playPrev()`, `playNext()`, `replayTts()`, and `stopTts()`.

After this, your test should be:

```text
1. Flash firmware.
2. Open Serial Monitor.
3. Wait for: [net] Dashboard: http://<ip>/
4. Open that IP to check framing/focus.
5. Press middle once: photo should upload.
6. Press left/right: audio should go previous/next.
7. Press up: stop/replay audio.
8. Press down: camera toggles OFF/ON.
```