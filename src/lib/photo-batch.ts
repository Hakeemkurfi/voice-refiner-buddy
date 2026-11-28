import { z } from "zod";

export const PHONE_VOICE_RATE = 0.9;
export const BatchQuestion = z.object({
  label: z.string().min(1),
  text: z.string().min(1).max(20000),
  pages: z.array(z.number().int().min(1)).min(1),
});
export type PhotoQuestion = z.infer<typeof BatchQuestion>;

export function validatePhotoQuestions(value: unknown, pageCount: number): PhotoQuestion[] {
  const questions = z.array(BatchQuestion).min(1).parse(value);
  if (questions.some((q) => q.pages.some((p) => p > pageCount))) {
    throw new Error("A question refers to a missing page. Please retry reading the pages.");
  }
  return questions;
}

// Stop at a failed question: the caller retains it and the remaining work for retry.
export async function solvePhotoQuestions<T>(
  questions: readonly PhotoQuestion[],
  solve: (question: PhotoQuestion, index: number) => Promise<T>,
  ready: (answer: T, question: PhotoQuestion, index: number) => void,
): Promise<void> {
  for (const [index, question] of questions.entries()) {
    const answer = await solve(question, index);
    ready(answer, question, index);
  }
}