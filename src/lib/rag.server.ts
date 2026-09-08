// ─── RAG layer (provider-independent) ────────────────────────────────────────
// UPLOAD → PARSE → CHUNK → EMBED → INDEX → RETRIEVE → CONTEXT
// This module knows nothing about DeepSeek/Gemini. It only produces context.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const EMBEDDING_DIMS = 1536;

export type ChunkInput = {
  content: string;
  page?: number | null;
  section?: string | null;
};

export type RetrievedChunk = {
  chunk_id: string;
  resource_id: string;
  title: string;
  course: string | null;
  subject: string | null;
  page: number | null;
  section: string | null;
  chunk_index: number;
  content: string;
  similarity: number;
};

// ─── CHUNK ───────────────────────────────────────────────────────────────────
// ~1200 characters with 150 char overlap, split on paragraph/sentence limits.
export function chunkPages(
  pages: { page: number; text: string }[],
  targetChars = 1200,
  overlap = 150,
): ChunkInput[] {
  const chunks: ChunkInput[] = [];

  for (const { page, text } of pages) {
    const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (clean.length < 40) continue;

    const paragraphs = clean.split(/\n\s*\n/);
    let buffer = "";
    let section: string | null = null;

    const flush = () => {
      const body = buffer.trim();
      if (body.length >= 40) chunks.push({ content: body, page, section });
      buffer = "";
    };

    for (const para of paragraphs) {
      const heading = para.trim().match(
        /^(?:chapter|section|unit|topic|lecture|lab|experiment|example|exercise)\b[^\n]{0,80}/i,
      );
      if (heading) section = heading[0].trim().slice(0, 120);

      if ((buffer + "\n\n" + para).length > targetChars && buffer.length > 0) {
        const tail = buffer.slice(-overlap);
        flush();
        buffer = tail + "\n\n" + para;
      } else {
        buffer = buffer ? buffer + "\n\n" + para : para;
      }

      // very long single paragraph → hard split
      while (buffer.length > targetChars * 2) {
        const cut = buffer.lastIndexOf(". ", targetChars);
        const at = cut > targetChars * 0.4 ? cut + 1 : targetChars;
        const head = buffer.slice(0, at);
        buffer = buffer.slice(Math.max(0, at - overlap));
        if (head.trim().length >= 40) chunks.push({ content: head.trim(), page, section });
      }
    }
    flush();
  }

  return chunks;
}

// ─── EMBED ───────────────────────────────────────────────────────────────────
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key || texts.length === 0) return null;

  const out: number[][] = [];
  const batchSize = 48;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((t) => t.slice(0, 6000));
    const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch, encoding_format: "float" }),
    }).catch(() => null);

    if (!res || !res.ok) {
      const detail = res ? `${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}` : "network error";
      console.warn(`[rag] embedding failed (${detail}); falling back to keyword search`);
      return null;
    }

    const json = (await res.json()) as { data?: { embedding: number[] }[] };
    for (const row of json.data ?? []) out.push(row.embedding);
  }

  return out.length === texts.length ? out : null;
}

// ─── INDEX ───────────────────────────────────────────────────────────────────
export async function indexChunks(resourceId: string, chunks: ChunkInput[]) {
  if (chunks.length === 0) return { embedded: false, inserted: 0 };

  const embeddings = await embedTexts(chunks.map((c) => c.content));

  const rows = chunks.map((c, i) => ({
    resource_id: resourceId,
    chunk_index: i,
    content: c.content,
    page: c.page ?? null,
    section: c.section ?? null,
    embedding: embeddings ? (JSON.stringify(embeddings[i]) as unknown as string) : null,
  }));

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const slice = rows.slice(i, i + 100);
    const { error } = await supabaseAdmin.from("resource_chunks").insert(slice as never);
    if (error) throw new Error(`Indexing failed: ${error.message}`);
    inserted += slice.length;
  }

  return { embedded: Boolean(embeddings), inserted };
}

// ─── RETRIEVE ────────────────────────────────────────────────────────────────
export async function retrieveChunks(
  query: string,
  opts: { course?: string | null; limit?: number } = {},
): Promise<RetrievedChunk[]> {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 4000);
  if (q.length < 8) return [];
  const limit = opts.limit ?? 6;

  // 1. Semantic search
  const embedded = await embedTexts([q]);
  if (embedded?.[0]) {
    const rpc = supabaseAdmin.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: RetrievedChunk[] | null; error: { message: string } | null }>;
    const { data, error } = await rpc("match_resource_chunks", {
      query_embedding: JSON.stringify(embedded[0]),
      match_count: limit,
      filter_course: opts.course ?? null,
      min_similarity: 0.15,
    });
    if (!error && Array.isArray(data) && data.length > 0) return data;
    if (error) console.warn("[rag] vector search failed:", error.message);
  }

  // 2. Keyword fallback (never fail the request)
  const words = Array.from(
    new Set(q.toLowerCase().match(/[a-z][a-z0-9'-]{3,}/g) ?? []),
  ).slice(0, 8);
  if (words.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("resource_chunks")
    .select("id, resource_id, chunk_index, content, page, section, resources(title, course, subject)")
    .textSearch("tsv", words.join(" | "), { config: "english" })
    .limit(limit);

  if (error || !data) return [];

  return data.map((row) => {
    const r = (row as unknown as { resources?: { title?: string; course?: string; subject?: string } }).resources;
    return {
      chunk_id: row.id,
      resource_id: row.resource_id,
      title: r?.title ?? "Resource",
      course: r?.course ?? null,
      subject: r?.subject ?? null,
      page: row.page,
      section: row.section,
      chunk_index: row.chunk_index,
      content: row.content,
      similarity: 0.3,
    };
  });
}

// ─── CONTEXT ─────────────────────────────────────────────────────────────────
// Builds a compact, TTS-safe context block. Never sends whole documents.
export function buildContextBlock(chunks: RetrievedChunk[], maxChars = 6000): string {
  if (chunks.length === 0) return "";
  let out = "";
  for (const c of chunks) {
    const where = [c.title, c.section, c.page ? `page ${c.page}` : null]
      .filter(Boolean)
      .join(" · ");
    const piece = `[${where}]\n${c.content.trim()}\n\n`;
    if (out.length + piece.length > maxChars) break;
    out += piece;
  }
  return out.trim();
}
