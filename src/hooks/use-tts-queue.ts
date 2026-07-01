import { useCallback, useEffect, useRef, useState } from "react";

export type TtsItem = { id: string; title: string; steps: string[] };

// TTS hook that plays REAL audio bytes from /api/public/tts (OpenAI mp3 via
// Lovable AI Gateway). Played through a single HTMLAudioElement so playback
// survives screen-lock on iOS and Android. SpeechSynthesis is kept as a
// fallback only when the network call fails (e.g. offline preview).

export function useTtsQueue() {
  const [items, setItems] = useState<TtsItem[]>([]);
  const [currentItemIdx, setCurrentItemIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  // 0.9 = calm, conversational tutor pace. User asked for ~50% slower than the
  // robotic SpeechSynthesis default; with the OpenAI voice 0.9 sounds natural
  // and very dictation-friendly.
  const [rate, setRate] = useState(1.0);
  const [voice] = useState<string>("sage");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const manualStopRef = useRef(false);
  const currentItemIdxRef = useRef(0);
  const stepIdxRef = useRef(0);
  const flatRef = useRef<{ itemIdx: number; stepIdx: number; text: string }[]>([]);
  const tokenRef = useRef(0); // cancels stale playbacks
  const useBackendTtsRef = useRef(false); // urgent mode: free browser speech, no paid TTS credits

  useEffect(() => {
    currentItemIdxRef.current = currentItemIdx;
  }, [currentItemIdx]);

  useEffect(() => {
    stepIdxRef.current = stepIdx;
  }, [stepIdx]);

  useEffect(() => {
    const flat: { itemIdx: number; stepIdx: number; text: string }[] = [];
    items.forEach((it, i) =>
      it.steps.forEach((s, j) => flat.push({ itemIdx: i, stepIdx: j, text: s })),
    );
    flatRef.current = flat;
  }, [items]);

  const ensureAudio = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (!audioRef.current) {
      const a = new Audio();
      a.preload = "auto";
      // Important on iOS: a real <audio> element with real bytes keeps the
      // MediaSession + background audio alive when the screen locks.
      audioRef.current = a;
    }
    return audioRef.current;
  }, []);

  // Speak via backend MP3 (preferred) with SpeechSynthesis fallback.
  const speak = useCallback(
    (text: string, onEnd?: () => void) => {
      if (typeof window === "undefined") return;
      const myToken = ++tokenRef.current;
      manualStopRef.current = false;

      const fallbackToSpeech = () => {
        if (myToken !== tokenRef.current) return;
        if (!("speechSynthesis" in window)) return;
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = rate;
        u.pitch = 1;
        u.lang = "en-US";
        u.onstart = () => setSpeaking(true);
        u.onend = () => {
          setSpeaking(false);
          if (!manualStopRef.current && onEnd) onEnd();
        };
        u.onerror = () => setSpeaking(false);
        window.speechSynthesis.speak(u);
      };

      const audio = ensureAudio();
      if (!audio) return fallbackToSpeech();
      if (!useBackendTtsRef.current) return fallbackToSpeech();

      fetch("/api/public/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice, speed: rate }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`tts ${res.status}`);
          const blob = await res.blob();
          if (myToken !== tokenRef.current) return;
          const url = URL.createObjectURL(blob);
          audio.src = url;
          audio.playbackRate = 1; // server already applied speed
          audio.onplay = () => {
            if (myToken === tokenRef.current) setSpeaking(true);
          };
          audio.onended = () => {
            URL.revokeObjectURL(url);
            if (myToken !== tokenRef.current) return;
            setSpeaking(false);
            if (!manualStopRef.current && onEnd) onEnd();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            if (myToken !== tokenRef.current) return;
            setSpeaking(false);
            fallbackToSpeech();
          };
          try {
            await audio.play();
          } catch {
            fallbackToSpeech();
          }
        })
        .catch(() => {
          useBackendTtsRef.current = false;
          fallbackToSpeech();
        });
    },
    [rate, voice, ensureAudio],
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
          setTimeout(() => {
            const newIi = next.length - 1;
            setCurrentItemIdx(newIi);
            setStepIdx(0);
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

  const speakNow = useCallback((text: string) => speak(text), [speak]);

  const stop = useCallback(() => {
    manualStopRef.current = true;
    tokenRef.current++;
    try {
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.currentTime = 0;
    } catch { /* ignore */ }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, []);

  const next = useCallback(() => {
    const k = findFlatIdx(currentItemIdxRef.current, stepIdxRef.current);
    const flat = flatRef.current;
    if (k < 0 || k + 1 >= flat.length) return;
    stop();
    const n = flat[k + 1];
    setTimeout(() => playFrom(n.itemIdx, n.stepIdx), 80);
  }, [findFlatIdx, stop, playFrom]);

  const prev = useCallback(() => {
    const ii = currentItemIdxRef.current;
    const si = stepIdxRef.current;
    const k = findFlatIdx(ii, si);
    if (k <= 0) {
      stop();
      setTimeout(() => playFrom(ii, si), 80);
      return;
    }
    const flat = flatRef.current;
    const p = flat[k - 1];
    stop();
    setTimeout(() => playFrom(p.itemIdx, p.stepIdx), 80);
  }, [findFlatIdx, stop, playFrom]);

  const replay = useCallback(() => {
    const ii = currentItemIdxRef.current;
    const si = stepIdxRef.current;
    stop();
    setTimeout(() => playFrom(ii, si), 80);
  }, [stop, playFrom]);

  // Media Session — lock-screen / earbud / Bluetooth-ring controls
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
      try { ms.setActionHandler(action, fn); } catch { /* unsupported */ }
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
