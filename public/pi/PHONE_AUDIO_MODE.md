# Axon Phone Audio Mode — Pi integration and first-pairing guide

## Plain-English summary

The Axon website is ready to receive Pi answers and play them on a paired phone. The installed Pi application still needs its matching update. The website switch does **not** remotely change the Pi's output mode, and the website cannot create a pairing code on the Pi's behalf.

After the Pi update, the Pi creates a one-time six-digit code. Enter that code on the Axon home page within 10 minutes. Then keep Phone output enabled, tap **Start listening**, and take a photo with the existing Pi/S10 capture control.

The installed application uses `boot.py -> main.py` with separate camera, Bluetooth and speech modules. **Do not replace it with `public/pi/axon.py`.** That file is a different standalone application.

## Instructions for the Pi assistant

Implement this as a small additive integration. Inspect the actual installed files before editing. Preserve the IMX519 camera setup, Bluetooth startup, existing Piper paths, speech speed, navigation controls and Pi-output mode.

### 1. Back up and identify the installation first

Before editing:

- Report the actual installation directory and systemd service name.
- Back up the complete current application and its environment/settings file, excluding unnecessary caches.
- Record file checksums and the current service status.
- Save a restoration command and confirm that the backup can be read.
- Read the complete `main.py` capture and controller loops and the complete Bluetooth `listen()`/`s10_listener()` implementation.
- Treat the reported duplicate S10 read-loop block as a separate inspection task. Do not remove or rewrite it as part of this feature unless the complete function proves it is unsafe.

Do not assume `~/axon`, `axon.service`, or any other path/name without checking.

### 2. Add a separate Phone Audio Mode branch

Add a small `phone_output.py` client and minimal branches in the existing capture/controller flow. Do not duplicate the camera or AI solver.

Required settings:

```sh
AXON_BASE=https://axondynamics.lovable.app
AXON_DEVICE_ID=<existing stable Pi device id>
AXON_OUTPUT=pi                 # default: existing behaviour
# AXON_OUTPUT=phone            # opt-in phone playback
AXON_PI_KEY=<private relay key>
```

- `AXON_OUTPUT=pi` must behave exactly as before.
- `AXON_OUTPUT=phone` keeps capture and image solving in the existing flow, but sends the final answer text to the website instead of speaking it through the Pi.
- Do not save Pi-side answer audio files in phone mode.
- Never print, commit or log `AXON_PI_KEY`. Load it from the Pi's protected environment. If the existing key is unavailable, generate a replacement locally and have the owner update the website's `AXON_PI_KEY` secret to the same value.
- Use HTTPS and bounded network timeouts. A network failure must not crash capture or the controller loop.

### 3. Provide an explicit pairing command

Add a `--pair` (or equivalent) command to the new client. It must load the same protected settings as the service and call:

```http
POST https://axondynamics.lovable.app/api/public/pi-answer
Content-Type: application/json
X-Axon-Pi-Key: <private relay key>

{"type":"pair_code","device_id":"<AXON_DEVICE_ID>"}
```

A successful response is:

```json
{"ok":true,"code":"123456","expires_in_s":600}
```

Print the six-digit code only to the owner's local terminal and state that it expires in 10 minutes. A new request replaces the previous code for that Pi. The final handoff must give the owner the **exact pairing command for the real installation path**.

### 4. Register every new photo before solving it

Immediately after a new capture is accepted in phone mode, call:

```json
{
  "type": "capture_start",
  "device_id": "<AXON_DEVICE_ID>",
  "boot_session_id": "<optional unique id for this Pi boot>"
}
```

Use the same headers as above. Save all three returned values for this capture:

```json
{
  "ok": true,
  "question_id": "<uuid>",
  "capture_sequence": 1,
  "capture_token": "<private per-capture token>"
}
```

A newer capture supersedes older answers. Do not let an older worker publish into a newer capture.

### 5. Publish the complete solved answer

Keep the existing Axon camera, OCR and solving path. Convert the final answer into ordered spoken sections and publish once the solution is complete:

```json
{
  "type": "publish",
  "device_id": "<AXON_DEVICE_ID>",
  "question_id": "<uuid from capture_start>",
  "capture_token": "<token from capture_start>",
  "revision": 1,
  "title": "Pi answer",
  "voice": "sage",
  "sections": [
    "Question 1. The answer is ...",
    "Line one. ..."
  ]
}
```

Section rules enforced by the website:

- 1–60 sections.
- Each trimmed section is 1–2,000 characters.
- Combined answer is at most 20,000 characters.
- Preserve question/part order and the existing SA, DA, DS and WS ND answer rules.
- Do not send an empty or partial answer merely to make playback start sooner. The phone creates and plays audio section by section after receiving the complete answer.
- If retrying the identical publish, reuse the same revision. A duplicate is safe and returns `duplicate: true`.
- HTTP 409 with `stale: true` means a newer photo replaced this capture. Discard it; do not retry it as current.
- HTTP 403 means the capture token is wrong. Do not keep retrying.

If solving fails after `capture_start`, report it so the phone does not wait silently:

```json
{
  "type": "failed",
  "device_id": "<AXON_DEVICE_ID>",
  "question_id": "<uuid>",
  "capture_token": "<token>",
  "error": "<short safe explanation, maximum 300 characters>"
}
```

### 6. Preserve and branch the physical controls

The actual installed mappings reported by the owner are:

**Y46-B (AVRCP, currently on Pi):**

- PLAYCD and PAUSECD: capture.
- NEXTSONG and PREVIOUSSONG: previous section.

**S10 Consumer Control:**

- PLAYPAUSE and VOLUMEDOWN: capture.
- VOLUMEUP: volume up.
- PREVIOUSSONG: previous.
- NEXTSONG: next.

For phone mode:

- Keep S10 paired to the Pi for capture and best-effort navigation.
- Pair Y46-B to the iPhone. Its media buttons then control Safari/lock-screen playback directly.
- Never assume the Pi receives Y46-B events while the earbuds are connected to the phone.
- Preserve every mapping in Pi-output mode.
- In phone mode, S10 NEXTSONG and PREVIOUSSONG send the commands below. Keep PLAYPAUSE and VOLUMEDOWN as capture, and VOLUMEUP as volume up.

```json
{"type":"command","device_id":"<AXON_DEVICE_ID>","action":"next","question_id":"<current uuid if known>"}
```

or:

```json
{"type":"command","device_id":"<AXON_DEVICE_ID>","action":"prev","question_id":"<current uuid if known>"}
```

Commands older than 10 seconds are ignored by the phone. Phone/earbud previous means: restart the current part if more than three seconds has played; otherwise go back one part. Next at the final part leaves playback idle.

### 7. Verification and rollback

Test without changing the camera or speech configuration:

1. With `AXON_OUTPUT=pi`, confirm capture and the existing Pi audio still work.
2. With `AXON_OUTPUT=phone`, request a code and pair a phone.
3. Capture one complete multi-part answer; confirm all parts arrive in order.
4. Test play/pause, next and previous using the phone-connected Y46-B.
5. Test S10 capture and best-effort next/previous separately.
6. Start photo A, then photo B, then attempt a late publish for A. A must return stale and B must remain current.
7. Send the same publish twice; it must appear once.
8. Confirm a failed solve produces a visible phone error instead of indefinite waiting.
9. Test first with Safari open and unlocked, then with the phone locked. Do not promise new-answer delivery while iOS has suspended Safari.

Rollback must be only: set `AXON_OUTPUT=pi`, restart the actual service, and confirm existing Pi playback. Keep the backup until the owner accepts the phone-mode test.

## Owner's first trial, after the Pi assistant finishes

1. Open **https://axondynamics.lovable.app** in iPhone Safari.
2. Connect Y46-B earbuds to the iPhone; keep S10 connected to the Pi.
3. Turn on **Phone output (Pi answers)**.
4. Ask the Pi assistant to run the new pairing command. It will return a six-digit code.
5. Enter that code under **Pair phone** within 10 minutes.
6. Tap **Start listening** and keep Safari open for the first test.
7. Take a photo with the existing S10/Pi capture control.
8. Use Y46-B or the phone's media controls for play/pause, next part and previous part.
9. Only after that works, test with the phone locked.

If there is no pairing code, the Pi-side update has not been completed. Turning the website switch off and on cannot create one.
