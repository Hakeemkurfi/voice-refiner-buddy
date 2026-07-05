import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Rewind,
  FastForward,
  Download,
  Headphones,
  Upload,
  Sparkles,
} from "lucide-react";
import physics2Mp3 from "@/assets/physics-2-study.mp3.asset.json";

type Chapter = { n: number; title: string; startSec: number; endSec: number };

const LS_KEY = "study-pack:state:v1";

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function parseTs(s: string): number {
  // "HH:MM:SS.mmm"
  const [hms, ms] = s.split(".");
  const [hh, mm, ss] = hms.split(":").map((x) => parseInt(x, 10));
  return hh * 3600 + mm * 60 + ss + (ms ? parseInt(ms, 10) / 1000 : 0);
}

function parseChapters(md: string): Chapter[] {
  const chapters: Chapter[] = [];
  // Match "### Chapter N. Title" ... "Audio:** chapter N @ START–END"
  const headerRe = /###\s+Chapter\s+(\d+)\.\s+([^\n]+)/g;
  const audioRe = /\*\*Audio:\*\*\s+chapter\s+\d+\s+@\s+([\d:.]+)[–\-]([\d:.]+)/;
  const parts = md.split(/(?=###\s+Chapter\s+\d+\.)/);
  for (const part of parts) {
    headerRe.lastIndex = 0;
    const h = headerRe.exec(part);
    if (!h) continue;
    const n = parseInt(h[1], 10);
    const title = h[2].trim();
    const a = audioRe.exec(part);
    if (!a) continue;
    chapters.push({
      n,
      title,
      startSec: parseTs(a[1]),
      endSec: parseTs(a[2]),
    });
  }
  chapters.sort((a, b) => a.n - b.n);
  return chapters;
}

export function StudyPack() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string>("");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const restoredRef = useRef(false);

  // Load persisted UI state on mount (position + last chapter only — files can't persist).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.currentIdx === "number") setCurrentIdx(s.currentIdx);
        if (typeof s.pos === "number") setPos(s.pos);
      }
    } catch { /* ignore */ }
  }, []);

  const persist = useCallback((patch: Partial<{ currentIdx: number; pos: number; audioName: string }>) => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const cur = raw ? JSON.parse(raw) : {};
      localStorage.setItem(LS_KEY, JSON.stringify({ ...cur, ...patch }));
    } catch { /* ignore */ }
  }, []);

  const onAudioFile = useCallback((f: File | null) => {
    if (!f) return;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const url = URL.createObjectURL(f);
    setAudioUrl(url);
    setAudioName(f.name);
    persist({ audioName: f.name });
  }, [audioUrl, persist]);

  const onMdFile = useCallback(async (f: File | null) => {
    if (!f) return;
    const text = await f.text();
    setChapters(parseChapters(text));
  }, []);

  // Sync currentIdx from audio position
  const chaptersRef = useRef<Chapter[]>([]);
  useEffect(() => { chaptersRef.current = chapters; }, [chapters]);

  const findChapterForTime = useCallback((t: number): number => {
    const chs = chaptersRef.current;
    if (!chs.length) return 0;
    for (let i = 0; i < chs.length; i++) {
      if (t >= chs[i].startSec && t < chs[i].endSec) return i;
    }
    return chs.length - 1;
  }, []);

  const jumpToChapter = useCallback((idx: number) => {
    const a = audioRef.current;
    const chs = chaptersRef.current;
    if (!a || !chs[idx]) return;
    a.currentTime = chs[idx].startSec + 0.01;
    setCurrentIdx(idx);
    persist({ currentIdx: idx, pos: chs[idx].startSec });
    a.play().catch(() => { /* user gesture may be required first */ });
  }, [persist]);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => { /* ignore */ });
    else a.pause();
  }, []);

  const nextChapter = useCallback(() => {
    const chs = chaptersRef.current;
    if (!chs.length) {
      const a = audioRef.current;
      if (a) a.currentTime = Math.min((a.duration || 0), a.currentTime + 30);
      return;
    }
    const target = Math.min(chs.length - 1, currentIdx + 1);
    jumpToChapter(target);
  }, [currentIdx, jumpToChapter]);

  const prevChapter = useCallback(() => {
    const chs = chaptersRef.current;
    if (!chs.length) {
      const a = audioRef.current;
      if (a) a.currentTime = Math.max(0, a.currentTime - 30);
      return;
    }
    const a = audioRef.current;
    // If more than 3s into the chapter, restart it; else go to previous.
    const cur = chs[currentIdx];
    if (a && cur && a.currentTime - cur.startSec > 3) {
      jumpToChapter(currentIdx);
    } else {
      jumpToChapter(Math.max(0, currentIdx - 1));
    }
  }, [currentIdx, jumpToChapter]);

  const seek = useCallback((delta: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min((a.duration || 0), a.currentTime + delta));
  }, []);

  // MediaSession wiring — lock-screen + BLE ring control.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const ch = chapters[currentIdx];
    ms.metadata = new MediaMetadata({
      title: ch ? `Ch ${ch.n}. ${ch.title}` : audioName || "Study Pack",
      artist: "Smart Audio Tutor",
      album: chapters.length ? `${chapters.length} chapters` : "Study Pack",
    });
    ms.playbackState = playing ? "playing" : "paused";
    const bind = (act: MediaSessionAction, fn: () => void) => {
      try { ms.setActionHandler(act, fn); } catch { /* unsupported */ }
    };
    bind("play", togglePlay);
    bind("pause", togglePlay);
    bind("nexttrack", nextChapter);
    bind("previoustrack", prevChapter);
    bind("seekforward", () => seek(10));
    bind("seekbackward", () => seek(-10));
  }, [chapters, currentIdx, playing, audioName, togglePlay, nextChapter, prevChapter, seek]);

  // Keyboard shortcuts (desktop testing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      else if (e.code === "ArrowRight" || e.key === "l") nextChapter();
      else if (e.code === "ArrowLeft" || e.key === "j") prevChapter();
      else if (e.key === "]") seek(10);
      else if (e.key === "[") seek(-10);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, nextChapter, prevChapter, seek]);

  // Audio element event bindings.
  const onLoaded = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    setDur(a.duration || 0);
    if (!restoredRef.current) {
      restoredRef.current = true;
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
          const s = JSON.parse(raw);
          if (typeof s.pos === "number" && s.pos > 0 && s.pos < (a.duration || 0)) {
            a.currentTime = s.pos;
          }
        }
      } catch { /* ignore */ }
    }
  }, []);

  const onTimeUpdate = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    setPos(a.currentTime);
    const idx = findChapterForTime(a.currentTime);
    if (idx !== currentIdx) setCurrentIdx(idx);
    // persist every ~2s to avoid thrash
    if (Math.floor(a.currentTime) % 2 === 0) {
      persist({ currentIdx: idx, pos: a.currentTime });
    }
  }, [currentIdx, findChapterForTime, persist]);

  const totalDur = useMemo(() => dur, [dur]);
  const current = chapters[currentIdx];

  return (
    <Card className="p-4 border-primary/30 bg-primary/5">
      <div className="flex items-start gap-3 mb-3">
        <Headphones className="h-5 w-5 text-primary mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-sm">Study Pack</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Load your ready-made mp3 + chapter markdown. Play once, lock the phone, and drive it from
            your Bluetooth ring: middle = play/pause, right = next chapter, left = prev chapter.
          </p>
        </div>
        {chapters.length > 0 && (
          <Badge variant="secondary" className="shrink-0">{chapters.length} chapters</Badge>
        )}
      </div>

      {/* File pickers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        <label className="flex items-center gap-2 rounded-md border border-dashed border-input px-3 py-2 text-xs cursor-pointer hover:bg-accent">
          <Upload className="h-3.5 w-3.5" />
          <span className="truncate">{audioName || "Choose mp3…"}</span>
          <input
            type="file"
            accept="audio/*,.mp3"
            className="hidden"
            onChange={(e) => onAudioFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label className="flex items-center gap-2 rounded-md border border-dashed border-input px-3 py-2 text-xs cursor-pointer hover:bg-accent">
          <Upload className="h-3.5 w-3.5" />
          <span className="truncate">
            {chapters.length ? `${chapters.length} chapters loaded` : "Choose chapters .md (optional)"}
          </span>
          <input
            type="file"
            accept=".md,text/markdown,text/plain"
            className="hidden"
            onChange={(e) => onMdFile(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      {/* Player */}
      {audioUrl ? (
        <>
          <audio
            ref={audioRef}
            src={audioUrl}
            controls
            preload="auto"
            className="w-full mb-3"
            onLoadedMetadata={onLoaded}
            onTimeUpdate={onTimeUpdate}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />

          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Button size="sm" variant="outline" onClick={() => seek(-10)} className="gap-1">
              <Rewind className="h-3.5 w-3.5" />−10s
            </Button>
            <Button size="sm" variant="outline" onClick={prevChapter} className="gap-1">
              <SkipBack className="h-3.5 w-3.5" />Prev
            </Button>
            <Button size="sm" onClick={togglePlay} className="gap-1">
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {playing ? "Pause" : "Play"}
            </Button>
            <Button size="sm" variant="outline" onClick={nextChapter} className="gap-1">
              Next<SkipForward className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => seek(10)} className="gap-1">
              +10s<FastForward className="h-3.5 w-3.5" />
            </Button>
            <a
              href={audioUrl}
              download={audioName || "study-pack.mp3"}
              className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Download className="h-3.5 w-3.5" /> Download mp3
            </a>
          </div>

          {current && (
            <div className="rounded-md bg-background/60 border p-2 mb-3 text-xs">
              <div className="font-semibold">
                Now playing — Ch {current.n}. {current.title}
              </div>
              <div className="text-muted-foreground mt-0.5">
                {fmt(pos)} / {fmt(totalDur)} · chapter {fmt(current.startSec)}–{fmt(current.endSec)}
              </div>
            </div>
          )}

          {chapters.length > 0 && (
            <div className="max-h-72 overflow-y-auto rounded-md border divide-y">
              {chapters.map((ch, i) => {
                const active = i === currentIdx;
                return (
                  <button
                    key={ch.n}
                    onClick={() => jumpToChapter(i)}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-accent ${
                      active ? "bg-primary/10 font-semibold text-primary" : ""
                    }`}
                  >
                    <span className="tabular-nums shrink-0 w-6 text-right">{ch.n}.</span>
                    <span className="flex-1 truncate">{ch.title}</span>
                    <span className="tabular-nums text-muted-foreground shrink-0">
                      {fmt(ch.startSec)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground italic">
          Pick your mp3 above to load the player. The file stays on your phone — nothing is uploaded.
        </p>
      )}
    </Card>
  );
}
