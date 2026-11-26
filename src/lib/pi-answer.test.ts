/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { commandIsFresh, constantTimeEqual, decidePublish, nextTarget, piPostSchema, previousTarget } from "./pi-answer";

const base = { rowToken: "t".repeat(20), rowSequence: 5, rowRevision: 0, rowStatus: "capturing", deviceSequence: 5, token: "t".repeat(20), revision: 1 };

describe("publish rules", () => {
  it("accepts the current capture", () => expect(decidePublish(base)).toBe("accept"));
  it("rejects a late answer from an older photo", () => expect(decidePublish({ ...base, rowSequence: 4, deviceSequence: 5 })).toBe("stale"));
  it("rejects a superseded answer", () => expect(decidePublish({ ...base, rowStatus: "superseded" })).toBe("stale"));
  it("treats the same answer sent twice as one", () => expect(decidePublish({ ...base, rowRevision: 1, rowStatus: "ready" })).toBe("duplicate"));
  it("rejects an older revision", () => expect(decidePublish({ ...base, rowRevision: 2, rowStatus: "ready", revision: 1 })).toBe("stale"));
  it("updates a newer revision in place", () => expect(decidePublish({ ...base, rowRevision: 1, rowStatus: "ready", revision: 2 })).toBe("accept"));
  it("rejects a wrong capture token", () => expect(decidePublish({ ...base, token: "x".repeat(20) })).toBe("bad_token"));
});

describe("buttons", () => {
  it("previous restarts the part after more than 3 s", () => expect(previousTarget(2, 3.5)).toBe(2));
  it("previous goes back a part within 3 s", () => expect(previousTarget(2, 1)).toBe(1));
  it("previous at part 1 restarts it", () => expect(previousTarget(0, 0.5)).toBe(0));
  it("next at the last part goes idle", () => expect(nextTarget(5, 6)).toBeNull());
  it("next moves one part", () => expect(nextTarget(1, 6)).toBe(2));
  it("commands older than 10 s are ignored", () => {
    expect(commandIsFresh(0, 10_000)).toBe(true);
    expect(commandIsFresh(0, 10_001)).toBe(false);
  });
});

describe("limits", () => {
  const pub = { type: "publish", device_id: "axon-pi", question_id: "3f1c2b8e-1d2a-4c3b-9a8e-7f6d5c4b3a21", capture_token: "t".repeat(20), revision: 1 };
  it("allows 60 parts", () => expect(piPostSchema.safeParse({ ...pub, sections: Array(60).fill("Line one.") }).success).toBe(true));
  it("rejects 61 parts", () => expect(piPostSchema.safeParse({ ...pub, sections: Array(61).fill("Line one.") }).success).toBe(false));
  it("rejects a part over 2000 characters", () => expect(piPostSchema.safeParse({ ...pub, sections: ["a".repeat(2001)] }).success).toBe(false));
  it("rejects over 20000 characters total", () => expect(piPostSchema.safeParse({ ...pub, sections: Array(11).fill("a".repeat(1900)) }).success).toBe(false));
  it("compares keys exactly", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
  });
});
