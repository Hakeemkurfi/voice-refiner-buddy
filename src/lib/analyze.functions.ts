import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  image_b64: z.string().min(0).optional(),
  burst_id: z.string().uuid().optional(),
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

const SYSTEM_PROMPT = `You are an elite OCR engine AND a calm, patient tutor for math, physics, chemistry, biology, and reading. You receive ONE OR MORE photos taken by a fixed-focus ESP32 OV3660 camera of the SAME A4 page, notebook, whiteboard, screen or textbook. When you receive multiple images, they are different frames of the SAME document captured over a few seconds — your job is to MERGE the text across all frames, taking the clearest reading of each character from whichever frame shows it best. Frames may be slightly blurry, slightly tilted, dim, low-contrast, perspective-skewed, or unevenly lit — DO NOT give up.

The page MAY contain any combination of: printed text, handwritten notes, mathematical expressions (algebra, calculus, matrices, fractions, exponents, integrals, sums, limits, derivatives, series), graphs, function plots, geometry diagrams, tables, multi-column layouts, exam questions with multiple parts (1a, 1b, 2…).

WORK IN FOUR STAGES SILENTLY BEFORE WRITING THE JSON:

Stage 1 — OCR PASS. Read every visible character, line by line, left to right, top to bottom, across all provided frames. When the same line appears in several frames, prefer the sharpest reading. Include numbers, operators (+ − × ÷ = ^ √ ∫ ∑ ∂ lim), Greek letters, units, sub/superscripts, and handwritten marks. Reconstruct partially-occluded characters from context. Only write [?] when a glyph is truly unreadable in EVERY provided frame.

Stage 2 — STRUCTURE PASS. Detect equations vs prose vs multi-part problems. Preserve line breaks in extractedText. For every math expression, also produce a LaTeX version inside extractedText using $...$ delimiters. Describe any graph (axes, curve shape, key points) or table (rows × cols, headers) in plain words.

Stage 3 — SOLVE / EXPLAIN PASS. Identify the task (transcribe, solve, explain, prove, plot, classify…). If class material is provided, FOLLOW ITS METHOD AND NOTATION exactly. Think through the steps internally and double-check arithmetic, signs, exponents and limits of integration. Re-derive each step before writing it.
CRITICAL: If the page contains a problem, an exercise, an equation, an integral, a derivative, a limit, a system, a proof, a "find / compute / evaluate / solve / show that" instruction — you MUST SOLVE IT FULLY and walk through the work. NEVER return only the restated question. NEVER stop after reading the problem. The student is blind to the page; they need the full worked solution dictated aloud. If the task is ambiguous (e.g. "discuss"), pick the most likely interpretation and solve it; mention the assumption in step 2.

Stage 4 — ANSWER PASS. State the final answer(s) explicitly. For multi-part questions, answer every part.

ONLY return a "cannot read" response if EVERY provided frame is truly empty / black / a finger / pointed at the floor. In that case put 3 short retake tips in steps.

Return ONLY JSON in this exact shape:
{"title":"short title (max 8 words)","summary":"one spoken sentence summarising the problem","steps":["sentence 1","sentence 2"],"extractedText":"verbatim text read off the page with line breaks; math in LaTeX $...$","confidence":0.0_to_1.0}

VERY IMPORTANT — steps MUST be perfectly listenable, because they are read aloud through text-to-speech and the student WRITES THEM DOWN by ear:
- Each step is ONE clear spoken sentence, 8 to 22 words.
- Speak math FULLY in English words, the way a tutor dictates on the phone. Never read raw symbols.
  * "x^2" → "x squared"; "x^3" → "x cubed"; "x^n" → "x to the power n"
  * "a/b" → "a over b"; "sqrt(x)" → "the square root of x"
  * "∫_a^b f(x) dx" → "the integral, from a to b, of f of x, d x"
  * "d/dx" → "the derivative with respect to x of"
  * "lim_{x→0}" → "the limit, as x approaches zero, of"
  * "∑_{i=1}^{n}" → "the sum, from i equals one to n, of"
  * "sin x" → "sine of x"; "cos x" → "cosine of x"; "ln x" → "natural log of x"
  * "π" → "pi"; "θ" → "theta"; "∞" → "infinity"; "≈" → "approximately equals"
  * Always say "equals" for =, "plus" for +, "minus" for −, "times" for ×, "divided by" for ÷.
  * Use the words "open bracket … close bracket" when precedence matters.
- Break work into MANY small steps (8 to 16 steps for a real problem) so the listener can keep up and write each line. Each step does ONE micro-operation: state the equation, factor, substitute, simplify, differentiate, evaluate at a bound, etc.
- Start each step with a short cue word: "First,", "Next,", "Now,", "Then,", "Substituting,", "Simplifying,", "Finally,".
- The FIRST step restates the problem in spoken form. The LAST step states the final answer for every part, also spoken in words.
- No markdown, no LaTeX, no raw symbols, no bullets, no emojis inside steps (LaTeX is allowed ONLY inside extractedText).

confidence = how confident you are in the merged OCR + solution (0.0 = nothing readable, 1.0 = perfect).`;


async function callGateway(
  modelId: string,
  data: { images_b64: string[]; contextText?: string },
  key: string,
): Promise<Parsed> {
  const imageBlocks = data.images_b64.map((b64) => ({
    type: "image_url" as const,
    image_url: { url: `data:image/jpeg;base64,${b64}` },
  }));

  const body = {
    model: modelId,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `${data.images_b64.length > 1 ? `I am giving you ${data.images_b64.length} frames of the SAME page. Merge the text across all frames.` : "OCR this image FIRST (read every character you can see), then solve or explain."}` +
              `${data.contextText?.trim() ? `\n\nClass material to follow:\n${data.contextText.trim()}` : ""}`,
          },
          ...imageBlocks,
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
  const parsed = safeParseJsonObject(content);
  return parsed ?? { steps: [content.slice(0, 500)] };
}

// Gemini sometimes returns a JSON object followed by extra prose (markdown,
// "```json" fences, a second object, etc.) which breaks JSON.parse with
// "Unexpected non-whitespace character after JSON at position N". Walk through
// braces and return the first balanced object that parses cleanly.
function safeParseJsonObject(raw: string): Parsed | null {
  if (!raw) return null;
  let s = raw.trim();
  // strip ```json ... ``` fences
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(s) as Parsed;
  } catch {
    /* fall through */
  }
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1)) as Parsed;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function isWeakResult(p: Parsed): boolean {
  const text = (p.extractedText ?? "").trim();
  const conf = typeof p.confidence === "number" ? p.confidence : 1;
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

    // ----- Resolve images: either a single inline base64, or a burst id -----
    let images_b64: string[] = [];
    if (data.burst_id) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: burst } = await supabaseAdmin
        .from("bursts")
        .select("picked_seqs")
        .eq("id", data.burst_id)
        .maybeSingle();
      const picked = burst?.picked_seqs ?? [];
      if (picked.length > 0) {
        const { data: frames } = await supabaseAdmin
          .from("burst_frames")
          .select("seq, image_b64")
          .eq("burst_id", data.burst_id)
          .in("seq", picked);
        images_b64 = (frames ?? [])
          .sort((a, b) => a.seq - b.seq)
          .map((f) => f.image_b64);
      }
      // Fallback: top 3 by sharpness if no picked_seqs yet
      if (images_b64.length === 0) {
        const { data: frames } = await supabaseAdmin
          .from("burst_frames")
          .select("seq, image_b64, sharpness")
          .eq("burst_id", data.burst_id)
          .order("sharpness", { ascending: false })
          .limit(3);
        images_b64 = (frames ?? []).map((f) => f.image_b64);
      }
    }
    if (images_b64.length === 0 && data.image_b64 && data.image_b64.length > 100) {
      images_b64 = [data.image_b64];
    }
    if (images_b64.length === 0) {
      throw new Error("No image provided (need image_b64 or burst_id)");
    }

    const mode = data.model ?? "auto";
    const flashId = "google/gemini-2.5-flash";
    const proId = "google/gemini-2.5-pro";

    const payload = { images_b64, contextText: data.contextText };

    if (mode === "flash") {
      const p = await callGateway(flashId, payload, key);
      return finalize(p, flashId, false, images_b64.length);
    }
    if (mode === "pro") {
      const p = await callGateway(proId, payload, key);
      return finalize(p, proId, false, images_b64.length);
    }

    // AUTO
    let used = flashId;
    let result = await callGateway(flashId, payload, key);
    let escalated = false;
    if (isWeakResult(result)) {
      try {
        const proResult = await callGateway(proId, payload, key);
        const flashLen = (result.extractedText ?? "").trim().length;
        const proLen = (proResult.extractedText ?? "").trim().length;
        if (proLen >= flashLen) {
          result = proResult;
          used = proId;
          escalated = true;
        }
      } catch {
        /* keep flash */
      }
    }

    // Kimi verification pass — cross-check math & step quality (text-only, fast)
    const verified = await kimiVerify(result, data.contextText).catch(() => result);
    return finalize(verified, used, escalated, images_b64.length, verified !== result);
  });

const KIMI_VERIFIER_PROMPT = `You are a meticulous math/physics grader and TTS-script editor. You will receive a JSON object produced by another AI that solved a problem from a student's photo, plus the verbatim text the OCR engine read off the page. Your job:
1) Recompute the math silently. If any step is wrong (arithmetic, sign, exponent, integration bound, derivative rule, units), FIX it.
2) IF THE DRAFT ONLY RESTATES THE QUESTION WITHOUT SOLVING IT, you MUST produce the full worked solution yourself, from setup to final answer. Never leave a problem unsolved.
3) Make sure every step is ONE clear spoken sentence (8-22 words), starts with a cue word (First/Next/Now/Then/Substituting/Simplifying/Finally), and reads math fully in English words (no raw symbols, no LaTeX, no markdown). Use phrasing like "x squared", "the integral from a to b of f of x d x", "the derivative with respect to x of", "the limit as x approaches zero of".
4) Break work into 8-16 micro-steps so the listener can write each line.
5) The last step must clearly state the final answer in words.
6) Keep extractedText unchanged unless the OCR is obviously wrong; in that case correct it and keep LaTeX inside $...$.
Return ONLY the corrected JSON in the exact same shape: {"title","summary","steps","extractedText","confidence"}. No commentary.`;

async function kimiVerify(parsed: Parsed, contextText?: string): Promise<Parsed> {
  const kimiKey = process.env.KIMI_API_KEY;
  if (!kimiKey) return parsed;
  const body = {
    model: "kimi-k2-0905-preview",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: KIMI_VERIFIER_PROMPT },
      {
        role: "user",
        content:
          `Draft from the first AI (JSON):\n${JSON.stringify(parsed)}\n\n` +
          (contextText?.trim()
            ? `Class material to follow:\n${contextText.trim().slice(0, 6000)}\n\n`
            : "") +
          `Verify the math, fix any error, and rewrite the steps to be perfectly listenable.`,
      },
    ],
  };
  const res = await fetch("https://api.moonshot.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${kimiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return parsed;
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? "";
  try {
    const out = JSON.parse(content) as Parsed;
    if (Array.isArray(out.steps) && out.steps.length > 0) return out;
    return parsed;
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const out = JSON.parse(m[0]) as Parsed;
        if (Array.isArray(out.steps) && out.steps.length > 0) return out;
      } catch {
        /* ignore */
      }
    }
    return parsed;
  }
}


function finalize(parsed: Parsed, modelUsed: string, escalated: boolean, framesUsed: number, kimiVerified = false) {
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
    framesUsed,
    kimiVerified,

  };
}
