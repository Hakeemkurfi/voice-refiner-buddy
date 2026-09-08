#!/usr/bin/env python3
"""Axon AI Reader — Raspberry Pi Zero 2 W client.

Capture a page with the Arducam IMX519, send it to the Axon server
(DeepSeek vision + your course resources), then speak the answer through
the Bluetooth earbuds.

Controls (whichever is available):
  * BLE / USB HID ring or keyboard:
        ENTER / SPACE / middle button -> capture and answer
        R                             -> repeat last answer
        Q / Ctrl-C                    -> quit
  * Plain terminal: just press ENTER.
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import requests

BASE = os.environ.get("AXON_BASE", "https://axondynamics.lovable.app")
COURSE = os.environ.get("AXON_COURSE", "").strip()
VOICE = os.environ.get("AXON_VOICE", "sage")
SPEED = os.environ.get("AXON_SPEED", "0.95")
WIDTH = os.environ.get("AXON_WIDTH", "2328")
HEIGHT = os.environ.get("AXON_HEIGHT", "1748")
SHOT = Path("/tmp/axon-page.jpg")
LOG = Path.home() / "axon" / "axon.log"


def log(msg: str) -> None:
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open("a") as f:
            f.write(line + "\n")
    except OSError:
        pass


def camera_cmd() -> list[str]:
    for exe in ("rpicam-jpeg", "libcamera-jpeg"):
        if subprocess.run(["which", exe], capture_output=True).returncode == 0:
            return [exe]
    log("No rpicam-jpeg / libcamera-jpeg found. Install libcamera-apps (or rpicam-apps).")
    sys.exit(1)


CAM = camera_cmd()


def capture() -> Path:
    subprocess.run(
        CAM + ["-o", str(SHOT), "-n", "-t", "800",
               "--width", WIDTH, "--height", HEIGHT,
               "--autofocus-mode", "auto", "--sharpness", "1.3"],
        check=True, capture_output=True,
    )
    return SHOT


def ask(image: Path | None, prompt: str | None = None) -> dict:
    params = {"format": "json"}
    if COURSE:
        params["course"] = COURSE
    payload: dict = {"prompt": prompt or "Read this page and solve every question on it.",
                     "model": "deepseek"}
    if image is not None:
        import base64
        payload["image_b64"] = base64.b64encode(image.read_bytes()).decode()
    r = requests.post(f"{BASE}/api/public/ask", params=params, json=payload, timeout=180)
    r.raise_for_status()
    return r.json()


def _speak_one(text: str) -> None:
    """Stream MP3 bytes straight into mpg123 so sound starts almost at once."""
    r = requests.post(f"{BASE}/api/public/tts",
                      json={"text": text[:3500], "voice": VOICE, "speed": float(SPEED)},
                      timeout=180, stream=True)
    r.raise_for_status()
    p = subprocess.Popen(["mpg123", "-q", "-"], stdin=subprocess.PIPE)
    try:
        for chunk in r.iter_content(chunk_size=4096):
            if chunk:
                p.stdin.write(chunk)
    finally:
        try:
            p.stdin.close()
        except Exception:
            pass
        p.wait()


def _sentences(text: str, target: int = 220) -> list[str]:
    """Split into short pieces so the first one is spoken while the rest render."""
    import re
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    out: list[str] = []
    cur = ""
    for s in parts:
        if cur and len(cur) + len(s) > target:
            out.append(cur.strip())
            cur = ""
        cur += " " + s
    if cur.strip():
        out.append(cur.strip())
    return [p for p in out if p]


def speak(text: str) -> None:
    if not text.strip():
        return
    try:
        for piece in _sentences(text):
            _speak_one(piece)
    except Exception as e:  # offline / TTS down -> local voice
        log(f"cloud speech failed ({e}); using local voice")
        subprocess.run(["espeak-ng", "-s", "150", text[:2000]], check=False)



def run_once() -> str:
    log("capturing...")
    img = capture()
    log(f"sending {img.stat().st_size // 1024} KB to Axon...")
    data = ask(img)
    answer = data.get("answer", "").strip() or "No answer came back."
    srcs = data.get("sources") or []
    if srcs:
        log("course material used: " + ", ".join(
            f"{s.get('title')} p{s.get('page')}" for s in srcs[:3]))
    log("answer: " + answer[:400].replace("\n", " "))
    speak(answer)
    return answer


def key_loop() -> None:
    """Read HID keys globally if evdev is available, else fall back to ENTER."""
    last = ""
    try:
        from evdev import InputDevice, categorize, ecodes, list_devices  # type: ignore
        devs = [InputDevice(p) for p in list_devices()]
        kbd = [d for d in devs if ecodes.EV_KEY in d.capabilities()]
        if not kbd:
            raise RuntimeError("no key devices")
        log(f"listening on: {', '.join(d.name for d in kbd)}")
        speak("Axon ready.")
        import selectors
        sel = selectors.DefaultSelector()
        for d in kbd:
            sel.register(d, selectors.EVENT_READ)
        while True:
            for key, _ in sel.select():
                for ev in key.fileobj.read():
                    if ev.type != ecodes.EV_KEY:
                        continue
                    k = categorize(ev)
                    if k.keystate != k.key_down:
                        continue
                    name = k.keycode if isinstance(k.keycode, str) else k.keycode[0]
                    if name in ("KEY_ENTER", "KEY_SPACE", "KEY_KPENTER", "BTN_MIDDLE", "BTN_LEFT"):
                        last = run_once()
                    elif name == "KEY_R" and last:
                        speak(last)
                    elif name in ("KEY_Q", "KEY_ESC"):
                        return
    except Exception as e:
        log(f"key listener unavailable ({e}); press ENTER to capture")
        speak("Axon ready.")
        while True:
            try:
                cmd = input("[ENTER]=capture  r=repeat  q=quit > ").strip().lower()
            except (EOFError, KeyboardInterrupt):
                return
            if cmd == "q":
                return
            if cmd == "r" and last:
                speak(last)
            else:
                last = run_once()


if __name__ == "__main__":
    log(f"Axon client -> {BASE}" + (f" (course {COURSE})" if COURSE else ""))
    if len(sys.argv) > 1 and sys.argv[1] == "--once":
        print(json.dumps({"answer": run_once()}, indent=2))
    else:
        key_loop()
