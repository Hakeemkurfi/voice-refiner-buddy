# Axon: "scratching" sound check (for the Pi agent)

Website check (done today): a fresh answer from /api/public/tts decodes cleanly
(MP3, 24 kHz mono, 128 kbps). It has no clipping and no broken frames, and a speech checker
heard every word. So the scratching most likely starts on the Pi or the Bluetooth link.
These steps show where.

Do NOT replace any file. Back up anything before editing. Report the output of each step.

## 1. Is the earbud connection in the high-quality mode? (most likely cause)
Scratchy, telephone-like sound on every word usually means the earbuds are in
headset/call mode (HSP/HFP), not music mode (A2DP).
```bash
pactl list cards 2>/dev/null | grep -i -E "name:|active profile"
wpctl status 2>/dev/null | sed -n '/Audio/,/Video/p'
bluealsa-aplay -L 2>/dev/null
```
The active profile must be `a2dp_sink` (or `a2dp-sink`), not `headset_head_unit` / `hfp` / `hsp`.
If it is headset mode: `pactl set-card-profile <card> a2dp_sink`. Then check that bluetooth.py
does not open the earbud microphone or select the headset profile at startup.

## 2. Does a known-clean sound also scratch? (decides Pi vs website)
```bash
aplay /usr/share/sounds/alsa/Front_Center.wav
```
Also play one Piper sentence through the same earbuds.
- Scratches too -> Bluetooth/radio/power problem, not the website. Go to steps 1, 4 and 5.
- Clean -> go to step 3.

## 3. The website answer, saved and pre-converted to the earbuds' rate
```bash
cd /tmp && python3 - <<'PY'
import requests
t="Line one: the determinant of A equals five times nine minus eight times six, which equals negative three. Repeat line one: the determinant of A equals five times nine minus eight times six, which equals negative three."
r=requests.post("https://axondynamics.lovable.app/api/public/tts",json={"text":t,"speed":0.95},timeout=180)
open("/tmp/axon_test.mp3","wb").write(r.content); print(r.status_code,len(r.content))
PY
mpg123 -q -r 48000 --stereo -w /tmp/axon_48k.wav /tmp/axon_test.mp3
aplay --buffer-time=500000 /tmp/axon_48k.wav
```
If this is clean but tts.py's normal playback scratches, change only tts.py's playback step:
decode with `mpg123 -q -r 48000 --stereo -w out.wav in.mp3`, then play
`aplay -q --buffer-time=500000 out.wav`. The Pi then does no live rate conversion.

## 4. Power (under-voltage makes Bluetooth crackle)
```bash
vcgencmd get_throttled
dmesg | grep -i -E "voltage|brcmfmac|bluetooth" | tail -20
```
`throttled=0x0` is good. Anything else means the power supply or cable is too weak.

## 5. Wi-Fi and Bluetooth share one radio on the Pi Zero 2 W
```bash
iw dev wlan0 get power_save
sudo iw dev wlan0 set power_save off
sudo rfkill block wifi; aplay --buffer-time=500000 /tmp/axon_48k.wav; sudo rfkill unblock wifi
```
If it's clean with Wi-Fi blocked but scratchy with Wi-Fi on, it's radio sharing:
download the whole answer before playing, and do no network activity during playback.
Keep the earbuds close to the Pi.

## Report back
For each step: the profile name, whether it was clean or scratchy, the throttled value, and the
power_save value.
