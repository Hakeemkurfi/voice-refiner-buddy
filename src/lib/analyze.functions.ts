import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  image_b64: z.string().min(100),
  contextText: z.string().max(12000).optional(),
  model: z.enum(["flash", "pro"]).optional(),
});

export const analyzeImage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    // Pro for OCR-heavy / hard images. Flash by default for speed + cost.
    const modelId =
      data.model === "pro" ? "google/gemini-2.5-pro" : "google/gemini-2.5-flash";

    const systemPrompt = `You are an expert OCR engine AND a patient tutor for math, physics, chemistry, biology, and reading. You receive a photo taken by a low-cost ESP32 camera of a printed page, a notebook, a whiteboard, or a screen. The image may be slightly blurry, slightly tilted, or unevenly lit — DO NOT give up. Real OCR engines extract text even from poor scans; you must do the same.

WORK IN TWO STAGES INSIDE YOUR HEAD BEFORE WRITING THE JSON:
Stage 1 — OCR. Read every visible character on the page, line by line, left to right, top to bottom. Include numbers, operators, punctuation, variable names, units, and any handwritten marks. Reconstruct partially-occluded characters from context. If a character is truly illegible write [?]. Mentally produce a verbatim string of what is on the page.

Stage 2 — Solve / Explain. Use the OCR string to determine the task: an equation to solve, a problem to answer, notes to summarize, a definition to explain. If class material is provided, follow ITS method.

ONLY if after a genuine OCR attempt the page is truly unreadable (lens covered, total darkness, frame is just a hand or floor), return steps that say "the picture arrived but it is unreadable" and give 3 short retake tips.

Return ONLY JSON in this exact shape:
{"title":"short title (max 8 words)","summary":"one sentence","steps":["sentence 1","sentence 2", ...],"extractedText":"the verbatim text you read off the page, or empty string"}

Rules for steps:
- Each step is ONE clear spoken sentence (10-25 words).
- Use simple words. Speak math out loud — say "x squared plus 3 x minus 4 equals 0", never write symbols like ^ * / inside spoken sentences.
- 4 to 12 steps. Last step states the final answer.
- No markdown, no latex, no bullets, no emojis in steps.`;

    const body = {
      model: modelId,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `OCR this image first, then solve or explain what is on the page.${data.contextText?.trim() ? `\n\nClass material or solution guide to follow:\n${data.contextText.trim()}` : ""}`,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${data.image_b64}`,
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
    };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) throw new Error("Rate limited. Try again in a moment.");
      if (res.status === 402) throw new Error("AI credits exhausted. Add credits in workspace billing.");
      throw new Error(`AI error ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: { title?: string; summary?: string; steps?: string[]; extractedText?: string };
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { steps: [content] };
    }
    const steps = (parsed.steps ?? []).filter((s) => typeof s === "string" && s.trim().length > 0);
    return {
      title: parsed.title ?? "Result",
      summary: parsed.summary ?? "",
      steps: steps.length > 0 ? steps : ["I could not read the image clearly. Please try a sharper photo."],
      extractedText: parsed.extractedText ?? "",
      modelUsed: modelId,
    };
  });
