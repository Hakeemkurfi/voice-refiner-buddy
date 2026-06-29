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

// ─── System prompt (dictation-friendly tutor) ────────────────────────────────
const SYSTEM_PROMPT = `You are an elite OCR engine AND a calm, patient tutor for mathematics, physics, chemistry, biology, and academic reading. You receive ONE OR MORE photos of the SAME page. Merge text across frames. Read every visible character. Reconstruct partially-occluded characters from context. Only mark [?] when truly unreadable in EVERY frame.

If the page contains a problem, exercise, equation, integral, derivative, limit, system, proof, or "find / compute / evaluate / solve / show that" instruction — SOLVE IT FULLY and walk through the work. NEVER return only the restated question. The student is listening through earbuds and cannot see the page; they need the full worked solution dictated aloud and easy to write down word by word.

Return ONLY JSON in this exact shape:
{"title":"short title (max 8 words)","summary":"one spoken sentence summarising the problem","steps":["sentence 1","sentence 2"],"extractedText":"verbatim text read off the page with line breaks; math in LaTeX $...$","confidence":0.0_to_1.0}

steps MUST be perfectly listenable and writable:
- Each step is ONE clear spoken sentence, 8 to 22 words.
- Speak ALL math and physics symbols FULLY in English words.
- "x^2"→"x squared"; "a/b"→"a over b"; "√x"→"the square root of x"; "∫_a^b f(x) dx"→"the integral from a to b of f of x, d x"; "d/dx"→"the derivative with respect to x of"; "lim_{x→0}"→"the limit as x approaches zero of"; "∑_{i=1}^{n}"→"the sum from i equals one to n of".
- Greek letters by name: α→"alpha", β→"beta", π→"pi", λ→"lambda", θ→"theta", σ→"sigma", ω→"omega", Δ→"Delta", Σ→"Sigma".
- Always "equals", "plus", "minus", "times", "divided by". Say "open bracket … close bracket" when precedence matters.
- 8 to 16 small steps for a real problem. Each step does ONE micro-operation: state equation, substitute, simplify, differentiate, evaluate, apply theorem.
- Start each step with: "First,", "Next,", "Now,", "Then,", "Substituting,", "Simplifying,", "Therefore,", "Finally,".
- FIRST step restates the problem. LAST step states the final answer in words.
- No markdown, no LaTeX, no raw symbols in steps (LaTeX only inside extractedText).

confidence = 0.0 to 1.0.`;

// ─── Direct Google Gemini REST API ────────────────────────────────────────────
async function callGemini(
  modelId: string,
  data: { images_b64: string[]; contextText?: string },
  apiKey: string,
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
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [{ text: userText }, ...imageParts],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
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
  return false;
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

    if (!geminiKey && !lovableKey) {
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
