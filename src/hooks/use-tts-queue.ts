import { useCallback, useEffect, useRef, useState } from "react";
import { PHONE_VOICE_RATE } from "@/lib/photo-batch";

export type TtsItem = { id: string; title: string; steps: string[] };

// A silent anchor played by the SAME audio element during a real screen tap.
// iPhone browsers then allow that element to start the answer after the slow
// photo-solving request finishes. A separate temporary Audio object does not
// reliably unlock this queue's player.
export const SILENT_AUDIO_ANCHOR =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

export async function primeAudioElement(audio: HTMLAudioElement): Promise<void> {
  audio.onplay = null;
  audio.onended = null;
  audio.onerror = null;
  audio.src = SILENT_AUDIO_ANCHOR;
  audio.playbackRate = 1;
  await audio.play();
  audio.pause();
  audio.currentTime = 0;
}

// TTS hook that plays REAL audio bytes from /api/public/tts. A single
// HTMLAudioElement preserves lock-screen playback and earbud media controls.
// Browser speech remains a fallback for voice-service/network failures only.
export function useTtsQueue(opts?: { mediaSession?: boolean }) {
  const mediaSessionOn = opts?.mediaSession ?? true;
  const [items, setItems] = useState<TtsItem[]>([]);
  const [currentItemIdx, setCurrentItemIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [rate, setRate] = useState(PHONE_VOICE_RATE);
  const [voice] = useState<string>("sage");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const manualStopRef = useRef(false);
  const currentItemIdxRef = useRef(0);
  const stepIdxRef = useRef(0);
  const flatRef = useRef<{ itemIdx: number; stepIdx: number; text: string }[]>([]);
  const tokenRef = useRef(0); // cancels stale playbacks
  const itemsRef = useRef<TtsItem[]>([]);
  const runningRef = useRef(false);
  // Voice clips fetched ahead of time (next line loads while this one plays),
  // each retried so one network hiccup does not stop the answer mid-way.
  const voiceCacheRef = useRef(new Map<string, Promise<Blob>>());

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

  const fetchVoice = useCallback(
    (text: string): Promise<Blob> => {
      const key = `${voice}|${rate}|${text}`;
      const cache = voiceCacheRef.current;
      const hit = cache.get(key);
      if (hit) return hit;
      const attempt = async (): Promise<Blob> => {
        let lastErr: unknown;
        for (let i = 0; i < 4; i++) {
          try {
            const res = await fetch("/api/public/tts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text, voice, speed: rate }),
            });
            if (!res.ok) throw new Error(`tts ${res.status}`);
            const blob = await res.blob();
            if (blob.size < 200) throw new Error("empty voice clip");
            return blob;
          } catch (e) {
            lastErr = e;
            await new Promise((r) => setTimeout(r, 600 * (i + 1)));
          }
        }
        throw lastErr;
      };
      const p = attempt();
      p.catch(() => cache.delete(key));
      cache.set(key, p);
      if (cache.size > 40) {
        const first = cache.keys().next().value;
        if (first !== undefined) cache.delete(first);
      }
      return p;
    },
    [voice, rate],
  );

  const unlockAudio = useCallback(async (): Promise<boolean> => {
    const audio = ensureAudio();
    if (!audio) return false;
    tokenRef.current++; // cancel any older status announcement or answer
    manualStopRef.current = true;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    try {
      await primeAudioElement(audio);
      manualStopRef.current = false;
      setSpeaking(false);
      setPlaybackBlocked(false);
      return true;
    } catch {
      setSpeaking(false);
      setPlaybackBlocked(true);
      return false;
    }
  }, [ensureAudio]);

  // Speak via backend MP3 (preferred) with SpeechSynthesis fallback.
  const speak = useCallback(
    (text: string, onEnd?: () => void) => {
      if (typeof window === "undefined") return;
      const myToken = ++tokenRef.current;
      manualStopRef.current = false;

      const fallbackToSpeech = () => {
        if (myToken !== tokenRef.current) return;
        if (!("speechSynthesis" in window)) {
          setPlaybackBlocked(true);
          return;
        }
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = rate;
        u.pitch = 1;
        u.lang = "en-US";
        u.onstart = () => {
          setPlaybackBlocked(false);
          setSpeaking(true);
        };
        u.onend = () => {
          setSpeaking(false);
          if (!manualStopRef.current && onEnd) onEnd();
        };
        u.onerror = () => setSpeaking(false);
        window.speechSynthesis.speak(u);
      };

      const audio = ensureAudio();
      if (!audio) return fallbackToSpeech();

      fetchVoice(text)
        .then(async (blob) => {
          if (myToken !== tokenRef.current) return;
          const url = URL.createObjectURL(blob);
          audio.src = url;
          audio.playbackRate = 1; // server already applied speed
          audio.onplay = () => {
            if (myToken === tokenRef.current) {
              setPlaybackBlocked(false);
              setSpeaking(true);
            }
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
          } catch (error) {
            URL.revokeObjectURL(url);
            if (myToken !== tokenRef.current) return;
            setSpeaking(false);
            // Autoplay rejection needs another real tap. SpeechSynthesis is
            // blocked by the same policy and can silently stall the queue.
            if ((error as DOMException).name === "NotAllowedError") {
              setPlaybackBlocked(true);
              return;
            }
            fallbackToSpeech();
          }
        })
        .catch(() => {
          // A temporary voice-service failure must not disable backend audio
          // for every later line. Try the good voice again on the next step.
          fallbackToSpeech();
        });
    },
    [rate, ensureAudio, fetchVoice],
  );

  const findFlatIdx = useCallback((ii: number, si: number) => {
    return flatRef.current.findIndex((f) => f.itemIdx === ii && f.stepIdx === si);
  }, []);

  const playFrom = useCallback(
    (ii: number, si: number) => {
      const flat = flatRef.current;
      const start = findFlatIdx(ii, si);
      if (start < 0) return;
      runningRef.current = true;
      const playIdx = (k: number) => {
        // New answers may arrive while this line plays. Never capture an old tail.
        const currentFlat = flatRef.current;
        if (k >= currentFlat.length) { runningRef.current = false; return; }
        const cur = currentFlat[k];
        if (!cur) return;
        currentItemIdxRef.current = cur.itemIdx;
        stepIdxRef.current = cur.stepIdx;
        setCurrentItemIdx(cur.itemIdx);
        setStepIdx(cur.stepIdx);
        speak(cur.text, () => playIdx(k + 1));
        const nxt = currentFlat[k + 1];
        if (nxt) void fetchVoice(nxt.text).catch(() => undefined);
      };
      playIdx(start);
    },
    [findFlatIdx, speak, fetchVoice],
  );

  const addItem = useCallback(
    (item: TtsItem, autoPlay = true) => {
      const next = [...itemsRef.current, item];
      itemsRef.current = next;
      flatRef.current = next.flatMap((it, itemIdx) => it.steps.map((text, stepIdx) => ({ itemIdx, stepIdx, text })));
      setItems(next);
      if (autoPlay) playFrom(next.length - 1, 0);
    },
    [playFrom],
  );

  const enqueueItem = useCallback((item: TtsItem) => {
    const newIndex = itemsRef.current.length;
    addItem(item, false);
    // During playback (including voice download) leave the current line alone.
    // Explicit pause/stop and autoplay rejection must also remain respected.
    if (!runningRef.current && !manualStopRef.current) playFrom(newIndex, 0);
  }, [addItem, playFrom]);

  const speakNow = useCallback((text: string) => speak(text), [speak]);

  const stop = useCallback(() => {
    runningRef.current = false;
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

  // NEXT = skip to next QUESTION (item). Loops back to first item at end.
  const next = useCallback(() => {
    const flat = flatRef.current;
    if (flat.length === 0) return;
    const curItem = currentItemIdxRef.current;
    // find first flat entry belonging to next item
    let targetItem = curItem + 1;
    const totalItems = items.length;
    if (targetItem >= totalItems) targetItem = 0; // loop
    const jump = flat.find((f) => f.itemIdx === targetItem);
    if (!jump) return;
    stop();
    setTimeout(() => playFrom(jump.itemIdx, jump.stepIdx), 80);
  }, [items.length, stop, playFrom]);

  // PREV = seek back 10 seconds inside the current audio (memorization rewind).
  // If the current audio has no seekable position (short clip / speech-synth),
  // fall back to previous spoken step.
  const prev = useCallback(() => {
    const a = audioRef.current;
    if (a && !a.paused && Number.isFinite(a.currentTime) && a.currentTime > 0.5) {
      const target = Math.max(0, a.currentTime - 10);
      try {
        a.currentTime = target;
        return;
      } catch { /* fall through */ }
    }
    const ii = currentItemIdxRef.current;
    const si = stepIdxRef.current;
    const k = findFlatIdx(ii, si);
    const flat = flatRef.current;
    if (k <= 0) {
      stop();
      setTimeout(() => playFrom(ii, si), 80);
      return;
    }
    const p = flat[k - 1];
    if (!p) return;
    stop();
    setTimeout(() => playFrom(p.itemIdx, p.stepIdx), 80);
  }, [findFlatIdx, stop, playFrom]);

  const replay = useCallback(() => {
    const ii = currentItemIdxRef.current;
    const si = stepIdxRef.current;
    stop();
    // This also serves as the visible "Play answer" recovery after an iPhone
    // autoplay rejection: prime the real player during this button tap.
    void unlockAudio().then(() => playFrom(ii, si));
  }, [stop, unlockAudio, playFrom]);

  // Pause / resume without destroying position — used by lock-screen play/pause
  // and the "stop / continue" ring button.
  const pauseResume = useCallback(() => {
    const a = audioRef.current;
    if (a && !a.paused) {
      manualStopRef.current = true;
      try { a.pause(); } catch { /* ignore */ }
      setSpeaking(false);
      return;
    }
    if (a && a.src && a.currentTime > 0 && a.currentTime < (a.duration || Infinity)) {
      manualStopRef.current = false;
      a.play().then(() => {
        setPlaybackBlocked(false);
        setSpeaking(true);
      }).catch(() => setPlaybackBlocked(true));
      return;
    }
    // Nothing paused — replay current step using an unlocked player.
    const ii = currentItemIdxRef.current;
    const si = stepIdxRef.current;
    void unlockAudio().then(() => playFrom(ii, si));
  }, [playFrom, unlockAudio]);

  // Media Session — lock-screen / earbud / Bluetooth-ring controls
  useEffect(() => {
    if (!mediaSessionOn) return; // Phone Audio Mode owns the lock-screen controls
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
    bind("play", pauseResume);
    bind("pause", pauseResume);
    bind("nexttrack", next);
    bind("previoustrack", prev);
    bind("seekbackward", prev);
    bind("seekforward", next);
  }, [mediaSessionOn, items, currentItemIdx, stepIdx, speaking, next, prev, replay, stop, pauseResume]);

  return {
    items,
    currentItemIdx,
    stepIdx,
    speaking,
    playbackBlocked,
    rate,
    setRate,
    addItem,
    enqueueItem,
    speakNow,
    unlockAudio,
    next,
    prev,
    replay,
    stop,
    pauseResume,
  };
}
