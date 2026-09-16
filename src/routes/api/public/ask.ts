import { createFileRoute } from "@tanstack/react-router";

// Simplest bridge for the Raspberry Pi: send a photo and/or a question, get a
// plain text answer back. DeepSeek is the primary provider; Gemini is only a
// fallback. Course resources (RAG) are searched automatically and used as
// reference material when relevant.
//
//   POST /api/public/ask
//     Content-Type: image/jpeg        -> raw JPEG bytes (optional ?q=question&course=PHY202)
//     Content-Type: text/plain        -> just a question
//     Content-Type: application/json  -> { prompt, image_b64, course, model, use_resources }
//
//   Response: plain text answer (add ?format=json for { answer, sources })

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_BYTES = 8 * 1024 * 1024;

const GEMINI_MODELS: Record<string, string[]> = {
  flash: ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-1.5-flash"],
  pro: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
};

function deepseekVisionModels(): string[] {
  const raw = process.env["DEEPSEEK_VISION_MODELS"] ?? process.env["DEEPSEEK_VISION_MODEL"] ?? "";
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : ["deepseek-v4-flash-vision-exp", "deepseek-vl2"];
}

function deepseekTextModel(): string {
  return process.env["DEEPSEEK_TEXT_MODEL"]?.trim() || "deepseek-v4-flash";
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const SPOKEN_RULES = `You are Axon, an academic tutor. Answer for a student who is LISTENING, not reading. Plain text only: no markdown, no LaTeX, no raw symbols. Say math in words: x squared, x cubed, the square root of x, d y over d x, the integral, and so on.

ANSWER STYLE:
- Dictate the solution as separate numbered lines: "Line one", "Line two", "Line three", and so on. Put exactly one writeable step on each line.
- Line one identifies the given information and what must be found. Line two states the exact formula, rule, or probability distribution.
- Following lines substitute the visible values, simplify one meaningful transformation at a time, perform the calculation, and preserve units.
- The final numbered line must clearly state the final answer. Add one short check before it only when a unit, probability range, or magnitude check is useful.
- Never skip a step whose omission could make a handwritten solution difficult to follow or lose marks. Omit only commentary and obvious mental arithmetic.
- For mathematics: say exactly what changes at every important transformation. Do not merely say "differentiate"; state the resulting derivative.
- For physics and engineering: name the formula, substitute every known value with units, calculate, and include units in the final answer.
- For area under a curve, arc length, and single or double integrals: state the integrand and every limit, show any antiderivative or changed bounds, substitute the limits, then evaluate.
- For continuous random variables: state the density and interval, normalize it when required, write the probability integral with bounds, evaluate it, and check the result lies from zero to one.
- For binomial distributions: identify n, p, and the requested event; state the binomial probability formula; substitute; show any required sum or complement; then calculate.
- For hypergeometric distributions: identify population size, success count, sample size, and requested successes; state the combinations formula; substitute every combination; then calculate.
- For combinations and permutations: state why order matters or does not matter, state the correct formula, expand the factorial cancellation when helpful, then calculate.
- When reading text from an image: read only what is actually visible. Never invent missing or unclear text. If handwriting or part of the image is uncertain, say clearly that it is uncertain instead of guessing.
- If there are multiple questions, restart the numbering for each question and announce the question number first.
- Keep each line short enough to write while listening, normally one sentence and no more than about 24 words.

COURSE RESOURCES: when reference extracts are provided, follow their terminology, formulas, notation and course-specific methods when relevant — but the question itself always comes first, and never force the answer to match an irrelevant extract. If no extract is relevant, simply answer from your own knowledge.`;

async function askDeepSeek(
  apiKey: string,
  prompt: string,
  imageB64: string | undefined,
  resourceContext: string,
): Promise<string> {
  const system =
    SPOKEN_RULES +
    (resourceContext
      ? `\n\nCOURSE RESOURCE EXTRACTS (reference only — the student's actual question comes first). Follow their terminology, notation and methods when relevant; ignore them when they do not fit.\n${resourceContext}`
      : "");

  const userContent = imageB64
    ? [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageB64}` } },
      ]
    : prompt;

  let lastError = "DeepSeek request failed.";
  const models = imageB64 ? deepseekVisionModels() : [deepseekTextModel()];

  for (const model of models) {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
        temperature: 0.1,
        max_tokens: 4096,
      }),
    }).catch((error) => {
      lastError = `DeepSeek ${model}: ${(error as Error).message}`;
      return null;
    });
    if (!res) continue;

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      lastError = `DeepSeek ${model} HTTP ${res.status}: ${txt.slice(0, 200)}`;
      if (res.status === 401) throw new Error("Invalid DeepSeek API key on the server.");
      if (res.status === 402) throw new Error("DeepSeek account out of credits.");
      continue;
    }

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const answer = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (answer) return answer;
    lastError = `DeepSeek ${model} returned an empty answer.`;
  }
  throw new Error(lastError);
}

async function askGemini(
  apiKey: string,
  prompt: string,
  imageB64: string | undefined,
  tier: "flash" | "pro",
  resourceContext: string,
): Promise<string> {
  const parts: unknown[] = [
    {
      text:
        SPOKEN_RULES +
        (resourceContext ? `\n\nCourse resource extracts (reference only):\n${resourceContext}` : "") +
        `\n\n${prompt}`,
    },
  ];
  if (imageB64) parts.push({ inlineData: { mimeType: "image/jpeg", data: imageB64 } });

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
  };

  let lastError = "Gemini request failed.";
  for (const model of GEMINI_MODELS[tier]) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify(body),
      },
    ).catch((error) => {
      lastError = `${model}: ${(error as Error).message}`;
      return null;
    });
    if (!res) continue;

    if (!res.ok) {
      const text = await res.text();
      lastError = `${model} HTTP ${res.status}: ${text.slice(0, 200)}`;
      if ([429, 500, 503].includes(res.status) || text.toLowerCase().includes("not found")) continue;
      throw new Error(lastError);
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const answer =
      json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("\n").trim() ?? "";
    if (answer) return answer;
    lastError = `${model} returned an empty answer.`;
  }
  throw new Error(lastError);
}

export const Route = createFileRoute("/api/public/ask")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      GET: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            usage:
              "POST a JPEG (image/jpeg), a plain text question (text/plain), or JSON {prompt, image_b64, course, model, use_resources}. Returns plain text; add ?format=json for {answer, sources}.",
            provider: "deepseek (primary), gemini (fallback)",
            rag: "course resources are searched automatically",
          }),
          { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
        ),

      POST: async ({ request }) => {
        const url = new URL(request.url);
        const asJson = url.searchParams.get("format") === "json";
        let sources: unknown[] = [];
        const respond = (text: string, status = 200) =>
          asJson
            ? new Response(
                JSON.stringify(status === 200 ? { answer: text, sources } : { error: text }),
                { status, headers: { "Content-Type": "application/json", ...CORS } },
              )
            : new Response(text, {
                status,
                headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS },
              });

        try {
          const deepseekKey = process.env["DEEPSEEK_API_KEY"];
          const geminiKey = process.env["GEMINI_API_KEY"];
          if (!deepseekKey && !geminiKey) {
            return respond("Server has no AI provider key configured.", 500);
          }

          const contentType = request.headers.get("content-type") ?? "";
          let prompt = url.searchParams.get("q") ?? "";
          let course = url.searchParams.get("course");
          let useResources = url.searchParams.get("use_resources") !== "0";
          let imageB64: string | undefined;
          let tier: "flash" | "pro" = url.searchParams.get("model") === "pro" ? "pro" : "flash";

          if (contentType.includes("application/json")) {
            const body = (await request.json().catch(() => ({}))) as {
              prompt?: string;
              image_b64?: string;
              model?: string;
              course?: string;
              use_resources?: boolean;
            };
            prompt = body.prompt?.slice(0, 20000) || prompt;
            if (body.image_b64) imageB64 = body.image_b64.replace(/^data:image\/\w+;base64,/, "");
            if (body.model === "pro") tier = "pro";
            if (body.course) course = body.course;
            if (body.use_resources === false) useResources = false;
          } else if (contentType.startsWith("image/")) {
            const buf = new Uint8Array(await request.arrayBuffer());
            if (buf.byteLength > MAX_BYTES) return respond("Image too large (max 8 MB).", 413);
            imageB64 = toBase64(buf);
          } else {
            const text = await request.text();
            if (text.trim()) prompt = text.slice(0, 20000);
          }

          if (!imageB64 && !prompt.trim()) {
            return respond("Send a question, an image, or both.", 400);
          }
          if (!prompt.trim()) {
            prompt = "Read this page and answer or solve every question on it.";
          }

          // ── RAG: retrieve reference passages; never blocks the answer ──
          let resourceContext = "";
          if (useResources) {
            try {
              const { retrieveChunks, buildContextBlock } = await import("@/lib/rag.server");
              const chunks = await retrieveChunks(prompt, { course, limit: 6 });
              resourceContext = buildContextBlock(chunks, 5000);
              sources = chunks.map((c) => ({
                title: c.title,
                course: c.course,
                section: c.section,
                page: c.page,
                similarity: Number(c.similarity.toFixed(3)),
              }));
            } catch (e) {
              console.warn("[rag] skipped:", (e as Error).message);
            }
          }

          if (deepseekKey) {
            try {
              return respond(await askDeepSeek(deepseekKey, prompt, imageB64, resourceContext));
            } catch (e) {
              if (!geminiKey) throw e;
              console.warn("DeepSeek failed, falling back to Gemini:", (e as Error).message);
            }
          }

          return respond(await askGemini(geminiKey!, prompt, imageB64, tier, resourceContext));
        } catch (e) {
          return respond((e as Error).message, 502);
        }
      },
    },
  },
});
