import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  image_b64: z.string().min(100),
  contextText: z.string().max(12000).optional(),
  model: z.enum(["flash", "pro", "auto"]).optional(),
});

type Parsed = {
  title?: string;
  summary?: string;
  steps?: string[];
  extractedText?: string;
  confidence?: number;
};

const SYSTEM_PROMPT = `You are an elite OCR engine AND a patient tutor for math, physics, chemistry, biology, and reading. You receive a photo taken by a fixed-focus ESP32 OV3660 camera of an A4 page, notebook, whiteboard or screen. The image MAY be slightly blurry, slightly tilted, dim, low-contrast, perspective-skewed, or unevenly lit — DO NOT give up. Real OCR engines extract text from worse scans every day; you must do the same.

The page MAY contain any combination of:
  * printed text
  * handwritten notes
  * mathematical expressions (algebra, calculus, matrices, fractions, exponents, integrals, sums)
  * graphs, function plots, geometry diagrams
  * tables, multi-column layouts
  * exam questions with multiple parts (1a, 1b, 2…)

WORK IN FOUR STAGES SILENTLY BEFORE WRITING THE JSON:

Stage 1 — OCR PASS. Read every visible character, line by line, left to right, top to bottom. Include numbers, operators (+ − × ÷ = ^ √ ∫ ∑), Greek letters, units, sub/superscripts, and handwritten marks. Reconstruct partially-occluded characters from context. Only write [?] when a glyph is truly unreadable. If text is unclear, infer using nearby context.

Stage 2 — STRUCTURE PASS. Detect equations vs prose vs multi-part problems. Preserve line breaks in extractedText. For every math expression, also produce a LaTeX version inside extractedText using $...$ delimiters. Describe any graph (axes, curve shape, key points) or table (rows × cols, headers) in plain words.

Stage 3 — SOLVE / EXPLAIN PASS. Identify the task (transcribe, solve, explain, prove, plot, classify…). If class material is provided, FOLLOW ITS METHOD exactly. Show the reasoning, not just the answer.

Stage 4 — ANSWER PASS. State the final answer(s) explicitly. For multi-part questions, answer every part.

ONLY return a "cannot read" response if the page is truly empty / black / a finger / pointed at the floor. In that case put 3 short retake tips in steps.

Return ONLY JSON in this exact shape:
{"title":"short title (max 8 words)","summary":"one sentence","steps":["sentence 1","sentence 2"],"extractedText":"verbatim text read off the page with line breaks; math in LaTeX $...$","confidence":0.0_to_1.0}

Rules for steps:
- Each step is ONE clear spoken sentence (10-25 words).
- Speak math out loud — "x squared plus 3 x minus 4 equals zero", never "^" or "*" or "$".
- 4 to 14 steps. The last step states the final answer for every part of the question.
- No markdown, no latex, no bullets, no emojis in steps (LaTeX only allowed inside extractedText).

confidence = how confident you are in the OCR (0.0 = nothing readable, 1.0 = perfect read).`;

async function callGateway(
  modelId: string,
  data: { image_b64: string; contextText?: string },
  key: string,
): Promise<Parsed> {
  const body = {
    model: modelId,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `OCR this image FIRST (read every character you can see), then solve or explain.${data.contextText?.trim() ? `\n\nClass material to follow:\n${data.contextText.trim()}` : ""}`,
          },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${data.image_b64}` },
          },
        ],
      },
    ],
    response_format: { type: "json_object" },
  };

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("Rate limited. Try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in workspace billing.");
    throw new Error(`AI error ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : { steps: [content] };
  }
}

function isWeakResult(p: Parsed): boolean {
  const text = (p.extractedText ?? "").trim();
  const conf = typeof p.confidence === "number" ? p.confidence : 1;
  // Weak if OCR returned almost nothing, or the model itself flagged low confidence,
  // or the steps look like a "cannot read" boilerplate.
  if (text.length < 6) return true;
  if (conf < 0.55) return true;
  const joined = (p.steps ?? []).join(" ").toLowerCase();
  if (
    joined.includes("unreadable") ||
    joined.includes("cannot read") ||
    joined.includes("too blurry") ||
    joined.includes("could not read")
  ) {
    return true;
  }
  return false;
}

export const analyzeImage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const mode = data.model ?? "auto";
    const flashId = "google/gemini-2.5-flash";
    const proId = "google/gemini-2.5-pro";

    // Explicit override paths
    if (mode === "flash") {
      const p = await callGateway(flashId, data, key);
      return finalize(p, flashId, false);
    }
    if (mode === "pro") {
      const p = await callGateway(proId, data, key);
      return finalize(p, proId, false);
    }

    // AUTO: try Flash first. If the read is weak, escalate to Pro silently.
    let used = flashId;
    let result = await callGateway(flashId, data, key);
    let escalated = false;
    if (isWeakResult(result)) {
      try {
        const proResult = await callGateway(proId, data, key);
        // Only swap if Pro actually read more characters.
        const flashLen = (result.extractedText ?? "").trim().length;
        const proLen = (proResult.extractedText ?? "").trim().length;
        if (proLen >= flashLen) {
          result = proResult;
          used = proId;
          escalated = true;
        }
      } catch {
        // Keep flash result if Pro fails (rate limit, etc.)
      }
    }
    return finalize(result, used, escalated);
  });

function finalize(parsed: Parsed, modelUsed: string, escalated: boolean) {
  const steps = (parsed.steps ?? []).filter(
    (s) => typeof s === "string" && s.trim().length > 0,
  );
  return {
    title: parsed.title ?? "Result",
    summary: parsed.summary ?? "",
    steps:
      steps.length > 0
        ? steps
        : ["I could not read the image clearly. Please try a sharper photo."],
    extractedText: parsed.extractedText ?? "",
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
    modelUsed,
    escalated,
  };
}
