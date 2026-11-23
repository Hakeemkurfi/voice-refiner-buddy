/// <reference types="bun" />
import { expect, test } from "bun:test";
import { joinWithPauses, mp3SampleRate, pauseBefore, silenceLike, splitForVoice, voiceText } from "../routes/api/public/tts";

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

// One real 128 kbps / 24 kHz mono frame header, like the Lovable voice sends.
const VOICE_FRAME = Buffer.concat([Buffer.from([0xff, 0xf3, 0xc4, 0xc4]), Buffer.alloc(380, 7)]);

test("pauses use the voice's own format so the file is one uniform stream", () => {
  const piece = Buffer.concat(Array.from({ length: 10 }, () => VOICE_FRAME));
  expect(mp3SampleRate(piece)).toBe(24000);
  const sil = silenceLike(piece, 0.4)!;
  expect(sil.length % 384).toBe(0);
  expect(sil.subarray(0, 4)).toEqual(Buffer.from([0xff, 0xf3, 0xc4, 0xc4]));
  const joined = joinWithPauses(["Line one: a.", "Repeat line one: a."], [piece, piece]);
  const frames = (s: number) => Math.round((s * 24000) / 576) * 384;
  // 1.3 s wake-up lead-in, long pause before the repeat line, short tail
  expect(joined.length).toBe(frames(1.3) + piece.length + frames(0.65) + piece.length + frames(0.4));
});

test("a leading ID3 tag on a piece is removed before joining", () => {
  const id3 = Buffer.concat([Buffer.from("ID3"), Buffer.from([3, 0, 0, 0, 0, 0, 0, 4]), Buffer.alloc(4)]);
  const piece = Buffer.concat([VOICE_FRAME, VOICE_FRAME]);
  const joined = joinWithPauses(["a.", "b."], [piece, Buffer.concat([id3, piece])]);
  expect(joined.includes(Buffer.from("ID3"))).toBe(false);
});

test("line labels are spoken with a full stop, never a colon the voice skips", () => {
  expect(voiceText("Repeat line one: f of x equals x squared.")).toBe("Repeat line one. f of x equals x squared.");
  expect(voiceText("Correct answer: Option B.")).toBe("Correct answer. Option B.");
  expect(voiceText("the ratio 2:3 stays")).toBe("the ratio 2:3 stays");
});
