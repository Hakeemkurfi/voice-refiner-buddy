import { describe, expect, it } from "bun:test";
import { PHONE_VOICE_RATE, solvePhotoQuestions, validatePhotoQuestions } from "./photo-batch";

describe("multi-page question queue", () => {
  it("uses a slightly slower phone pace than the previous 1x", () => {
    expect(PHONE_VOICE_RATE).toBe(0.9);
    expect(PHONE_VOICE_RATE).toBeLessThan(1);
  });
  it("solves more than ten questions from three pages sequentially and delivers each immediately", async () => {
    const questions = validatePhotoQuestions(Array.from({ length: 12 }, (_, i) => ({
      label: `Question ${i + 1}`, text: `Solve ${i + 1}`, pages: [Math.floor(i / 4) + 1],
    })), 3);
    const events: string[] = [];
    let active = 0;
    let maxActive = 0;
    await solvePhotoQuestions(questions, async (q) => {
      active++;
      maxActive = Math.max(maxActive, active);
      events.push(`solve ${q.label}`);
      await Promise.resolve();
      active--;
      return q.text;
    }, (_, q) => { events.push(`ready ${q.label}`); });
    expect(maxActive).toBe(1);
    expect(events.length).toBe(24);
    expect(events.slice(0, 4)).toEqual(["solve Question 1", "ready Question 1", "solve Question 2", "ready Question 2"]);
    expect(events.at(-1)).toBe("ready Question 12");
  });
  it("retains cross-page questions and rejects missing page references", () => {
    expect(validatePhotoQuestions([{ label: "1", text: "a and b", pages: [1, 2] }], 3)[0]?.pages).toEqual([1, 2]);
    expect(() => validatePhotoQuestions([{ label: "1", text: "a", pages: [4] }], 3)).toThrow();
  });
  it("stops at an unsuccessful question instead of silently skipping it", async () => {
    const questions = validatePhotoQuestions([1, 2, 3].map((n) => ({ label: `${n}`, text: `${n}`, pages: [1] })), 1);
    const delivered: string[] = [];
    await expect(solvePhotoQuestions(questions, async (q) => {
      if (q.label === "2") throw new Error("network unavailable");
      return q.label;
    }, (answer) => { delivered.push(answer); })).rejects.toThrow("network unavailable");
    expect(delivered).toEqual(["1"]);
  });
});