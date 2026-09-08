import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ingestResource,
  listResources,
  deleteResource,
  searchResources,
} from "@/lib/resources.functions";

export const Route = createFileRoute("/resources")({
  component: ResourcesPage,
  head: () => ({
    meta: [
      { title: "Resource Library — Axon AI Reader" },
      {
        name: "description",
        content:
          "Upload textbooks, lecture notes, lab manuals and formula sheets so Axon answers using your own course material.",
      },
      { property: "og:title", content: "Resource Library — Axon AI Reader" },
      {
        property: "og:description",
        content:
          "Upload course PDFs and notes; Axon searches them and uses the matching passages when it answers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

type ResourceRow = {
  id: string;
  title: string;
  course: string | null;
  subject: string | null;
  semester: string | null;
  doc_type: string | null;
  page_count: number;
  chunk_count: number;
  status: string;
  created_at: string;
};

type Hit = {
  title: string;
  course: string | null;
  section: string | null;
  page: number | null;
  similarity: number;
  content: string;
};

const DOC_TYPES = [
  "textbook",
  "lecture notes",
  "course PDF",
  "lab manual",
  "formula sheet",
  "assignment",
  "reference",
  "technical manual",
  "other",
];

async function extractPages(file: File): Promise<{ page: number; text: string }[]> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const workerUrl = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const buf = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    const pages: { page: number; text: string }[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? (item as { str: string }).str : ""))
        .join(" ");
      pages.push({ page: i, text });
    }
    return pages;
  }

  const text = await file.text();
  // Split plain text/markdown into ~3000 char pseudo-pages so page refs stay useful.
  const pages: { page: number; text: string }[] = [];
  for (let i = 0; i < text.length; i += 3000) {
    pages.push({ page: pages.length + 1, text: text.slice(i, i + 3000) });
  }
  return pages;
}

function ResourcesPage() {
  const ingest = useServerFn(ingestResource);
  const list = useServerFn(listResources);
  const remove = useServerFn(deleteResource);
  const search = useServerFn(searchResources);

  const [rows, setRows] = useState<ResourceRow[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState({
    title: "",
    course: "",
    subject: "",
    semester: "",
    docType: "lecture notes",
  });
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setRows((await list({})) as ResourceRow[]);
    } catch (e) {
      setStatus((e as Error).message);
    }
  }, [list]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        setStatus(`Reading ${file.name}…`);
        const pages = await extractPages(file);
        const chars = pages.reduce((n, p) => n + p.text.trim().length, 0);
        if (chars < 200) {
          setStatus(`${file.name}: no selectable text found (scanned images are not supported yet).`);
          continue;
        }
        setStatus(`Indexing ${file.name} — ${pages.length} pages…`);
        const res = (await ingest({
          data: {
            title: meta.title.trim() || file.name.replace(/\.[^.]+$/, ""),
            course: meta.course.trim() || null,
            subject: meta.subject.trim() || null,
            semester: meta.semester.trim() || null,
            docType: meta.docType || null,
            sourceFilename: file.name,
            pages,
          },
        })) as { chunks: number; semantic: boolean };
        setStatus(
          `${file.name}: ${res.chunks} passages indexed${res.semantic ? " (semantic search on)" : " (keyword search only)"}.`,
        );
      }
      setMeta((m) => ({ ...m, title: "" }));
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onSearch = async () => {
    if (query.trim().length < 2) return;
    setBusy(true);
    try {
      setHits((await search({ data: { query: query.trim(), limit: 8 } })) as Hit[]);
      setStatus("");
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground p-5 md:p-10">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="space-y-2">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to Axon
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">Resource library</h1>
          <p className="text-muted-foreground">
            Upload textbooks, lecture notes, lab manuals, formula sheets or any course PDF. Axon
            searches them when you take a photo and follows your course's own methods and notation —
            and still answers normally when nothing relevant is found.
          </p>
        </header>

        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="font-medium">Add material</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Title (optional — filename is used)"
              value={meta.title}
              onChange={(e) => setMeta({ ...meta, title: e.target.value })}
            />
            <input
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Course e.g. PHY 202"
              value={meta.course}
              onChange={(e) => setMeta({ ...meta, course: e.target.value })}
            />
            <input
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Subject e.g. Physics"
              value={meta.subject}
              onChange={(e) => setMeta({ ...meta, subject: e.target.value })}
            />
            <input
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Semester e.g. 2026/1"
              value={meta.semester}
              onChange={(e) => setMeta({ ...meta, semester: e.target.value })}
            />
            <select
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={meta.docType}
              onChange={(e) => setMeta({ ...meta, docType: e.target.value })}
            >
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdf,.txt,.md,.csv,text/plain,application/pdf"
              disabled={busy}
              onChange={(e) => void onUpload(e.target.files)}
              className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-primary-foreground"
            />
          </div>
          {status && <p className="text-sm text-muted-foreground">{status}</p>}
        </section>

        <section className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h2 className="font-medium">Test the search</h2>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="e.g. moment of inertia of a solid disc"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void onSearch()}
            />
            <button
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
              disabled={busy}
              onClick={() => void onSearch()}
            >
              Search
            </button>
          </div>
          {hits.map((h, i) => (
            <article key={i} className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium">
                {h.title}
                {h.section ? ` · ${h.section}` : ""}
                {h.page ? ` · page ${h.page}` : ""}
                <span className="ml-2 text-xs text-muted-foreground">
                  match {Math.round(h.similarity * 100)}%
                </span>
              </p>
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                {h.content.slice(0, 400)}
              </p>
            </article>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="font-medium">Indexed documents ({rows.length})</h2>
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing uploaded yet.</p>
          )}
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-md border border-border bg-card p-3 text-sm"
            >
              <div>
                <p className="font-medium">{r.title}</p>
                <p className="text-xs text-muted-foreground">
                  {[r.course, r.subject, r.semester, r.doc_type].filter(Boolean).join(" · ") || "—"}
                  {` · ${r.page_count} pages · ${r.chunk_count} passages · ${r.status}`}
                </p>
              </div>
              <button
                className="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted"
                onClick={async () => {
                  await remove({ data: { id: r.id } });
                  await refresh();
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
