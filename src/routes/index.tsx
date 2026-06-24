import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { analyzeImage } from "@/lib/analyze.functions";
import { useTtsQueue } from "@/hooks/use-tts-queue";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Camera,
  SkipBack,
  SkipForward,
  RotateCcw,
  Square,
  Loader2,
  Wifi,
  WifiOff,
  Volume2,
  RefreshCw,
  FileText,
  Layers,
  Power,
  PowerOff,
  RotateCw,
  FlipHorizontal,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Smart Audio Tutor — ESP32 Camera" },
      {
        name: "description",
        content:
          "Capture math, physics or notes with your ESP32-S3-CAM and listen to a step-by-step explanation in your earbuds.",
      },
    ],
  }),
  component: Index,
});

type EventRow = {
  id: string;
  type: "capture" | "next" | "prev" | "replay" | "stop" | "trigger";
  image_b64: string | null;
  image_chars?: number;
  device_id: string | null;
  created_at: string;
};

function Index() {
  const tts = useTtsQueue();
  const {
    addItem,
    speakNow,
    next: playNext,
    prev: playPrev,
    replay: replayTts,
    stop: stopTts,
  } = tts;
  const analyze = useServerFn(analyzeImage);
  const [realtimeOnline, setRealtimeOnline] = useState(false);
  const [serverReachable, setServerReachable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastImage, setLastImage] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<string>("");
  const [usedModel, setUsedModel] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [status, setStatus] = useState("Checking the bridge between ESP32 and the app...");
  const [contextText, setContextText] = useState("");
  const [log, setLog] = useState<
    { t: string; type: string; id: string; device: string; imageChars: number; source: string }[]
  >([]);
  const seenRef = useRef<Set<string>>(new Set());
  const contextRef = useRef("");
  const hasPriorResultRef = useRef(false);
  const appStartedAtRef = useRef(Date.now());
  const busyRef = useRef(false);
  const [nextInCountdown, setNextInCountdown] = useState(0);

  // ── Camera ON/OFF controls ─────────────────────────────────────────────────
  const [esp32Ip, setEsp32Ip] = useState(() =>
    typeof window === "undefined" ? "" : localStorage.getItem("esp32ip") ?? "",
  );
  const [cameraOn, setCameraOn] = useState<boolean | null>(null); // null = unknown
  const [cameraToggling, setCameraToggling] = useState(false);
  // Image display rotation (for correcting sideways captures)
  const [imgRotation, setImgRotation] = useState(0); // 0, 90, 180, 270
  const [imgMirror, setImgMirror] = useState(false);

  const saveEsp32Ip = (ip: string) => {
    setEsp32Ip(ip);
    if (typeof window !== "undefined") localStorage.setItem("esp32ip", ip);
  };

  const toggleCameraOnEsp32 = useCallback(async () => {
    if (!esp32Ip) {
      setError("Enter your ESP32 IP address first (shown in Serial Monitor after boot).");
      return;
    }
    setCameraToggling(true);
    try {
      const res = await fetch(`http://${esp32Ip}/cam`, {
        method: "GET",
        signal: AbortSignal.timeout(6000),
        mode: "no-cors", // ESP32 local server doesn't send CORS headers
      });
      // no-cors → response is opaque, assume success if no network error
      setCameraOn((prev) => (prev === null ? true : !prev));
      setStatus(`Camera toggled via ESP32 at ${esp32Ip}.`);
    } catch (e) {
      // If CORS blocks it, the toggle was still sent to the ESP32 and works.
      // We just can't read the response. Flip state optimistically.
      setCameraOn((prev) => (prev === null ? true : !prev));
      setStatus(`Camera toggle sent to ${esp32Ip} (response blocked by CORS — that's OK).`);
    } finally {
      setCameraToggling(false);
    }
  }, [esp32Ip]);

  // ──────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    contextRef.current = contextText;
  }, [contextText]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const sayStatus = useCallback(
    (message: string) => {
      setStatus(message);
      if (audioUnlocked) speakNow(message);
    },
    [audioUnlocked, speakNow],
  );

  const handleCapture = useCallback(async (
    arg: { image_b64?: string; burst_id?: string },
    model: "flash" | "pro" = "flash",
  ) => {
    setBusy(true);
    setError(null);
    setLastImage(arg.image_b64 ?? null);
    setExtracted("");
    setUsedModel("");
    sayStatus(
      arg.burst_id
        ? "Burst received. Reading the sharpest frames now."
        : model === "pro"
          ? "Re-analyzing with the stronger model."
          : "Picture received. I am analyzing it now.",
    );
    try {
      const out = await analyze({
        data: {
          image_b64: arg.image_b64,
          burst_id: arg.burst_id,
          contextText: contextRef.current,
          model,
        },
      });

      if (hasPriorResultRef.current) {
        stopTts();
        sayStatus("New problem ready. Starting in 5 seconds.");
        for (let s = 5; s >= 1; s--) {
          setNextInCountdown(s);
          await new Promise((r) => setTimeout(r, 1000));
        }
        setNextInCountdown(0);
      }

      addItem({ id: crypto.randomUUID(), title: out.title, steps: out.steps }, true);
      hasPriorResultRef.current = true;
      setExtracted(out.extractedText ?? "");
      setUsedModel(
        out.framesUsed > 1
          ? `${out.modelUsed} • ${out.framesUsed} frames`
          : out.modelUsed ?? "",
      );
      setStatus("Analysis ready. Reading the answer now.");
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      addItem(
        {
          id: crypto.randomUUID(),
          title: "Image received, analysis failed",
          steps: [
            "I received the picture from the ESP32, so the camera bridge is working.",
            `The AI analysis failed with this message: ${message}`,
            "Try another capture with stronger light, then watch the event log for the new image size.",
          ],
        },
        true,
      );
    } finally {
      setBusy(false);
    }
  }, [addItem, analyze, sayStatus, stopTts]);

  const processEvent = useCallback(
    (row: EventRow, source: string) => {
      if (seenRef.current.has(row.id)) return;
      const eventTime = new Date(row.created_at).getTime();
      if (source === "poll" && Number.isFinite(eventTime) && eventTime < appStartedAtRef.current - 10000) {
        seenRef.current.add(row.id);
        return;
      }
      if (source === "poll" && busyRef.current) {
        seenRef.current.add(row.id);
        return;
      }
      seenRef.current.add(row.id);
      const imageChars = row.image_b64?.length ?? row.image_chars ?? 0;
      setLog((l) =>
        [
          {
            t: new Date(row.created_at).toLocaleTimeString(),
            type: row.type,
            id: row.id.slice(0, 8),
            device: row.device_id ?? "unknown",
            imageChars,
            source,
          },
          ...l,
        ].slice(0, 30),
      );
      if (row.type === "capture") {
        const burstMatch = row.device_id?.match(/^burst:([0-9a-f-]{36})/i);
        if (burstMatch) {
          handleCapture({ burst_id: burstMatch[1], image_b64: row.image_b64 ?? undefined });
        } else if (row.image_b64) {
          handleCapture({ image_b64: row.image_b64 });
        } else {
          sayStatus("Capture message received, but there was no JPEG image attached.");
        }
      } else if (row.type === "next") {
        setStatus("Next command received from ESP32.");
        playNext();
      } else if (row.type === "prev") {
        setStatus("Previous command received from ESP32.");
        playPrev();
      } else if (row.type === "replay") {
        setStatus("Replay command received from ESP32.");
        replayTts();
      } else if (row.type === "stop") {
        setStatus("Stop command received from ESP32.");
        stopTts();
      }
    },
    [handleCapture, playNext, playPrev, replayTts, sayStatus, stopTts],
  );

  const checkServer = useCallback(async () => {
    try {
      const res = await fetch("/api/public/event", { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; recent?: EventRow[]; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      setServerReachable(true);
      const recent = json.recent ?? [];
      if (recent.length === 0) {
        setStatus("Server is reachable, but no ESP32 message has arrived yet.");
        return;
      }
      setStatus(`Server is reachable. Last event is ${recent[0].type} from ${recent[0].device_id ?? "unknown device"}.`);
      recent.slice().reverse().forEach((row) => processEvent(row, "poll"));
    } catch (e) {
      setServerReachable(false);
      setStatus(`Server check failed: ${(e as Error).message}`);
    }
  }, [processEvent]);

  useEffect(() => {
    checkServer();
    const timer = window.setInterval(checkServer, 3000);
    return () => window.clearInterval(timer);
  }, [checkServer]);

  // ── Ring keyboard listener ─────────────────────────────────────────────────
  const triggerEspCapture = useCallback(async () => {
    setStatus("Ring → asking ESP32 to take a fresh capture…");
    try {
      const res = await fetch("/api/public/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: "ring-remote" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      sayStatus("Capture requested. Hold the camera steady on the page.");
    } catch (e) {
      setError(`Trigger failed: ${(e as Error).message}`);
    }
  }, [sayStatus]);

  const toggleStopResume = useCallback(() => {
    if (tts.speaking) {
      setStatus("Ring → stop speech.");
      stopTts();
    } else {
      setStatus("Ring → resume / replay.");
      replayTts();
    }
  }, [tts.speaking, stopTts, replayTts]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable) return;

      const k = e.key;
      let handled = true;
      switch (k) {
        case " ":
        case "Spacebar":
        case "MediaPlayPause":
          toggleStopResume();
          break;
        case "ArrowUp":
        case "PageUp":
        case "AudioVolumeUp":
          setStatus("Ring ▲ → Replay last answer.");
          replayTts();
          break;
        case "ArrowDown":
        case "PageDown":
        case "AudioVolumeDown":
          if (lastImage) {
            setStatus("Ring ▼ → Re-analyzing with Pro model.");
            handleCapture({ image_b64: lastImage }, "pro");
          } else {
            setStatus("Ring ▼ pressed, but no image to re-analyze yet.");
          }
          break;
        case "ArrowLeft":
        case "MediaTrackPrevious":
          setStatus("Ring ◀ → Previous.");
          playPrev();
          break;
        case "ArrowRight":
        case "MediaTrackNext":
          setStatus("Ring ▶ → Next.");
          playNext();
          break;
        case "Enter":
        case "m":
        case "M":
          setStatus("Ring M → Trigger capture on ESP32.");
          triggerEspCapture();
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true } as EventListenerOptions);
  }, [toggleStopResume, replayTts, lastImage, handleCapture, playPrev, playNext, triggerEspCapture]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.setActionHandler("play", toggleStopResume);
      ms.setActionHandler("pause", toggleStopResume);
      ms.setActionHandler("nexttrack", () => { setStatus("Ring ▶ → Next."); playNext(); });
      ms.setActionHandler("previoustrack", () => { setStatus("Ring ◀ → Previous."); playPrev(); });
      ms.setActionHandler("seekforward", () => { setStatus("Ring ▼ → Re-analyze with Pro."); if (lastImage) handleCapture({ image_b64: lastImage }, "pro"); });
      ms.setActionHandler("seekbackward", () => { setStatus("Ring ▲ → Replay."); replayTts(); });
    } catch { /* ignore */ }
    return () => {
      try {
        ms.setActionHandler("play", null);
        ms.setActionHandler("pause", null);
        ms.setActionHandler("nexttrack", null);
        ms.setActionHandler("previoustrack", null);
        ms.setActionHandler("seekforward", null);
        ms.setActionHandler("seekbackward", null);
      } catch { /* ignore */ }
    };
  }, [toggleStopResume, playNext, playPrev, lastImage, handleCapture, replayTts]);

  const unlockAudio = () => {
    if (typeof window === "undefined") return;
    try {
      const a = new Audio(
        "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=",
      );
      a.volume = 0.01;
      a.play().catch(() => {});
    } catch { /* ignore */ }
    try {
      if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0.01;
        window.speechSynthesis.speak(u);
      }
    } catch { /* ignore */ }
    tts.speakNow("Audio is ready. I will speak when a picture arrives.");
    setAudioUnlocked(true);
    setStatus("Audio is enabled. The voice will keep playing even if your phone screen locks.");
  };

  const loadGuideFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setContextText(text.slice(0, 12000));
    setStatus("Class guide loaded. The next picture will use this material.");
  };

  const fileToBase64 = async (file: File, maxEdge = 1600, quality = 0.85): Promise<string> => {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const img: HTMLImageElement = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d unsupported");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const jpeg = canvas.toDataURL("image/jpeg", quality);
    return jpeg.split(",")[1] ?? "";
  };

  const onPickPhoto = async (file: File | null, useProModel = false) => {
    if (!file) return;
    try {
      setStatus("Compressing photo…");
      const b64 = await fileToBase64(file);
      await handleCapture({ image_b64: b64 }, useProModel ? "pro" : "flash");
    } catch (e) {
      setError(`Photo upload failed: ${(e as Error).message}`);
    }
  };

  const testCapture = async () => {
    const dummy =
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AB//Z";
    await handleCapture({ image_b64: dummy });
  };

  const currentItem = tts.items[tts.currentItemIdx];
  const currentStep = currentItem?.steps?.[tts.stepIdx];
  const online = realtimeOnline || serverReachable;

  // Image transform style for rotation/mirror correction
  const imgStyle: React.CSSProperties = {
    transform: `${imgMirror ? "scaleX(-1) " : ""}rotate(${imgRotation}deg)`,
    transition: "transform 0.3s ease",
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <header className="mx-auto max-w-3xl px-4 pt-8 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Smart Audio Tutor</h1>
            <p className="text-sm text-muted-foreground mt-1">
              ESP32-S3-CAM → AI → your earbuds, step by step.
            </p>
          </div>
          <Badge variant={online ? "default" : "secondary"} className="gap-1">
            {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {realtimeOnline ? "Live" : serverReachable ? "Polling" : "Offline"}
          </Badge>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-32 space-y-4">
        {!audioUnlocked && (
          <Card className="p-4 border-amber-500/30 bg-amber-500/5">
            <div className="flex items-start gap-3">
              <Volume2 className="h-5 w-5 text-amber-600 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-sm">Tap to enable audio on this device</p>
                <p className="text-xs text-muted-foreground mt-1">
                  iPhone and Android block speech until you tap once. Do this every time you open the
                  app, then lock the screen — your Bluetooth earbuds will keep working.
                </p>
              </div>
              <Button size="sm" onClick={unlockAudio}>
                Enable
              </Button>
            </div>
          </Card>
        )}

        <Card className="p-4">
          <div className="flex items-start gap-3">
            {online ? <Wifi className="h-5 w-5 text-primary mt-0.5" /> : <WifiOff className="h-5 w-5 text-destructive mt-0.5" />}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">Bridge status</p>
              <p className="text-xs text-muted-foreground mt-1">{status}</p>
              {nextInCountdown > 0 && (
                <p className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary/10 text-primary px-2 py-1 text-xs font-semibold">
                  ⏱ Next problem starts in {nextInCountdown}s…
                </p>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={checkServer} className="gap-1">
              <RefreshCw className="h-3 w-3" />
              Check
            </Button>
          </div>
        </Card>

        {/* ── Camera ON/OFF card ──────────────────────────────────────────── */}
        <Card className="p-4">
          <div className="flex items-start gap-3 mb-3">
            {cameraOn === false
              ? <PowerOff className="h-5 w-5 text-destructive mt-0.5" />
              : <Power className="h-5 w-5 text-green-500 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-sm flex items-center gap-2">
                🎥 Camera Control
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  cameraOn === null ? "bg-muted text-muted-foreground" :
                  cameraOn ? "bg-green-500/20 text-green-600" : "bg-destructive/20 text-destructive"
                }`}>
                  {cameraOn === null ? "unknown" : cameraOn ? "ON" : "OFF"}
                </span>
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Turn the ESP32 camera off when not in use to prevent overheating.
                The ring middle button (long press &gt;0.8s) also toggles it.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs text-muted-foreground mb-1 block">ESP32 local IP</label>
              <input
                id="esp32-ip-input"
                type="text"
                placeholder="e.g. 192.168.1.45"
                value={esp32Ip}
                onChange={(e) => saveEsp32Ip(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring font-mono"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Shown in Arduino Serial Monitor after boot (e.g. "IP: 192.168.1.45")
              </p>
            </div>
            <Button
              id="camera-toggle-btn"
              variant={cameraOn === false ? "default" : "outline"}
              size="sm"
              disabled={cameraToggling || !esp32Ip}
              onClick={toggleCameraOnEsp32}
              className="gap-2 shrink-0"
            >
              {cameraToggling
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : cameraOn === false
                  ? <Power className="h-4 w-4" />
                  : <PowerOff className="h-4 w-4" />}
              {cameraOn === false ? "Turn Camera ON" : "Turn Camera OFF"}
            </Button>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-start gap-3 mb-3">
            <Camera className="h-5 w-5 text-primary mt-0.5" />
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-sm">📷 Snap or upload a photo (test without ESP32)</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Use your phone camera or pick a photo from the gallery. Same AI pipeline as the ESP32 —
                great for testing voice quality and step-by-step dictation.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="flex items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium cursor-pointer hover:bg-accent">
              <Camera className="h-4 w-4" />
              Take photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  onPickPhoto(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
            </label>
            <label className="flex items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium cursor-pointer hover:bg-accent">
              <Layers className="h-4 w-4" />
              Upload from gallery
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  onPickPhoto(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Auto-resized to ~1600 px JPEG. Gemini vision reads the image first, then gives spoken solution steps.
          </p>
        </Card>

        {/* ── S10 Ring map (v3) ───────────────────────────────────────────── */}
        <Card className="p-4">
          <h2 className="font-semibold text-sm mb-2">🔵 S10 Bluetooth Ring Remote (v3)</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Your S10 ring connects <b>directly to the ESP32</b> over BLE — the phone does NOT need to
            be paired. Unpair it from your phone first, then the ESP32 will connect within ~8 seconds.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2 font-semibold">ESP32 side (via BLE)</p>
              <ul className="text-xs space-y-1.5 font-mono">
                <li><span className="inline-block w-28 font-bold text-primary">▲ Up</span>→ 🔁 Replay step</li>
                <li><span className="inline-block w-28 font-bold text-primary">▼ Down</span>→ ⏹ Stop speech</li>
                <li><span className="inline-block w-28 font-bold text-primary">◀ Left</span>→ ⏮ Previous step</li>
                <li><span className="inline-block w-28 font-bold text-primary">▶ Right</span>→ ⏭ Next step</li>
                <li><span className="inline-block w-28 font-bold text-primary">⏸ Mid (short)</span>→ 📸 Capture photo</li>
                <li><span className="inline-block w-28 font-bold text-amber-600">⏸ Mid (hold &gt;0.8s)</span>→ 🔴/🟢 Camera ON/OFF</li>
              </ul>
            </div>
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2 font-semibold">Phone/laptop side (keyboard mode)</p>
              <ul className="text-xs space-y-1.5 font-mono">
                <li><span className="inline-block w-20 font-bold">Enter / M</span>→ 📸 Tell ESP32 capture</li>
                <li><span className="inline-block w-20 font-bold">▲ / Vol+</span>→ 🔁 Replay step</li>
                <li><span className="inline-block w-20 font-bold">◀ Left</span>→ ⏮ Previous step</li>
                <li><span className="inline-block w-20 font-bold">▶ Right</span>→ ⏭ Next step</li>
                <li><span className="inline-block w-20 font-bold">Space</span>→ ⏹ Stop / resume</li>
              </ul>
            </div>
          </div>

          {/* Calibration guide */}
          <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">🔧 Mapping arrow buttons (your ring sends gyro data — arrows need fresh calibration)</p>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal pl-4">
              <li>Open Serial Monitor in Arduino IDE at <code className="bg-background px-1 rounded">115200</code> baud</li>
              <li>Type <code className="bg-background px-1 rounded">calibrate</code> → buttons become <b>safe</b> (no actions fire)</li>
              <li>Press each ring arrow button once → Serial Monitor shows the raw HID report bytes</li>
              <li>Share those bytes here → I'll add them to the firmware mapping</li>
              <li>Type <code className="bg-background px-1 rounded">calibrate</code> again to go live</li>
            </ol>
          </div>

          <div className="mt-3 rounded-md border bg-muted/20 p-3">
            <p className="text-xs font-semibold mb-1">🔒 Lock-screen audio (iOS &amp; Android)</p>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal pl-4">
              <li>Tap <b>Enable audio</b> at the top of this page once</li>
              <li>Connect your Bluetooth earbuds to your phone</li>
              <li>Lock the phone screen — speech keeps playing through earbuds</li>
              <li>Ring buttons control playback from the lock screen via MediaSession</li>
            </ol>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-start gap-3 mb-3">
            <FileText className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <h2 className="font-semibold text-sm">Class guide / formulas for the next capture</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Paste your textbook method, class notes, or formula sheet here. The AI will follow your
                teacher's exact notation (λ, ℏ, integrals, vectors…).
              </p>
            </div>
          </div>
          <textarea
            value={contextText}
            onChange={(e) => setContextText(e.target.value.slice(0, 12000))}
            placeholder="Example: In class we solve differential equations using separation of variables. Lambda (λ) in heat equations represents thermal diffusivity..."
            className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <input type="file" accept=".txt,.md,.csv,.text,.pdf" onChange={(e) => loadGuideFile(e.target.files?.[0] ?? null)} />
            <span>{contextText.length}/12000 characters loaded</span>
          </div>
        </Card>

        <Card className="p-4">
          {lastImage ? (
            <div className="mb-3">
              {/* Image rotation / mirror controls */}
              <div className="flex items-center gap-1 mb-2 flex-wrap">
                <span className="text-xs text-muted-foreground mr-1">Fix orientation:</span>
                <Button
                  id="rotate-ccw-btn"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 gap-1 text-xs"
                  onClick={() => setImgRotation((r) => (r - 90 + 360) % 360)}
                  title="Rotate 90° counter-clockwise"
                >
                  <RotateCcw className="h-3 w-3" /> –90°
                </Button>
                <Button
                  id="rotate-cw-btn"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 gap-1 text-xs"
                  onClick={() => setImgRotation((r) => (r + 90) % 360)}
                  title="Rotate 90° clockwise"
                >
                  <RotateCw className="h-3 w-3" /> +90°
                </Button>
                <Button
                  id="mirror-btn"
                  size="sm"
                  variant={imgMirror ? "default" : "outline"}
                  className="h-7 px-2 gap-1 text-xs"
                  onClick={() => setImgMirror((m) => !m)}
                  title="Mirror horizontal"
                >
                  <FlipHorizontal className="h-3 w-3" /> Mirror
                </Button>
                {(imgRotation !== 0 || imgMirror) && (
                  <Button
                    id="reset-orient-btn"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => { setImgRotation(0); setImgMirror(false); }}
                  >
                    Reset
                  </Button>
                )}
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {imgRotation !== 0 && `${imgRotation}°`}{imgMirror && " mirrored"}
                </span>
              </div>

              <a
                href={`data:image/jpeg;base64,${lastImage}`}
                target="_blank"
                rel="noreferrer"
                className="block relative rounded-lg overflow-hidden bg-muted border mx-auto"
                style={{ maxWidth: "320px", aspectRatio: "210 / 297" }}
              >
                <img
                  src={`data:image/jpeg;base64,${lastImage}`}
                  alt="What the AI sees"
                  className="w-full h-full object-contain bg-black/5"
                  style={imgStyle}
                />
                {busy && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 text-white animate-spin" />
                  </div>
                )}
              </a>
              <div className="flex flex-wrap items-center justify-between gap-2 mt-2 text-xs text-muted-foreground">
                <span>
                  ~{Math.round((lastImage.length * 3) / 4 / 1024)} KB jpeg • tap image to open full size
                  {usedModel && <span className="ml-1">• {usedModel.replace("google/", "").replace("gemini-", "Gemini ").replace("-preview", "")}</span>}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => handleCapture({ image_b64: lastImage }, "pro")}
                >
                  Re-analyze with Pro (stronger OCR)
                </Button>
              </div>
            </div>
          ) : (
            <div className="mb-3 h-40 rounded-lg bg-muted border flex items-center justify-center text-muted-foreground">
              <Camera className="h-8 w-8 mr-2" /> Waiting for first capture…
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs uppercase text-muted-foreground tracking-wide">
                {busy ? "Analyzing image" : currentItem ? "Now reading" : "Waiting for capture"}
              </p>
              <p className="font-semibold truncate">
                {currentItem?.title ?? "Press the capture button on your ESP32"}
              </p>
              {currentStep && (
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{currentStep}</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 mt-4">
            <Button variant="outline" size="icon" onClick={tts.prev} disabled={!currentItem}>
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={tts.replay} disabled={!currentItem}>
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={tts.stop} disabled={!tts.speaking}>
              <Square className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={tts.next} disabled={!currentItem}>
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <span className="text-xs text-muted-foreground">Speed</span>
            <input
              type="range"
              min={0.5}
              max={1.3}
              step={0.05}
              value={tts.rate}
              onChange={(e) => tts.setRate(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="text-xs tabular-nums w-12 text-right">{tts.rate.toFixed(2)}x</span>
          </div>

          {error && <p className="text-sm text-destructive mt-3">{error}</p>}
        </Card>

        {extracted && (
          <Card className="p-4">
            <h2 className="font-semibold mb-2 text-sm">Text the AI read from the page</h2>
            <pre className="text-xs whitespace-pre-wrap bg-muted/40 rounded p-2 max-h-48 overflow-auto">{extracted}</pre>
            <p className="text-[10px] text-muted-foreground mt-1">
              If this looks wrong or empty, the camera frame is too blurry/dark. Move closer (15–25 cm), add light, retake.
            </p>
          </Card>
        )}

        {currentItem && (
          <Card className="p-4">
            <h2 className="font-semibold mb-3">Steps</h2>
            <ol className="space-y-2">
              {currentItem.steps.map((s, i) => (
                <li
                  key={i}
                  className={`text-sm flex gap-3 p-2 rounded-md ${
                    i === tts.stepIdx ? "bg-primary/10 font-medium" : ""
                  }`}
                >
                  <span className="text-muted-foreground tabular-nums w-6 shrink-0">{i + 1}.</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </Card>
        )}

        <Card className="p-4">
          <h2 className="font-semibold mb-2 text-sm">Event log (live from ESP32)</h2>
          {log.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No ESP32 events yet. Type <code>cap</code> in Serial Monitor. If the bridge works, a row with
              type <code>capture</code> and JPEG size will appear here.
            </p>
          ) : (
            <ul className="text-xs font-mono space-y-1 max-h-48 overflow-auto">
              {log.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className="text-muted-foreground">{e.t}</span>
                  <Badge variant="outline" className="text-[10px] py-0">{e.type}</Badge>
                  <span className="text-muted-foreground">{e.id}</span>
                  <span className="text-muted-foreground">{e.device}</span>
                  <span className="text-muted-foreground">{e.imageChars > 0 ? `${e.imageChars} chars` : "no image"}</span>
                  <span className="text-muted-foreground">{e.source}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {tts.items.length > 1 && (
          <Card className="p-4">
            <h2 className="font-semibold mb-3">History</h2>
            <ul className="space-y-1 text-sm">
              {tts.items.map((it, i) => (
                <li
                  key={it.id}
                  className={`p-2 rounded-md ${i === tts.currentItemIdx ? "bg-muted" : ""}`}
                >
                  <span className="text-muted-foreground tabular-nums mr-2">{i + 1}.</span>
                  {it.title}{" "}
                  <span className="text-xs text-muted-foreground">({it.steps.length} steps)</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card className="p-4 bg-muted/30">
          <h2 className="font-semibold text-sm mb-2">Setup</h2>
          <ol className="text-xs text-muted-foreground space-y-1 list-decimal pl-5">
            <li>
              The app uses Gemini vision from the secure backend key, so manual photo uploads and ESP32 captures can read page images.
            </li>
            <li>
              Point your ESP32 firmware at the published URL +{" "}
              <code className="bg-background px-1 rounded">/api/public/event</code>.
            </li>
            <li>
              After flashing, open the Serial Monitor IP address like{" "}
              <code className="bg-background px-1 rounded">http://192.168.x.x/</code> to preview the camera and press Capture.
            </li>
            <li>
              For Serial Monitor testing, type <code className="bg-background px-1 rounded">cap</code> and wait for{" "}
              <code className="bg-background px-1 rounded ml-1">HTTP 200</code>. Type{" "}
              <code className="bg-background px-1 rounded">cam</code> to toggle camera ON/OFF.
            </li>
            <li>
              Open this page on your phone, tap <b>Enable audio</b>, connect your earbuds, then lock
              the phone. Press the capture button on the ESP32 whenever you want to analyze something.
            </li>
            <li>
              <a className="underline" href="/firmware/esp32_smart_camera.ino" download>
                Download Arduino firmware (v3)
              </a>
            </li>
          </ol>
          <Button variant="ghost" size="sm" className="mt-2" onClick={testCapture}>
            Run test capture (no camera)
          </Button>
        </Card>
      </main>
    </div>
  );
}
