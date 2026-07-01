# ESP32 Smart Audio Tutor — Handoff Notes

## Current problem being solved

The ESP32 camera and ring remote are working locally, but the ESP32 repeatedly fails to open HTTPS connections to the published app. Serial logs show DNS succeeds, then TLS connect fails, and even a plain TCP port 443 probe fails. That means the app endpoint is online, but this ESP32/hotspot/network path cannot reliably connect to the public HTTPS server.

Manual upload from a phone works because the phone/browser can make normal HTTPS requests. The practical fix is to use the phone/browser as a relay while the ESP32 serves a local dashboard at its local IP address.

## Firmware behavior

- Firmware file: `public/firmware/esp32_smart_camera.ino`.
- The ESP32 prints its local dashboard URL in Serial Monitor, for example `http://172.20.10.3/`.
- The local dashboard shows the live camera preview for framing/focus.
- Browser relay mode is enabled with `BROWSER_RELAY_FIRST`.
- In browser relay mode, ring/button actions are queued locally on the ESP32 instead of depending on ESP32 HTTPS.
- The local dashboard JavaScript polls the ESP32 relay queue and sends actions to the published app from the browser.
- Capture relay path: browser fetches `http://<esp-ip>/jpg`, then posts the JPEG to `https://voice-refiner-buddy.lovable.app/api/public/event?type=capture`.
- Command relay path: browser posts JSON events such as `prev`, `next`, `stop`, and `replay` to `/api/public/event`.

## Ring mapping intended behavior

- Middle short press: capture a page.
- Middle long press: camera on/off backup toggle.
- Left: previous spoken step.
- Right: next spoken step.
- Up: stop/pause speech.
- Down: camera on/off toggle.

If previous/next does nothing, first confirm the local ESP32 dashboard is open in a browser. With the dashboard closed, queued relay actions cannot be forwarded to the app.

## Camera and focus notes

- The firmware uses high-resolution document capture for the OV5640/OV3660 path.
- The stream preview is lower resolution for speed; final `/jpg` and capture use high resolution.
- Orientation defaults are `HMIRROR=1` and `VFLIP=1` because the user’s samples were upside down.
- Serial command `rot` toggles 180-degree rotation at runtime if the preview/capture is still upside down.
- For readable text: keep the dashboard open, fill the frame with the page, use bright even light, avoid shadows, and hold still before capture.

## App-side AI behavior

- Server function: `src/lib/analyze.functions.ts`.
- The prompt now instructs the model to solve the problem, not only OCR it.
- If multiple-choice options are visible, the response should state the option letter and a short solution.
- If the page has equations or computation, the response should compute the result and dictate steps.
- OCR text is still returned as evidence, but the spoken output should be the answer/solution.

## Public API routes

- `POST /api/public/event` accepts JSON commands and JPEG captures.
- Allowed command types include `capture`, `next`, `prev`, `replay`, `stop`, and `trigger`.
- `GET /api/public/event` returns recent events so the app can poll and react.

## Recommended live demo process

1. Flash the latest firmware.
2. Open Serial Monitor at 115200 baud.
3. Copy the printed local dashboard URL.
4. Open that local dashboard on the phone/browser and keep it open.
5. Open the published app and tap **Enable audio**.
6. Use the local dashboard preview to frame/focus the paper.
7. Press the ring middle button or dashboard capture button.
8. Use ring left/right for previous/next spoken steps.

## Key diagnosis

The recurring `HTTPS connect failed`, `plain TCP port 443 probe: FAILED`, and `ACL buf alloc failed` logs are not proof that the app API is down. They point to ESP32 network/TLS/BLE memory instability. Browser relay is the intended workaround because the phone can successfully upload the same image.