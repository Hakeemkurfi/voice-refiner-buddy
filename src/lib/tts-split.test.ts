/// <reference types="bun" />
import { expect, test } from "bun:test";
import { splitForVoice } from "../routes/api/public/tts";

test("long answers are voiced in short pieces with no words lost", () => {
  const text = Array.from({ length: 15 }, (_, i) =>
    `Line ${i}: determinant of A equals five times nine minus eight times six equals negative three. Repeat line ${i}: determinant of A equals five times nine minus eight times six equals negative three.`).join("\n");
  const pieces = splitForVoice(text);
  expect(pieces.every((p) => p.length <= 260)).toBe(true);
  expect(pieces.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
});

test("a repeat stays one piece with its line label", () => {
  expect(splitForVoice("Line one: x equals 2. Repeat line one: x equals 2.")).toEqual(["Line one: x equals 2.", "Repeat line one: x equals 2."]);
});
