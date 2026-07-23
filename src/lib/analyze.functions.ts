import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  image_b64: z.string().min(0).optional(),
  burst_id: z.string().uuid().optional(),
  contextText: z.string().max(12000).optional(),
  model: z.enum(["flash", "pro", "auto", "deepseek"]).optional(),
});

type Parsed = {
  title?: string;
  summary?: string;
  steps?: string[];
  extractedText?: string;
  confidence?: number;
};

// ─── System prompt (dictation-friendly tutor) ────────────────────────────────
const SYSTEM_PROMPT = `You are an elite OCR engine AND a calm, patient physics/math tutor dictating to a student who is WALKING with earbuds and cannot see the page. The page contains problems from: rigid body rotation about a fixed axis, vibrations and waves, or wave optics. Read the page, then SOLVE — never just transcribe.

HARD RULE: If the page contains ANY question, exercise, problem, multiple-choice item, "find/show/calculate/prove/derive/determine", numbered items, or a question mark — you MUST produce a full worked solution with a final numeric or symbolic answer for EVERY one. Returning only a restatement, only the extracted text, or steps that end without an answer is FORBIDDEN and counts as a failure. If a value is missing from the page, assume a reasonable standard value (state the assumption) and still deliver a numeric answer. Never say "cannot solve", "insufficient information", or "would need more data" — always attempt and commit to an answer.


Return ONLY JSON:
{"title":"short title (max 8 words)","summary":"one short spoken sentence naming the topic","steps":["sentence 1","sentence 2"],"extractedText":"verbatim text with line breaks; math in LaTeX $...$","confidence":0.0_to_1.0}

DICTATION RULES for the "steps" array — these are spoken aloud in order and MUST be memorizable while walking:

1. If the page has MULTIPLE questions, handle EVERY question, one after another, in the same "steps" array. Between two questions insert one short step: "Next question, number two." (or three, four, …).

2. For EACH question follow this exact spoken structure:
   a. "Question <N>. In short, <one-sentence plain-English restatement of what is asked>." Keep the restatement under 18 words.
   b. If MULTIPLE CHOICE (options A/B/C/D/E visible):
        - Step 2: "The answer is <letter>."
        - Then 2 to 4 SHORT proof steps: name the formula, plug in numbers, get the value, match the option. Keep it brief — this is memorization mode.
        - Final step for that question: "So option <letter> is correct."
   c. If COMPUTATIONAL / show-that / derive (no options):
        - Step 2: "Formula: <state the formula in words>."
        - Step 3: "Values: <list each symbol equals number with unit>."
        - Then 4 to 10 small dictation steps: substitute, simplify, compute, keep units.
        - Second-last step: "Therefore, <quantity> equals <number> <unit>."
        - Last step: "Check: <one-line sanity check on units or magnitude>."

3. Speech style — natural, calm, formal, unhurried, tutor-like. Never rushed, never robotic.
   - Each step ONE sentence, 6 to 22 words.
   - Speak ALL math/physics symbols in full English words:
     "x^2"→"x squared"; "a/b"→"a over b"; "√x"→"the square root of x";
     "ω"→"omega"; "α"→"alpha"; "θ"→"theta"; "π"→"pi"; "λ"→"lambda"; "Δ"→"delta"; "Σ"→"sigma";
     "I"→"moment of inertia I"; "τ"→"torque tau"; "rad/s"→"radians per second";
     "rad/s^2"→"radians per second squared"; "N·m"→"newton meters"; "kg·m^2"→"kilogram meter squared";
     "Hz"→"hertz"; "nm"→"nanometers"; "μm"→"micrometers".
   - Always say "equals", "plus", "minus", "times", "divided by".
   - Start steps with: "First,", "Next,", "Now,", "Then,", "Substituting,", "Therefore,", "Finally,", "Check,".
   - No markdown, no LaTeX, no raw symbols anywhere inside steps (LaTeX only in extractedText).

4. Keep memorization in mind: prefer short, punchy sentences the student can repeat once and remember. Do NOT pad, do NOT re-read the question, do NOT explain theory that was not asked.

confidence = 0.0 to 1.0 — how sure you are of the reading AND the answer.`;

// ─── OCR-only prompt used when DeepSeek is the solver layer ───────────────────
const OCR_PROMPT = `You are an elite OCR engine. Extract every word, number, symbol, and equation from the image exactly as it appears. Preserve line breaks and structure. The page contains physics problems: rigid body rotation about a fixed axis, vibrations and waves, or wave optics.

Return ONLY JSON:
{"title":"short title (max 8 words)","summary":"one spoken sentence naming the topic","extractedText":"verbatim text with line breaks; math in LaTeX $...$","confidence":0.0_to_1.0}

Do NOT solve the problems. Do NOT explain. Only extract text faithfully.`;

// ─── DeepSeek solver prompt (text-only after Gemini OCR) ───────────────────────
const DEEPSEEK_SOLVER_PROMPT = `You are a calm, patient physics/math tutor dictating to a student who is WALKING with earbuds and cannot see the page. You are given the exact text of a physics page. The page contains problems from: rigid body rotation about a fixed axis, vibrations and waves, or wave optics.

HARD RULE: If the text contains ANY question, exercise, problem, multiple-choice item, "find/show/calculate/prove/derive/determine", numbered items, or a question mark — you MUST produce a full worked solution with a final numeric or symbolic answer for EVERY one. Returning only a restatement, only the extracted text, or steps that end without an answer is FORBIDDEN. If a value is missing, assume a reasonable standard value (state the assumption) and still deliver a numeric answer. Never say "cannot solve", "insufficient information", or "would need more data".

Return ONLY JSON:
{"title":"short title (max 8 words)","summary":"one short spoken sentence naming the topic","steps":["sentence 1","sentence 2"],"extractedText":"echo the input text verbatim","confidence":0.0_to_1.0}

DICTATION RULES for the "steps" array — these are spoken aloud in order and MUST be memorizable while walking:

1. If the page has MULTIPLE questions, handle EVERY question, one after another, in the same "steps" array. Between two questions insert one short step: "Next question, number two." (or three, four, …).

2. For EACH question follow this exact spoken structure:
   a. "Question <N>. In short, <one-sentence plain-English restatement of what is asked>." Keep the restatement under 18 words.
   b. If MULTIPLE CHOICE (options A/B/C/D/E visible):
        - Step 2: "The answer is <letter>."
        - Then 2 to 4 SHORT proof steps: name the formula, plug in numbers, get the value, match the option.
        - Final step for that question: "So option <letter> is correct."
   c. If COMPUTATIONAL / show-that / derive (no options):
        - Step 2: "Formula: <state the formula in words>."
        - Step 3: "Values: <list each symbol equals number with unit>."
        - Then 4 to 10 small dictation steps: substitute, simplify, compute, keep units.
        - Second-last step: "Therefore, <quantity> equals <number> <unit>."
        - Last step: "Check: <one-line sanity check on units or magnitude."

3. Speech style — natural, calm, formal, unhurried, tutor-like. Never rushed, never robotic.
   - Each step ONE sentence, 6 to 22 words.
   - Speak ALL math/physics symbols in full English words:
     "x^2"→"x squared"; "a/b"→"a over b"; "√x"→"the square root of x";
     "ω"→"omega"; "α"→"alpha"; "θ"→"theta"; "π"→"pi"; "λ"→"lambda"; "Δ"→"delta"; "Σ"→"sigma";
     "I"→"moment of inertia I"; "τ"→"torque tau"; "rad/s"→"radians per second";
     "rad/s^2"→"radians per second squared"; "N·m"→"newton meters"; "kg·m^2"→"kilogram meter squared";
     "Hz"→"hertz"; "nm"→"nanometers"; "μm"→"micrometers".
   - Always say "equals", "plus", "minus", "times", "divided by".
   - Start steps with: "First,", "Next,", "Now,", "Then,", "Substituting,", "Therefore,", "Finally,", "Check,".
   - No markdown, no LaTeX, no raw symbols anywhere inside steps (LaTeX only in extractedText).

4. Keep memorization in mind: prefer short, punchy sentences the student can repeat once and remember. Do NOT pad, do NOT re-read the question, do NOT explain theory that was not asked.

confidence = 0.0 to 1.0 — how sure you are of the final answer.`;

// ─── Direct Google Gemini REST API ────────────────────────────────────────────
async function callGemini(
  modelId: string,
  data: { images_b64: string[]; contextText?: string },
  apiKey: string,
  prompt: string = SYSTEM_PROMPT,
): Promise<Parsed> {
  const imageParts = data.images_b64.map((b64) => ({
    inlineData: { mimeType: "image/jpeg", data: b64 },
  }));

  const userText =
    (data.images_b64.length > 1
      ? `I am giving you ${data.images_b64.length} frames of the SAME page. Merge the text across all frames.`
      : "OCR this image, then solve or explain.") +
    (data.contextText?.trim()
      ? `\n\nClass material to follow:\n${data.contextText.trim()}`
      : "");

  const geminiModelMap: Record<string, string[]> = {
    flash: [
      "gemini-2.5-flash-lite",
      "gemini-2.0-flash-lite",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-1.5-flash-8b",
      "gemini-1.5-flash",
    ],
    pro: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash-lite"],
  };
  const modelCandidates = geminiModelMap[modelId === "pro" ? "pro" : "flash"];

  const body = {
    systemInstruction: { parts: [{ text: prompt }] },
    contents: [
      {
        role: "user",
        parts: [{ text: userText }, ...imageParts],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",

    },
  };

  let lastError = "Gemini request failed.";
  for (const model of modelCandidates) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify(body),
      },
    ).catch((error) => {
      lastError = `Gemini ${model} timed out: ${(error as Error).message}`;
      return null;
    });

    if (!res) continue;

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429 || res.status === 503 || res.status === 500) {
        lastError = geminiErrorMessage(res.status, model, text);
        continue;
      }
      if (res.status === 400 && text.toLowerCase().includes("not found")) {
        lastError = `Gemini model ${model} not available; trying another.`;
        continue;
      }
      if (res.status === 400 && text.toLowerCase().includes("api key")) {
        throw new Error("Invalid GEMINI_API_KEY. Update it in project secrets.");
      }
      throw new Error(`Gemini API error ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const content = json.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("\n")
      .trim() ?? "{}";
    const parsed = safeParseJsonObject(content);
    return parsed ?? { steps: [content.slice(0, 500)] };
  }

  throw new Error(lastError);
}

function geminiErrorMessage(status: number, model: string, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { status?: string; message?: string } };
    const statusText = parsed.error?.status ? ` ${parsed.error.status}` : "";
    const message = parsed.error?.message?.replace(/\s+/g, " ").trim();
    if (message) return `Gemini ${model} HTTP ${status}${statusText}: ${message}`;
  } catch { /* ignore */ }
  const clean = body.replace(/\s+/g, " ").trim().slice(0, 300);
  return `Gemini ${model} HTTP ${status}${clean ? `: ${clean}` : ""}`;
}

// ─── OpenAI vision via Lovable AI Gateway (last-resort fallback) ─────────────
async function callOpenAIViaGateway(
  data: { images_b64: string[]; contextText?: string },
  lovableKey: string,
): Promise<Parsed> {
  const userText =
    (data.images_b64.length > 1
      ? `${data.images_b64.length} frames of the SAME page — merge the text.`
      : "OCR this image, then solve or explain.") +
    (data.contextText?.trim() ? `\n\nClass material:\n${data.contextText.trim()}` : "");

  const imageBlocks = data.images_b64.map((b64) => ({
    type: "image_url" as const,
    image_url: { url: `data:image/jpeg;base64,${b64}` },
  }));

  // gpt-5-nano = cheapest vision-capable on the gateway
  const body = {
    model: "openai/gpt-5-nano",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [{ type: "text", text: userText }, ...imageBlocks],
      },
    ],
    response_format: { type: "json_object" },
  };

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Lovable-API-Key": lovableKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(25000),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenAI gateway HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content ?? "{}";
  return safeParseJsonObject(content) ?? { steps: [content.slice(0, 500)] };
}

// ─── JSON parser ─────────────────────────────────────────────────────────────
function safeParseJsonObject(raw: string): Parsed | null {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(s) as Parsed; } catch { /* */ }
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
  // SOLVE ENFORCEMENT: if the page clearly contains questions but the steps
  // never state an answer/result, treat as weak (model only transcribed).
  const looksLikeQuestions =
    /(?:^|\n)\s*(?:\d+[.)]|\(\d+\)|question)/i.test(text) ||
    /[?？]/.test(text);
  const hasSolution =
    /the answer is|answer:|option [a-e]\b|therefore|equals|is correct|so the/i.test(joined);
  if (looksLikeQuestions && (p.steps ?? []).length > 0 && !hasSolution) return true;
  return false;
}

function isWeakOCR(p: Parsed): boolean {
  const text = (p.extractedText ?? "").trim();
  const conf = typeof p.confidence === "number" ? p.confidence : 1;
  if (text.length < 6) return true;
  if (conf < 0.55) return true;
  return false;
}

async function callGeminiOCR(
  modelId: "flash" | "pro",
  data: { images_b64: string[]; contextText?: string },
  apiKey: string,
): Promise<Parsed> {
  return callGemini(modelId, data, apiKey, OCR_PROMPT);
}

// ─── DeepSeek solver (text-only) ─────────────────────────────────────────────
async function solveWithDeepSeek(
  extractedText: string,
  contextText: string | undefined,
  apiKey: string,
): Promise<Parsed> {
  const userContent =
    `Extracted page text:\n---\n${extractedText.trim()}\n---` +
    (contextText?.trim() ? `\n\nClass material to follow:\n${contextText.trim()}` : "");

  const body = {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: DEEPSEEK_SOLVER_PROMPT },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 4096,
  };

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify(body),
  }).catch((error) => {
    throw new Error(`DeepSeek request failed: ${(error as Error).message}`);
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    if (res.status === 401) {
      throw new Error("Invalid DEEPSEEK_API_KEY. Update it in project secrets.");
    }
    if (res.status === 402) {
      throw new Error("DeepSeek account out of credits. Top up at platform.deepseek.com.");
    }
    if (res.status === 429) {
      throw new Error("DeepSeek rate limit hit. Please retry in a few seconds.");
    }
    throw new Error(`DeepSeek API error ${res.status}: ${txt.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content ?? "{}";
  return safeParseJsonObject(content) ?? {
    title: "DeepSeek result",
    summary: "",
    steps: [content.slice(0, 500)],
    extractedText,
    confidence: 0.5,
  };
}

// Try Gemini first; on full chain failure, fall back to OpenAI via gateway.
async function callWithFallback(
  modelId: "flash" | "pro",
  data: { images_b64: string[]; contextText?: string },
  geminiKey: string | undefined,
  lovableKey: string | undefined,
): Promise<{ parsed: Parsed; provider: string }> {
  if (geminiKey) {
    try {
      const parsed = await callGemini(modelId, data, geminiKey);
      return { parsed, provider: `gemini-${modelId}` };
    } catch (e) {
      if (!lovableKey) throw e;
      // fall through to gateway
    }
  }
  if (lovableKey) {
    const parsed = await callOpenAIViaGateway(data, lovableKey);
    return { parsed, provider: "openai/gpt-5-nano" };
  }
  throw new Error(
    "No working AI provider. Set GEMINI_API_KEY in secrets, or use Lovable AI.",
  );
}

// ─── Main server function ────────────────────────────────────────────────────
export const analyzeImage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }) => {
    const geminiKey = process.env.GEMINI_API_KEY;
    const lovableKey = process.env.LOVABLE_API_KEY;
    const deepseekKey = process.env.DEEPSEEK_API_KEY;

    if (!geminiKey && !lovableKey && !deepseekKey) {
      throw new Error(
        "No API key set. Add GEMINI_API_KEY in project secrets (or enable Lovable AI).",
      );
    }

    // ----- Resolve images -----
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

    const mode = data.model ?? "auto";

    // ── COST SAVER: Flash uses ONLY the sharpest single frame ──
    // Multi-frame is reserved for Pro escalation when Flash result is weak.
    const flashPayload = { images_b64: images_b64.slice(0, 1), contextText: data.contextText };
    const proPayload = { images_b64: images_b64.slice(0, 3), contextText: data.contextText };

    // ── DEEPSEEK BRANCH ───────────────────────────────────────────────────────
    // DeepSeek is text-only and cannot read images. So we first use Gemini for
    // OCR only (fast + cheap), then DeepSeek solves & produces the dictation.
    // This uses your paid DeepSeek balance instead of Lovable AI credits.
    if (deepseekKey && geminiKey && (mode === "deepseek" || mode === "auto")) {
      try {
        let ocr = await callGeminiOCR("flash", flashPayload, geminiKey);
        if (isWeakOCR(ocr)) {
          const ocrPro = await callGeminiOCR("pro", proPayload, geminiKey);
          if ((ocrPro.extractedText ?? "").trim().length > (ocr.extractedText ?? "").trim().length) {
            ocr = ocrPro;
          }
        }
        const solved = await solveWithDeepSeek(
          ocr.extractedText ?? "",
          data.contextText,
          deepseekKey,
        );
        return finalize(
          {
            ...solved,
            extractedText: ocr.extractedText ?? solved.extractedText ?? "",
            confidence: typeof solved.confidence === "number" ? solved.confidence : ocr.confidence,
          },
          "deepseek-chat",
          false,
          flashPayload.images_b64.length,
        );
      } catch (e) {
        // If DeepSeek branch fails, fall through to the normal Gemini flow.
        console.warn("DeepSeek branch failed:", (e as Error).message);
      }
    }

    if (mode === "flash") {
      const { parsed, provider } = await callWithFallback("flash", flashPayload, geminiKey, lovableKey);
      return finalize(parsed, provider, false, flashPayload.images_b64.length);
    }
    if (mode === "pro") {
      const { parsed, provider } = await callWithFallback("pro", proPayload, geminiKey, lovableKey);
      return finalize(parsed, provider, false, proPayload.images_b64.length);
    }

    // AUTO: Flash + 1 frame first; only escalate to Pro + multi-frame if weak.
    let { parsed: result, provider: used } = await callWithFallback(
      "flash", flashPayload, geminiKey, lovableKey,
    );
    let escalated = false;
    let framesUsed = flashPayload.images_b64.length;

    if (isWeakResult(result)) {
      try {
        const pro = await callWithFallback("pro", proPayload, geminiKey, lovableKey);
        const flashLen = (result.extractedText ?? "").trim().length;
        const proLen = (pro.parsed.extractedText ?? "").trim().length;
        if (proLen >= flashLen) {
          result = pro.parsed;
          used = pro.provider;
          escalated = true;
          framesUsed = proPayload.images_b64.length;
        }
      } catch {
        // keep Flash result
      }
    }

    return finalize(result, used, escalated, framesUsed);
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
