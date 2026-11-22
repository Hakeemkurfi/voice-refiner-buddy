# Axon voice: skip test and smooth playback (for the Pi agent)

Do NOT replace any existing file. This only touches the playback step in tts.py.

## 1. Two-minute test (where is the skip?)
Save a long answer completely, then play it from the saved file (no downloading while it plays):

```bash
cd /tmp && python3 - <<'PY'
import requests
t="\n".join(f"Line {n}: the determinant of A equals five times nine minus eight times six, which equals negative three. Repeat line {n}: the determinant of A equals five times nine minus eight times six, which equals negative three." for n in ["one","two","three","four"])
r=requests.post("https://axondynamics.lovable.app/api/public/tts",json={"text":t,"speed":0.95},timeout=180)
open("/tmp/axon_test.mp3","wb").write(r.content); print(r.status_code,len(r.content))
PY
mpg123 -q -w /tmp/axon_test.wav /tmp/axon_test.mp3
aplay --buffer-time=500000 /tmp/axon_test.wav
```
Use the same audio output/device your tts.py uses (e.g. `aplay -D <device>` if it sets one).

- Plays perfectly -> the skipping comes from playing while the Pi is still downloading (Wi-Fi and Bluetooth share one radio on the Pi Zero 2 W). Apply step 2.
- Still skips -> report back the exact time it skipped; the file itself is the problem.

## 2. Smooth playback in tts.py (playback step only)
Keep your voice address, voice name, speed and everything else. Replace only how the cloud MP3 is played:

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

Rules:
- Download the full answer (`requests.post(...).content`, no streaming) BEFORE calling `play_mp3_smooth`.
- Do not fetch the next answer or poll anything while audio is playing.
- Prefer sending the whole answer in one request; the website already splits and joins it cleanly.
