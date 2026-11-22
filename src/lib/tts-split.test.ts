/// <reference types="bun" />
import { expect, test } from "bun:test";
import { joinWithPauses, mp3SampleRate, pauseBefore, splitForVoice } from "../routes/api/public/tts";
import { SILENCE_B64 } from "./voice-silence";

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

test("each dictation line gets a long pause, other pieces a short breath", () => {
  expect(pauseBefore("Line one: x equals 2.", 0)).toBe("short");
  expect(pauseBefore("Repeat line one: x equals 2.", 1)).toBe("long");
  expect(pauseBefore("Line two: y equals 3.", 2)).toBe("long");
  expect(pauseBefore("so x equals 1 or x equals 3.", 3)).toBe("short");
});

test("pauses are added around every piece in the voice's own sample rate", () => {
  const sil = SILENCE_B64[24000]!;
  const piece = Buffer.from(sil.short, "base64"); // any 24 kHz mp3 bytes
  expect(mp3SampleRate(piece)).toBe(24000);
  expect(mp3SampleRate(Buffer.from(SILENCE_B64[16000]!.short, "base64"))).toBe(16000);
  const joined = joinWithPauses(["Line one: a.", "Repeat line one: a."], [piece, piece]);
  const short = Buffer.from(sil.short, "base64").length;
  const long = Buffer.from(sil.long, "base64").length;
  expect(joined.length).toBe(short + piece.length + long + piece.length + short);
});
