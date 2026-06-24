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

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an elite OCR engine AND a calm, patient tutor for mathematics, physics, chemistry, biology, and academic reading. You receive ONE OR MORE photos taken by a fixed-focus ESP32 camera of the SAME A4 page, notebook, whiteboard, screen, or textbook. When you receive multiple images, they are different frames of the SAME document — MERGE the text across all frames, taking the clearest reading of each character from whichever frame shows it best. Frames may be blurry, tilted, dim, low-contrast, perspective-skewed, or unevenly lit — DO NOT give up.

The page MAY contain any combination of: printed text, handwritten notes, mathematical expressions (algebra, calculus, matrices, fractions, exponents, integrals, sums, limits, derivatives, series, vector calculus), graphs, function plots, geometry diagrams, physics equations, circuit diagrams, tables, multi-column layouts, exam questions with multiple parts (1a, 1b, 2…).

WORK IN FOUR STAGES SILENTLY BEFORE WRITING THE JSON:

Stage 1 — OCR PASS. Read every visible character, line by line, left to right, top to bottom, across all provided frames. When the same line appears in several frames, prefer the sharpest reading. Include numbers, operators, Greek letters, units, sub/superscripts, and handwritten marks. Reconstruct partially-occluded characters from context. Only write [?] when a glyph is truly unreadable in EVERY provided frame.

Stage 2 — STRUCTURE PASS. Detect equations vs prose vs multi-part problems. Preserve line breaks in extractedText. For every math or physics expression, produce a LaTeX version inside extractedText using $...$ delimiters. Describe any graph (axes, curve shape, key points) or table (rows × cols, headers) in plain words.

Stage 3 — SOLVE / EXPLAIN PASS. Identify the task (transcribe, solve, explain, prove, plot, classify, derive…). If class material is provided, FOLLOW ITS METHOD AND NOTATION exactly. Think through the steps internally and double-check arithmetic, signs, exponents, and limits. Re-derive each step before writing it.
CRITICAL: If the page contains a problem, exercise, equation, integral, derivative, limit, system, proof, or "find / compute / evaluate / solve / show that" instruction — SOLVE IT FULLY and walk through the work. NEVER return only the restated question. The student is listening through earbuds and cannot see the page; they need the full worked solution dictated aloud.

Stage 4 — ANSWER PASS. State the final answer(s) explicitly. For multi-part questions, answer every part.

ONLY return a "cannot read" response if EVERY provided frame is truly empty / black / a finger / pointed at the floor. In that case put 3 short retake tips in steps.

Return ONLY JSON in this exact shape:
{"title":"short title (max 8 words)","summary":"one spoken sentence summarising the problem","steps":["sentence 1","sentence 2"],"extractedText":"verbatim text read off the page with line breaks; math in LaTeX $...$","confidence":0.0_to_1.0}

VERY IMPORTANT — steps MUST be perfectly listenable, because they are read aloud through text-to-speech and the student WRITES THEM DOWN by ear:
- Each step is ONE clear spoken sentence, 8 to 22 words.
- Speak ALL math and physics symbols FULLY in English words, as a tutor would dictate on the phone. NEVER read raw symbols or LaTeX.

MATHEMATICS symbols — speak like this:
  * "x^2" → "x squared";  "x^3" → "x cubed";  "x^n" → "x to the power n"
  * "a/b" → "a over b"
  * "√x" → "the square root of x"
  * "∫_a^b f(x) dx" → "the integral from a to b of f of x, d x"
  * "∬_R f dA" → "the double integral over region R of f, d A"
  * "∮_C F·dr" → "the line integral around closed curve C of F dot d r"
  * "d/dx" → "the derivative with respect to x of"
  * "∂/∂x" → "the partial derivative with respect to x of"
  * "∂²f/∂x²" → "the second partial derivative of f with respect to x"
  * "lim_{x→0}" → "the limit as x approaches zero of"
  * "lim_{x→∞}" → "the limit as x approaches infinity of"
  * "∑_{i=1}^{n}" → "the sum from i equals one to n of"
  * "∏_{i=1}^{n}" → "the product from i equals one to n of"
  * "∇f" → "the gradient of f"
  * "∇·F" → "the divergence of F"
  * "∇×F" → "the curl of F"
  * "∇²f" → "the Laplacian of f"
  * Always say "equals" for =, "plus" for +, "minus" for −, "times" or "multiplied by" for ×, "divided by" for ÷.
  * Say "open bracket … close bracket" when precedence matters.

GREEK LETTERS — always say the name:
  * α → "alpha";   β → "beta";    γ → "gamma";   δ → "delta";   ε → "epsilon"
  * ζ → "zeta";    η → "eta";     θ → "theta";   ι → "iota";    κ → "kappa"
  * λ → "lambda";  μ → "mu";      ν → "nu";      ξ → "xi";      π → "pi"
  * ρ → "rho";     σ → "sigma";   τ → "tau";     φ → "phi";     χ → "chi"
  * ψ → "psi";     ω → "omega";   Δ → "Delta";   Σ → "Sigma";   Π → "Pi"
  * Γ → "Gamma";   Λ → "Lambda";  Ω → "Omega";   Φ → "Phi";     Ψ → "Psi"

PHYSICS symbols — speak like this:
  * "λ" when wavelength → "lambda" (e.g. "lambda equals c over f")
  * "λ" when eigenvalue → "lambda" (e.g. "lambda sub one")
  * "ℏ" → "h-bar" (reduced Planck constant)
  * "ħ" → "h-bar"
  * "ℏω" → "h-bar times omega"
  * "c" (speed of light) → "the speed of light c"
  * "ε₀" → "epsilon sub zero" (permittivity of free space)
  * "μ₀" → "mu sub zero" (permeability of free space)
  * "k_B" → "Boltzmann constant k sub B"
  * "N_A" → "Avogadro's number N sub A"
  * "e" (charge) → "the elementary charge e"
  * "eV" → "electron volts"
  * "F = ma" → "F equals m times a"
  * "E = mc²" → "E equals m c squared"
  * "E = hf" → "E equals h times f" (Planck)
  * "p = mv" → "p equals m times v"
  * "v̂" (unit vector) → "v hat"
  * "→" over a letter (vector) → say "vector" first: "vector F"
  * "·" (dot product) → "dot"
  * "×" (cross product) → "cross"
  * "≈" → "approximately equals"
  * "∝" → "is proportional to"
  * "≠" → "is not equal to"
  * "∞" → "infinity"
  * "°" → "degrees"
  * "Ω" when resistance → "ohms"

- Break work into MANY small steps (8 to 16 steps for a real problem) so the listener can keep up and write each line. Each step does ONE micro-operation: state the equation, substitute, simplify, differentiate, evaluate at a bound, apply a theorem, etc.
- Start each step with a cue word: "First,", "Next,", "Now,", "Then,", "Substituting,", "Simplifying,", "Applying,", "Evaluating,", "Therefore,", "Finally,".
- The FIRST step restates the problem in spoken form. The LAST step states the final answer for every part, spoken in words.
- No markdown, no LaTeX, no raw symbols, no bullets, no emojis inside steps (LaTeX is allowed ONLY inside extractedText).

confidence = how confident you are in the merged OCR + solution (0.0 = nothing readable, 1.0 = perfect).`;

// ─── DeepSeek API call (OpenAI-compatible, primary provider) ──────────────────
// Real model names: deepseek-chat (V3 fast) and deepseek-reasoner (R1 powerful)
async function callDeepSeek(
  modelId: string,
  data: { images_b64: string[]; contextText?: string },
  apiKey: string,
): Promise<Parsed> {
  const imageBlocks = data.images_b64.map((b64) => ({
    type: "image_url" as const,
    image_url: { url: `data:image/jpeg;base64,${b64}` },
  }));

  const userText =
    (data.images_b64.length > 1
      ? `I am giving you ${data.images_b64.length} frames of the SAME page. Merge the text across all frames.`
      : "OCR this image FIRST (read every character you can see), then solve or explain.") +
    (data.contextText?.trim()
      ? `\n\nClass material to follow:\n${data.contextText.trim()}`
      : "");

  // Real DeepSeek model names (see platform.deepseek.com/api-docs)
  const deepseekModelMap: Record<string, string> = {
    "flash":              "deepseek-chat",      // DeepSeek-V3 — fast, vision-capable
    "pro":               "deepseek-reasoner",   // DeepSeek-R1 — powerful reasoning
    "deepseek-chat":     "deepseek-chat",
    "deepseek-reasoner": "deepseek-reasoner",
  };
  const dsModel = deepseekModelMap[modelId] ?? "deepseek-chat";

  const body = {
    model: dsModel,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          ...imageBlocks,
        ],
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 4096,
  };

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("Rate limited by DeepSeek API. Try again in a moment.");
    if (res.status === 401) throw new Error("Invalid DEEPSEEK_API_KEY. Check your .env file.");
    if (res.status === 402) throw new Error("DeepSeek account has insufficient balance. Top up at platform.deepseek.com.");
    throw new Error(`DeepSeek API error ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? "{}";
  const parsed = safeParseJsonObject(content);
  return parsed ?? { steps: [content.slice(0, 500)] };
}

// ─── Direct Google Gemini REST API (fallback when no DeepSeek key) ────────────
// Gemini fallback removed: DeepSeek is the single provider.

// ─── JSON parser (handles fences & extra prose) ──────────────────────────────
function safeParseJsonObject(raw: string): Parsed | null {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(s) as Parsed; } catch { /* fall through */ }
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
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
        try { return JSON.parse(s.slice(start, i + 1)) as Parsed; } catch { return null; }
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
  ) return true;
  return false;
}

// ─── Route call to the best available provider ───────────────────────────────
// Priority: DeepSeek (faster + cheaper) → Gemini (fallback) → error
async function callGateway(
  modelId: string,
  data: { images_b64: string[]; contextText?: string },
  deepseekKey: string | undefined,
): Promise<Parsed> {
  if (deepseekKey) return callDeepSeek(modelId, data, deepseekKey);
  throw new Error(
    "No AI API key configured. Add DEEPSEEK_API_KEY=sk-... to your .env file."
  );
}

// ─── Main server function ─────────────────────────────────────────────────────
export const analyzeImage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }) => {
    const deepseekKey = process.env.DEEPSEEK_API_KEY ?? process.env.VITE_DEEPSEEK_API_KEY;

    if (!deepseekKey) {
      throw new Error(
        "No API key set. Add DEEPSEEK_API_KEY=sk-... to your .env file. " +
        "Get a key at platform.deepseek.com/api_keys"
      );
    }

    // ----- Resolve images: single inline b64 or burst id -----
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

    const mode    = data.model ?? "auto";
    // Use DeepSeek model IDs
    const flashId = "deepseek-chat";
    const proId   = "deepseek-reasoner";
    const payload = { images_b64, contextText: data.contextText };

    // ── Explicit model selection ──
    if (mode === "flash") {
      const p = await callGateway(flashId, payload, deepseekKey);
      return finalize(p, flashId, false, images_b64.length);
    }
    if (mode === "pro") {
      const p = await callGateway(proId, payload, deepseekKey);
      return finalize(p, proId, false, images_b64.length);
    }

    // ── AUTO: Flash first, escalate to Pro if weak ──
    let used      = flashId;
    let result    = await callGateway(flashId, payload, deepseekKey);
    let escalated = false;

    if (isWeakResult(result)) {
      try {
        const proResult = await callGateway(proId, payload, deepseekKey);
        const flashLen  = (result.extractedText ?? "").trim().length;
        const proLen    = (proResult.extractedText ?? "").trim().length;
        if (proLen >= flashLen) {
          result    = proResult;
          used      = proId;
          escalated = true;
        }
      } catch {
        // Pro also failed — keep Flash result
      }
    }

    return finalize(result, used, escalated, images_b64.length);
  });

function finalize(
  parsed: Parsed,
  modelUsed: string,
  escalated: boolean,
  framesUsed: number,
) {
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
  };
}
