import { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { nextTarget, previousTarget } from "@/lib/pi-answer";

// Phone Audio Mode: plays Pi answers part by part on this phone.
// Each part is fully downloaded before it plays; only the next part is preloaded.
// No browser-speech fallback: if a part can't download we wait and retry.

type Answer = {
  question_id: string;
  capture_sequence: number;
  revision: number;
  sections: string[];
  voice: string | null;
  title: string | null;
  status: string;
  error: string | null;
  event_cursor: number;
};

const TOKEN_KEY = "axon-phone-token";
const CURSOR_KEY = "axon-phone-cursor";

function silentWavUrl() {
  const n = 800; // 0.1 s at 8 kHz
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, "data"); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

export function PiPhonePlayer({ enabled, onEnabledChange }: { enabled: boolean; onEnabledChange: (v: boolean) => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pairMsg, setPairMsg] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [banner, setBanner] = useState("");
  const [status, setStatus] = useState("");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const answerRef = useRef<Answer | null>(null);
  const indexRef = useRef(0);
  const playIdRef = useRef(0);
  const cacheRef = useRef(new Map<string, string>()); // key qid:rev:i -> blob url
  const cursorRef = useRef<number | null>(null);
  const cmdCursorRef = useRef(0);
  const pollingRef = useRef(false);
  const cmdPrimedRef = useRef(false);

  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_KEY));
    const c = localStorage.getItem(CURSOR_KEY);
    cursorRef.current = c ? Number(c) : null;
  }, []);

  const audio = () => {
    if (!audioRef.current) {
      const a = new Audio();
      a.preload = "auto";
      audioRef.current = a;
    }
    return audioRef.current;
  };
  const key = (a: Answer, i: number) => `${a.question_id}:${a.revision}:${i}`;

  const dropCacheExcept = (keep: string[]) => {
    for (const [k, url] of cacheRef.current) {
      if (!keep.includes(k)) {
        URL.revokeObjectURL(url);
        cacheRef.current.delete(k);
      }
    }
  };

  const download = useCallback(async (a: Answer, i: number): Promise<string> => {
    const k = key(a, i);
    const hit = cacheRef.current.get(k);
    if (hit) return hit;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch("/api/public/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: a.sections[i], ...(a.voice ? { voice: a.voice } : {}) }),
        });
        if (!res.ok) throw new Error(`voice ${res.status}`);
        const blob = await res.blob(); // whole part downloaded before playing
        const url = URL.createObjectURL(blob);
        cacheRef.current.set(k, url);
        return url;
      } catch {
        if (answerRef.current?.question_id !== a.question_id) throw new Error("replaced");
        setStatus("Waiting for the network to get the next part...");
        await new Promise((r) => setTimeout(r, Math.min(8000, 1500 * (attempt + 1))));
      }
    }
  }, []);

  const playPart = useCallback(
    async (i: number) => {
      const a = answerRef.current;
      if (!a || i < 0 || i >= a.sections.length) return;
      const myId = ++playIdRef.current;
      indexRef.current = i;
      setIndex(i);
      setStatus("Getting the voice ready...");
      let url: string;
      try {
        url = await download(a, i);
      } catch {
        return;
      }
      if (myId !== playIdRef.current) return;
      const el = audio();
      el.src = url;
      el.onended = () => {
        if (myId !== playIdRef.current) return;
        const n = nextTarget(indexRef.current, answerRef.current?.sections.length ?? 0);
        if (n === null) {
          setPlaying(false);
          setStatus("Answer finished. Waiting for the next photo.");
        } else void playPart(n);
      };
      try {
        await el.play();
        setPlaying(true);
        setStatus("");
      } catch {
        setPlaying(false);
        setStatus("Tap play to start the answer.");
      }
      // preload only the next part
      const keep = [key(a, i)];
      if (i + 1 < a.sections.length) {
        keep.push(key(a, i + 1));
        download(a, i + 1).catch(() => {});
      }
      dropCacheExcept(keep);
    },
    [download],
  );

  const stopAll = useCallback(() => {
    playIdRef.current++;
    try { audioRef.current?.pause(); } catch { /* ignore */ }
    setPlaying(false);
  }, []);

  const goPrev = useCallback(() => {
    const t = audioRef.current?.currentTime ?? 0;
    void playPart(previousTarget(indexRef.current, t));
  }, [playPart]);
  const goNext = useCallback(() => {
    const n = nextTarget(indexRef.current, answerRef.current?.sections.length ?? 0);
    if (n !== null) void playPart(n);
  }, [playPart]);
  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (el && el.src && !el.paused) {
      el.pause();
      setPlaying(false);
    } else if (el && el.src && el.currentTime > 0 && !el.ended) {
      el.play().then(() => setPlaying(true)).catch(() => {});
    } else if (answerRef.current) void playPart(indexRef.current);
  }, [playPart]);

  // Poll the relay while the page is awake.
  const poll = useCallback(async () => {
    if (!enabled || !token || pollingRef.current) return;
    pollingRef.current = true;
    try {
      const first = cursorRef.current === null;
      let more = true;
      let latest: Answer | null = null;
      const superseded = new Set<string>();
      while (more) {
        const res = await fetch(`/api/public/pi-answer?after=${cursorRef.current ?? 0}&cmd_after=${cmdCursorRef.current}`, {
          headers: { "X-Axon-Device-Token": token },
          cache: "no-store",
        });
        if (res.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
          setPairMsg("This phone is no longer paired. Enter a new code.");
          return;
        }
        if (!res.ok) throw new Error("poll");
        const d = (await res.json()) as {
          answers: Answer[]; cursor: number; more: boolean;
          commands: { action: string; question_id: string | null }[]; cmd_cursor: number;
        };
        for (const a of d.answers) {
          if (a.status === "superseded" || a.status === "capturing") superseded.add(a.question_id);
          if (a.status === "ready" || a.status === "failed") {
            if (!latest || a.capture_sequence >= latest.capture_sequence) latest = a;
          }
        }
        cursorRef.current = d.cursor;
        localStorage.setItem(CURSOR_KEY, String(d.cursor));
        const cmdsFresh = cmdPrimedRef.current;
        cmdPrimedRef.current = true;
        cmdCursorRef.current = d.cmd_cursor;
        if (cmdsFresh) {
          for (const c of d.commands) {
            if (c.question_id && c.question_id !== answerRef.current?.question_id) continue;
            if (c.action === "prev") goPrev();
            if (c.action === "next") goNext();
          }
        }
        more = d.more;
      }
      const cur = answerRef.current;
      if (latest) {
        const isNewer =
          !cur ||
          latest.capture_sequence > cur.capture_sequence ||
          (latest.question_id === cur.question_id && latest.revision > cur.revision);
        if (isNewer) {
          if (latest.status === "failed") {
            stopAll();
            setStatus(`The Pi couldn't answer that photo: ${latest.error ?? "unknown problem"}`);
            return;
          }
          stopAll();
          dropCacheExcept([]);
          answerRef.current = latest;
          setAnswer(latest);
          setIndex(0);
          indexRef.current = 0;
          setBanner(`New answer (${latest.sections.length} parts)`);
          if (first) setStatus("Tap play to hear the latest answer.");
          else void playPart(0);
          return;
        }
      }
      if (cur && superseded.size) {
        // Someone took a new photo; its answer is on the way.
        stopAll();
        setStatus("New photo taken. Waiting for its answer...");
      }
    } catch {
      setStatus("Can't reach Axon right now. Retrying...");
    } finally {
      pollingRef.current = false;
    }
  }, [enabled, token, goNext, goPrev, playPart, stopAll]);

  useEffect(() => {
    if (!enabled || !token) return;
    void poll();
    const t = window.setInterval(() => void poll(), 3000);
    const wake = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
    };
  }, [enabled, token, poll]);

  useEffect(() => {
    if (!enabled) stopAll();
  }, [enabled, stopAll]);

  // Lock-screen / earbud controls
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({
      title: answer ? `${answer.title ?? "Pi answer"} — part ${index + 1} of ${answer.sections.length}` : "Axon phone output",
      artist: "Axon",
      album: "Pi answers",
    });
    ms.playbackState = playing ? "playing" : "paused";
    const bind = (a: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
      try { ms.setActionHandler(a, fn); } catch { /* unsupported */ }
    };
    bind("play", togglePlay);
    bind("pause", togglePlay);
    bind("nexttrack", goNext);
    bind("previoustrack", goPrev);
    bind("seekbackward", () => { const el = audioRef.current; if (el) el.currentTime = Math.max(0, el.currentTime - 10); });
    bind("seekforward", () => { const el = audioRef.current; if (el && Number.isFinite(el.duration)) el.currentTime = Math.min(el.duration - 0.1, el.currentTime + 10); });
  }, [enabled, answer, index, playing, togglePlay, goNext, goPrev]);

  const pair = async () => {
    setPairMsg("Pairing...");
    try {
      const res = await fetch("/api/public/pi-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "pair", code: code.trim() }),
      });
      const d = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !d.token) return setPairMsg(d.error ?? "Pairing failed.");
      localStorage.setItem(TOKEN_KEY, d.token);
      localStorage.removeItem(CURSOR_KEY);
      cursorRef.current = null;
      setToken(d.token);
      setCode("");
      setPairMsg("Paired. This phone will now get your Pi answers.");
    } catch {
      setPairMsg("Pairing failed. Check the internet and try again.");
    }
  };

  const startListening = () => {
    // A tap unlocks audio on iPhone so later parts can play on their own.
    const el = audio();
    if (!el.src) {
      el.src = silentWavUrl();
      el.play().catch(() => {});
    }
    togglePlay();
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Headphones className="h-5 w-5 text-primary mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-sm">Phone output (Pi answers)</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Pi photos are answered as usual, then played here through your earbuds.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} aria-label="Phone output (Pi answers)" />
      </div>

      {enabled && !token && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Enter the 6-digit pairing code from your Pi.</p>
          <div className="flex gap-2">
            <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" />
            <Button onClick={pair} disabled={code.length !== 6}>Pair phone</Button>
          </div>
        </div>
      )}
      {pairMsg && <p className="text-xs text-muted-foreground">{pairMsg}</p>}

      {enabled && token && (
        <div className="space-y-2">
          {banner && (
            <div className="rounded-md bg-primary/10 text-primary px-3 py-2 text-sm font-medium" onClick={() => setBanner("")}>
              {banner}
            </div>
          )}
          {answer ? (
            <>
              <p className="text-xs text-muted-foreground">Part {index + 1} of {answer.sections.length}</p>
              <p className="text-sm whitespace-pre-wrap">{answer.sections[index]}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Waiting for a photo from the Pi.</p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={goPrev} disabled={!answer} aria-label="Previous part"><SkipBack className="h-4 w-4" /></Button>
            <Button onClick={startListening} className="flex-1 gap-2">
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {playing ? "Pause" : answer ? "Play" : "Start listening"}
            </Button>
            <Button variant="outline" size="icon" onClick={goNext} disabled={!answer} aria-label="Next part"><SkipForward className="h-4 w-4" /></Button>
          </div>
          {status && <p className="text-xs text-muted-foreground">{status}</p>}
          <button
            className="text-xs underline text-muted-foreground"
            onClick={() => {
              localStorage.removeItem(TOKEN_KEY);
              localStorage.removeItem(CURSOR_KEY);
              setToken(null);
              stopAll();
            }}
          >
            Unpair this phone
          </button>
        </div>
      )}
    </Card>
  );
}
