/// <reference types="bun" />
import { expect, test } from "bun:test";
import { retrieveChunks } from "./rag.server";

test("keyword fallback keeps the selected Calculus course filter", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
  let requestedCourse: string | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.pathname.includes("embeddings")) return new Response("unavailable", { status: 402 });
    requestedCourse = url.searchParams.get("resources.course");
    return Response.json([]);
  }) as typeof fetch;
  try {
    await retrieveChunks("chain rule Jacobian matrices", { course: "Calculus" });
    expect(requestedCourse).toBe("eq.Calculus");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});