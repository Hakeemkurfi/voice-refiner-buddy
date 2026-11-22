/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { repeatDictationLines } from "./math-dictation";

describe("dictation repetition", () => {
  test("every step is delivered twice before the next step with identical numbers", () => {
    expect(repeatDictationLines("Solution.\nLine one: Row one, five, five.\nLine two: Row two, eight, six."))
      .toBe("Solution.\nLine one: Row one, five, five.\nRepeat line one: Row one, five, five.\nLine two: Row two, eight, six.\nRepeat line two: Row two, eight, six.");
  });
  test("incorrect repeated numbers are replaced by the first reading", () => {
    expect(repeatDictationLines("Line one: square root of five. Repeat line one: square root of six."))
      .toBe("Line one: square root of five.\nRepeat line one: square root of five.");
  });
  test("objective answer is not repeated or numbered", () => {
    const answer = "What is the SI unit of force? Correct answer: Option C, the newton.";
    expect(repeatDictationLines(answer)).toBe(answer);
  });
  test("drawing directions are repeated independently", () => {
    expect(repeatDictationLines("Draw line one: Label x and y axes."))
      .toBe("Draw line one: Label x and y axes.\nRepeat draw line one: Label x and y axes.");
  });
});
import { MATH_DICTATION_RULES } from "./math-dictation";
describe("truth table and diagram rules", () => {
  test("truth table rows must name each column", () => {
    expect(MATH_DICTATION_RULES).toContain("Never read a bare sequence like T F T T without its column names");
  });
});

import { test as t2, expect as e2 } from "bun:test";
t2("keeps question introductions between solutions", () => {
  const out = repeatDictationLines("Line one: x equals 1.\nRepeat line one: x equals 1.\nQ3. Solve 2x=6.\nSolution.\nLine one: x equals 3.");
  e2(out).toContain("Q3. Solve 2x=6.");
  e2(out).toContain("Repeat line one: x equals 3.");
});
