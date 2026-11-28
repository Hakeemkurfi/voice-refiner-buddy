import { describe, expect, it, mock } from "bun:test";
import { primeAudioElement, SILENT_AUDIO_ANCHOR } from "./use-tts-queue";

describe("phone audio unlocking", () => {
  it("plays and pauses the silent anchor on the queue's own audio element", async () => {
    const audio = {
      src: "",
      playbackRate: 0.8,
      currentTime: 12,
      onplay: mock(),
      onended: mock(),
      onerror: mock(),
      play: mock().mockResolvedValue(undefined),
      pause: mock(),
    } as unknown as HTMLAudioElement;

    await primeAudioElement(audio);

    expect(audio.src).toBe(SILENT_AUDIO_ANCHOR);
    expect(audio.playbackRate).toBe(1);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.currentTime).toBe(0);
    expect(audio.onplay).toBeNull();
    expect(audio.onended).toBeNull();
    expect(audio.onerror).toBeNull();
  });

  it("reports a rejected tap unlock so the interface can offer Play answer", async () => {
    const audio = {
      src: "",
      playbackRate: 1,
      currentTime: 0,
      onplay: null,
      onended: null,
      onerror: null,
      play: mock().mockRejectedValue(new DOMException("Tap required", "NotAllowedError")),
      pause: mock(),
    } as unknown as HTMLAudioElement;

    await expect(primeAudioElement(audio)).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(audio.pause).not.toHaveBeenCalled();
  });
});
