import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  image_b64: z.string().min(100),
  contextText: z.string().max(12000).optional(),
});

export const analyzeImage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const systemPrompt = `You are a patient tutor for math, physics, chemistry, and reading.
Look at the photo. If it shows an equation or problem, solve it step by step.
If it shows a paragraph or notes, read and explain the key ideas step by step.
If the image is blurry, dark, cropped, or not readable, still return JSON that says the picture arrived but is unclear, then give simple steps for retaking it.
If class notes or textbook guidance is provided, use it as the preferred method and explain the answer in that style.

Return ONLY JSON in this exact shape:
{"title":"short title (max 8 words)","summary":"one sentence","steps":["sentence 1","sentence 2", ...]}

Rules for steps:
- Each step is ONE clear sentence (10-25 words).
- Use simple words. Speak the math out loud, e.g. say "x squared plus 3 x minus 4 equals 0".
- 4 to 12 steps. End with the final answer in its own step.
- Do not use markdown, latex, bullets, or symbols like ^ * / inside the spoken sentences — write words.`;

    const body = {
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Solve or explain what is in this image.${data.contextText?.trim() ? `\n\nClass material or solution guide to follow:\n${data.contextText.trim()}` : ""}`,
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
    let parsed: { title?: string; summary?: string; steps?: string[] };
    try {
      parsed = JSON.parse(content);
    } catch {
      // try to extract JSON block
      const m = content.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { steps: [content] };
    }
    const steps = (parsed.steps ?? []).filter((s) => typeof s === "string" && s.trim().length > 0);
    return {
      title: parsed.title ?? "Result",
      summary: parsed.summary ?? "",
      steps: steps.length > 0 ? steps : ["I could not read the image clearly. Please try a sharper photo."],
    };
  });
