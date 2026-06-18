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

const SYSTEM_PROMPT = `You are an elite OCR engine AND a patient tutor for math, physics, chemistry, biology, and reading. You receive ONE OR MORE photos taken by a fixed-focus ESP32 OV3660 camera of the SAME A4 page, notebook, whiteboard or screen. When you receive multiple images, they are different frames of the SAME document captured over a few seconds — your job is to MERGE the text across all frames, taking the clearest reading of each character from whichever frame shows it best. Frames may be slightly blurry, slightly tilted, dim, low-contrast, perspective-skewed, or unevenly lit — DO NOT give up. Real OCR engines extract text from worse scans every day; you must do the same.

The page MAY contain any combination of:
  * printed text
  * handwritten notes
  * mathematical expressions (algebra, calculus, matrices, fractions, exponents, integrals, sums)
  * graphs, function plots, geometry diagrams
  * tables, multi-column layouts
  * exam questions with multiple parts (1a, 1b, 2…)

WORK IN FOUR STAGES SILENTLY BEFORE WRITING THE JSON:

Stage 1 — OCR PASS. Read every visible character, line by line, left to right, top to bottom, across all provided frames. When the same line appears in several frames, prefer the sharpest reading. Include numbers, operators (+ − × ÷ = ^ √ ∫ ∑), Greek letters, units, sub/superscripts, and handwritten marks. Reconstruct partially-occluded characters from context. Only write [?] when a glyph is truly unreadable in EVERY provided frame.

Stage 2 — STRUCTURE PASS. Detect equations vs prose vs multi-part problems. Preserve line breaks in extractedText. For every math expression, also produce a LaTeX version inside extractedText using $...$ delimiters. Describe any graph (axes, curve shape, key points) or table (rows × cols, headers) in plain words.

Stage 3 — SOLVE / EXPLAIN PASS. Identify the task (transcribe, solve, explain, prove, plot, classify…). If class material is provided, FOLLOW ITS METHOD exactly. Show the reasoning, not just the answer.

Stage 4 — ANSWER PASS. State the final answer(s) explicitly. For multi-part questions, answer every part.

ONLY return a "cannot read" response if EVERY provided frame is truly empty / black / a finger / pointed at the floor. In that case put 3 short retake tips in steps.

Return ONLY JSON in this exact shape:
{"title":"short title (max 8 words)","summary":"one sentence","steps":["sentence 1","sentence 2"],"extractedText":"verbatim text read off the page with line breaks; math in LaTeX $...$","confidence":0.0_to_1.0}

Rules for steps:
- Each step is ONE clear spoken sentence (10-25 words).
- Speak math out loud — "x squared plus 3 x minus 4 equals zero", never "^" or "*" or "$".
- 4 to 14 steps. The last step states the final answer for every part of the question.
- No markdown, no latex, no bullets, no emojis in steps (LaTeX only allowed inside extractedText).

confidence = how confident you are in the merged OCR (0.0 = nothing readable, 1.0 = perfect read).`;

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
    return finalize(result, used, escalated, images_b64.length);
  });

function finalize(parsed: Parsed, modelUsed: string, escalated: boolean, framesUsed: number) {
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
