import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Client-safe RPC surface for the resource library.
// Parsing happens in the browser (PDF/text), chunk + embed + index happen here.

const PageSchema = z.object({
  page: z.number().int().min(1),
  text: z.string(),
});

const IngestInput = z.object({
  title: z.string().min(1).max(300),
  course: z.string().max(120).optional().nullable(),
  subject: z.string().max(120).optional().nullable(),
  semester: z.string().max(60).optional().nullable(),
  docType: z.string().max(60).optional().nullable(),
  sourceFilename: z.string().max(300).optional().nullable(),
  pages: z.array(PageSchema).min(1).max(4000),
});

export const ingestResource = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => IngestInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { chunkPages, indexChunks } = await import("./rag.server");

    const chunks = chunkPages(data.pages);
    if (chunks.length === 0) {
      throw new Error("No readable text found in this document (it may be a scanned image PDF).");
    }

    const charCount = data.pages.reduce((n, p) => n + p.text.length, 0);

    const { data: resource, error } = await supabaseAdmin
      .from("resources")
      .insert({
        title: data.title,
        course: data.course ?? null,
        subject: data.subject ?? null,
        semester: data.semester ?? null,
        doc_type: data.docType ?? null,
        source_filename: data.sourceFilename ?? null,
        page_count: data.pages.length,
        char_count: charCount,
        chunk_count: chunks.length,
        status: "indexing",
      } as never)
      .select("id")
      .single();

    if (error || !resource) throw new Error(`Could not save resource: ${error?.message}`);

    const { embedded, inserted } = await indexChunks(resource.id, chunks);

    await supabaseAdmin
      .from("resources")
      .update({ status: embedded ? "ready" : "keyword-only", updated_at: new Date().toISOString() } as never)
      .eq("id", resource.id);

    return { id: resource.id, chunks: inserted, semantic: embedded };
  });

export const listResources = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("resources")
    .select("id, title, course, subject, semester, doc_type, page_count, chunk_count, status, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const deleteResource = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("resources").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const searchResources = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      query: z.string().min(2).max(2000),
      course: z.string().max(120).optional().nullable(),
      limit: z.number().int().min(1).max(12).optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { retrieveChunks } = await import("./rag.server");
    return retrieveChunks(data.query, { course: data.course ?? null, limit: data.limit ?? 6 });
  });
