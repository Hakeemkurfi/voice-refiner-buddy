# Axon voice: Pi-side checks (for the Pi agent)

Do NOT replace any file. Do not change camera, Bluetooth startup, Piper paths, speed or controls.
Report back the output of each step.

## 0. Show how tts.py plays the cloud voice
Paste the function in tts.py that requests `/api/public/tts` and plays the audio (only that part).
Say: does it download the whole answer first, or stream/pipe while downloading? Which player (mpg123, aplay, mpv, pygame...)?
Does it call /api/public/tts once per answer, or once per step/line?

## 1. Power check (under-voltage makes Bluetooth audio stutter)
```bash
vcgencmd get_throttled
dmesg | grep -i -E "voltage|brcmfmac|bluetooth" | tail -20
```
`throttled=0x0` is good. Anything else means the power supply/cable is too weak.

## 2. Saved file, Wi-Fi idle (is it the file or the Pi?)
```bash
cd /tmp && python3 - <<'PY'
import requests
t="\n".join(f"Line {n}: the determinant of A equals five times nine minus eight times six, which equals negative three. Repeat line {n}: the determinant of A equals five times nine minus eight times six, which equals negative three." for n in ["one","two","three","four"])
r=requests.post("https://axondynamics.lovable.app/api/public/tts",json={"text":t,"speed":0.95},timeout=180)
open("/tmp/axon_test.mp3","wb").write(r.content); print(r.status_code,len(r.content))
PY
mpg123 -q -w /tmp/axon_test.wav /tmp/axon_test.mp3
```
A) Play it the same way tts.py plays audio (same device/sink), with nothing else running.
B) Play again with Wi-Fi off during playback only:
```bash
sudo rfkill block wifi; aplay --buffer-time=500000 /tmp/axon_test.wav; sudo rfkill unblock wifi
```
- A skips, B clean -> Wi-Fi/Bluetooth share one radio on the Pi Zero 2 W: download fully before playing, never download/poll while playing.
- Both skip -> Bluetooth audio path (step 3).
- Both clean -> the problem is in how tts.py streams/plays (step 0).

## 3. Keep the earbud audio path awake (stops stutter at the start of each answer)
Check which audio system is used: `pactl info 2>/dev/null | grep "Server Name"` or `systemctl --user status pipewire wireplumber`, or bluealsa.
- PulseAudio: comment out `load-module module-suspend-on-idle` in /etc/pulse/default.pa (or ~/.config/pulse/default.pa), restart pulseaudio.
- PipeWire/WirePlumber: set `session.suspend-timeout-seconds = 0` for the Bluetooth sink.
- bluealsa: use `aplay -D bluealsa --buffer-time=500000`.
Back up any file before editing it.

## 4. Smooth playback in tts.py (playback step only, if not already like this)
```python
import subprocess, tempfile, os

def play_mp3_smooth(data: bytes, device: str | None = None):
    with tempfile.TemporaryDirectory() as d:
        mp3, wav = os.path.join(d, "a.mp3"), os.path.join(d, "a.wav")
        open(mp3, "wb").write(data)                      # whole answer downloaded first
        if subprocess.run(["mpg123", "-q", "-w", wav, mp3]).returncode == 0:
            cmd = ["aplay", "-q", "--buffer-time=500000", wav]
            if device: cmd[1:1] = ["-D", device]
            subprocess.run(cmd)
        else:
            subprocess.run(["mpg123", "-q", "-b", "2048", mp3])
```
Send the whole answer in one request (`requests.post(...).content`, no streaming).
