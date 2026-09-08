# Raspberry Pi Zero 2 W — Solve API guide (no Gemini key needed on device)

The published web app already holds the AI key. Your Pi just sends a photo and
gets back the spoken solution. No Google account, no region restriction, no key
stored on the board.

## Endpoints

Base URL: `https://axondynamics.lovable.app`

### 1. Solve a page
`POST /api/public/solve`

Option A — raw JPEG (simplest for a Pi camera):
```
Content-Type: image/jpeg
body: <jpeg bytes>
optional query: ?model=auto|flash|pro|deepseek
```

Option B — JSON:
```json
{ "image_b64": "<base64 jpeg, no data: prefix>", "model": "auto", "contextText": "optional class notes" }
```

Response:
```json
{
  "title": "Simple Multiplication Problem",
  "summary": "one spoken sentence",
  "steps": ["Question 1. ...", "The answer is B.", "..."],
  "extractedText": "verbatim page text",
  "confidence": 1,
  "modelUsed": "gemini-flash",
  "framesUsed": 1
}
```
`GET /api/public/solve` returns a small health/usage JSON — good for testing.

### 2. Text to speech (MP3)
`POST /api/public/tts`
```json
{ "text": "The answer is B.", "voice": "sage", "speed": 0.9 }
```
Returns `audio/mpeg` bytes you can pipe straight to `mpg123 -`.

## Quick test from the Pi

```bash
libcamera-jpeg -o page.jpg --width 2028 --height 1520 -n
curl -s -X POST --data-binary @page.jpg \
     -H "Content-Type: image/jpeg" \
     https://axondynamics.lovable.app/api/public/solve
```

## Full Python loop (button press -> capture -> solve -> speak)

```python
#!/usr/bin/env python3
import subprocess, requests, json

BASE = "https://axondynamics.lovable.app"

def capture(path="/tmp/page.jpg"):
    subprocess.run(["libcamera-jpeg", "-o", path, "-n",
                    "--width", "2028", "--height", "1520"], check=True)
    return path

def solve(path):
    with open(path, "rb") as f:
        r = requests.post(f"{BASE}/api/public/solve",
                          data=f.read(),
                          headers={"Content-Type": "image/jpeg"},
                          timeout=120)
    r.raise_for_status()
    return r.json()

def speak(text):
    r = requests.post(f"{BASE}/api/public/tts",
                      json={"text": text, "voice": "sage", "speed": 0.9},
                      timeout=120)
    r.raise_for_status()
    p = subprocess.Popen(["mpg123", "-q", "-"], stdin=subprocess.PIPE)
    p.communicate(r.content)

if __name__ == "__main__":
    data = solve(capture())
    print(json.dumps(data, indent=2)[:800])
    for step in data["steps"]:
        speak(step)
```

Install once on the Pi: `sudo apt install -y python3-requests mpg123 libcamera-apps`

## Notes

- Timeouts: allow at least 60–120 s per request; the model can think for a while.
- `model=flash` is cheapest/fastest, `pro` is used automatically when the flash
  answer looks weak, `deepseek` uses the DeepSeek balance instead.
- Keep the photo filling the frame, bright and even light, hold still — the
  clearer the page, the better the answer.
- The endpoint is public: anyone with the URL can use it, so don't post the URL
  publicly if you want to protect your AI credits.

## Simplest option: /api/public/ask (plain text answer, no speech)

`POST https://axondynamics.lovable.app/api/public/ask`

Send any of these and you get the answer back as plain text:

```bash
# just a question
curl -s -X POST -H "Content-Type: text/plain" \
     --data "What is 17 times 23?" \
     https://axondynamics.lovable.app/api/public/ask

# a photo of a page
curl -s -X POST --data-binary @page.jpg -H "Content-Type: image/jpeg" \
     https://axondynamics.lovable.app/api/public/ask

# photo + your own question
curl -s -X POST -H "Content-Type: application/json" \
     -d '{"prompt":"Solve question 3 only","image_b64":"<base64 jpeg>","model":"pro"}' \
     https://axondynamics.lovable.app/api/public/ask
```

Options: `?q=your+question` with a raw JPEG, `?model=pro` for the stronger model,
`?format=json` to get `{"answer":"..."}` instead of plain text.
Handle the speech yourself — this endpoint only returns text.

## Course resources (RAG)

Upload your textbooks, lecture notes, lab manuals and formula sheets at
`https://axondynamics.lovable.app/resources`. Every answer then searches them
first and follows your course's own notation, formulas and methods when the
material is relevant. If nothing relevant is found, Axon still answers normally
from the model's own knowledge — a matching resource is never required.

Extra options on both endpoints:

```bash
# limit the search to one course
curl -s -X POST "https://axondynamics.lovable.app/api/public/ask?format=json&course=PHY202" \
     -H "Content-Type: application/json" \
     -d '{"prompt":"Solve question 3 the way our notes do"}'

# turn the resource search off for one call
... /api/public/ask?use_resources=0
```

With `?format=json` the reply also carries `sources` — the document, section and
page that contributed to the answer.

DeepSeek is the primary provider for both vision and reasoning; Gemini is only a
fallback if DeepSeek is unavailable.
