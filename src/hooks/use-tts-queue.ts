import { useCallback, useEffect, useRef, useState } from "react";

export type TtsItem = { id: string; title: string; steps: string[] };

export function useTtsQueue() {
  const [items, setItems] = useState<TtsItem[]>([]);
  const [currentItemIdx, setCurrentItemIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [rate, setRate] = useState(1);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const manualStopRef = useRef(false);
  // Silent looping audio that ANCHORS MediaSession on iOS / Android lock-screen.
  // The browser only shows the lock-screen widget when an <audio> element is
  // actively playing — SpeechSynthesis alone is invisible to MediaSession.
  // We loop a 1-second near-silent WAV under the TTS so the widget stays alive.
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  const ensureSilentAudio = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (!silentAudioRef.current) {
      // 1s of 8-bit silence — small data URL, no asset to ship.
      const a = new Audio(
        "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=",
      );
      a.loop = true;
      a.volume = 0.01;
      a.preload = "auto";
      silentAudioRef.current = a;
    }
    return silentAudioRef.current;
  }, []);

  const speak = useCallback(
    (text: string, onEnd?: () => void) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const anchor = ensureSilentAudio();
      anchor?.play().catch(() => {});
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate;
      u.pitch = 1;
      u.lang = "en-US";
      u.onstart = () => setSpeaking(true);
      u.onend = () => {
        setSpeaking(false);
        if (!manualStopRef.current && onEnd) onEnd();
        manualStopRef.current = false;
      };
      u.onerror = () => setSpeaking(false);
      utterRef.current = u;
      window.speechSynthesis.speak(u);
    },
    [rate, ensureSilentAudio],
  );


  const findFlatIdx = useCallback((ii: number, si: number) => {
    return flatRef.current.findIndex((f) => f.itemIdx === ii && f.stepIdx === si);
  }, []);

  const playFrom = useCallback(
    (ii: number, si: number) => {
      const flat = flatRef.current;
      const start = findFlatIdx(ii, si);
      if (start < 0) return;
      const playIdx = (k: number) => {
        if (k >= flat.length) return;
        const cur = flat[k];
        setCurrentItemIdx(cur.itemIdx);
        setStepIdx(cur.stepIdx);
        speak(cur.text, () => playIdx(k + 1));
      };
      playIdx(start);
    },
    [findFlatIdx, speak],
  );

  const addItem = useCallback(
    (item: TtsItem, autoPlay = true) => {
      setItems((prev) => {
        const next = [...prev, item];
        if (autoPlay) {
          // schedule play after state settles
          setTimeout(() => {
            const newIi = next.length - 1;
            setCurrentItemIdx(newIi);
            setStepIdx(0);
            // rebuild flat synchronously
            const flat: { itemIdx: number; stepIdx: number; text: string }[] = [];
            next.forEach((it, i) => it.steps.forEach((s, j) => flat.push({ itemIdx: i, stepIdx: j, text: s })));
            flatRef.current = flat;
            playFrom(newIi, 0);
          }, 50);
        }
        return next;
      });
    },
    [playFrom],
  );

  const speakNow = useCallback(
    (text: string) => {
      speak(text);
    },
    [speak],
  );

  const stop = useCallback(() => {
    manualStopRef.current = true;
    if (typeof window !== "undefined") window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const next = useCallback(() => {
    const k = findFlatIdx(currentItemIdx, stepIdx);
    const flat = flatRef.current;
    if (k < 0 || k + 1 >= flat.length) return;
    stop();
    const n = flat[k + 1];
    setTimeout(() => playFrom(n.itemIdx, n.stepIdx), 80);
  }, [currentItemIdx, stepIdx, findFlatIdx, stop, playFrom]);

  const prev = useCallback(() => {
    const k = findFlatIdx(currentItemIdx, stepIdx);
    if (k <= 0) {
      // replay current
      stop();
      setTimeout(() => playFrom(currentItemIdx, stepIdx), 80);
      return;
    }
    const flat = flatRef.current;
    const p = flat[k - 1];
    stop();
    setTimeout(() => playFrom(p.itemIdx, p.stepIdx), 80);
  }, [currentItemIdx, stepIdx, findFlatIdx, stop, playFrom]);

  const replay = useCallback(() => {
    stop();
    setTimeout(() => playFrom(currentItemIdx, stepIdx), 80);
  }, [currentItemIdx, stepIdx, stop, playFrom]);

  // Media Session for lock-screen / earbud controls
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const cur = items[currentItemIdx];
    ms.metadata = new MediaMetadata({
      title: cur?.title ?? "Smart Audio Tutor",
      artist: cur?.steps?.[stepIdx] ?? "Press capture on your ESP32",
      album: "ESP32-S3-CAM",
    });
    ms.playbackState = speaking ? "playing" : "paused";
    const bind = (action: MediaSessionAction, fn: () => void) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* unsupported */
      }
    };
    bind("play", replay);
    bind("pause", stop);
    bind("nexttrack", next);
    bind("previoustrack", prev);
    bind("seekbackward", replay);
    bind("seekforward", next);
  }, [items, currentItemIdx, stepIdx, speaking, next, prev, replay, stop]);

  return {
    items,
    currentItemIdx,
    stepIdx,
    speaking,
    rate,
    setRate,
    addItem,
    speakNow,
    next,
    prev,
    replay,
    stop,
  };
}
