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
  const [nextInCountdown, setNextInCountdown] = useState(0);

  useEffect(() => {
    contextRef.current = contextText;
  }, [contextText]);


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
    // Fresh paper → wipe the old blurry image, extracted text and model badge
    // so the UI only ever shows the CURRENT problem.
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

      // If a previous problem was already on screen, give the listener a 5-second
      // buffer + a spoken heads-up before the next one starts reading.
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
        // device_id "burst:<burst_id>:<device>" → multi-image burst analysis
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
      // 'trigger' events are ring->ESP capture requests; the web UI just logs them.
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

  // (Realtime subscription removed — `events` is no longer in the realtime
  // publication for security. We now rely on the 3s polling below.)

  useEffect(() => {
    checkServer();
    const timer = window.setInterval(checkServer, 3000);
    return () => window.clearInterval(timer);
  }, [checkServer]);

  // ============================================================
  //  RING REMOTE — Bluetooth HID keyboard listener
  // ============================================================
  // The "Douyin / TikTok" BLE 5.4 ring pairs with this phone/laptop as a
  // standard HID keyboard. Depending on its mode (toggled by the M button)
  // the buttons emit different keycodes. We listen for ALL of them so the
  // ring works no matter which mode it is in:
  //
  //   ▶/❚❚  →  " " (Space)            or MediaPlayPause
  //   ▲     →  ArrowUp / PageUp       or AudioVolumeUp
  //   ▼     →  ArrowDown / PageDown   or AudioVolumeDown
  //   ◀     →  ArrowLeft              or MediaTrackPrevious
  //   ▶     →  ArrowRight             or MediaTrackNext
  //   M     →  Enter, or "m" key      (used as a remote "shutter")
  //
  // MediaSession action handlers catch the real media keys (volume / track)
  // that the browser would otherwise swallow on iOS / Android lock screen.
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
      // Don't hijack keys while user is typing in the guide textarea / inputs.
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

  // MediaSession — catches real hardware media keys (volume / play-pause /
  // next / prev) that BLE rings send through the OS media layer. Requires
  // audio to have started at least once (we hand it off after unlockAudio).
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
    } catch {
      /* some browsers reject unknown actions — ignore */
    }
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
    const u = new SpeechSynthesisUtterance("Audio is ready. I will speak when a picture arrives.");
    u.rate = tts.rate;
    window.speechSynthesis.speak(u);
    setAudioUnlocked(true);
    setStatus("Audio is enabled. Now type cap in Serial Monitor or press capture on the ESP32.");
  };

  const loadGuideFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setContextText(text.slice(0, 12000));
    setStatus("Class guide loaded. The next picture will use this material.");
  };

  // Client-side downscale → JPEG base64. Keeps long edge ≤ maxEdge so the
  // payload stays small but text is still sharp enough for the OCR pass.
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
    // fake test pixel so user can try without esp32
    const dummy =
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AB//Z";
    await handleCapture({ image_b64: dummy });
  };


  const currentItem = tts.items[tts.currentItemIdx];
  const currentStep = currentItem?.steps?.[tts.stepIdx];
  const online = realtimeOnline || serverReachable;

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
            Auto-resized to ~1600 px JPEG, sent to Gemini, then cross-checked by Kimi for math accuracy
            and listenable steps.
          </p>
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold text-sm mb-2">🔵 Bluetooth ring remote</h2>
          <p className="text-xs text-muted-foreground mb-2">
            Pair the ring with this phone/laptop as a Bluetooth keyboard (the ring's M button cycles modes — pick the one
            that sends arrow keys). This page listens globally; the controls work even with the screen locked.
          </p>
          <ul className="text-xs space-y-1 font-mono">
            <li><b>▶/❚❚</b> (Space) — Stop / Resume speech</li>
            <li><b>▲</b> (Up / VolumeUp) — Replay last answer</li>
            <li><b>▼</b> (Down / VolumeDown) — Re-analyze last image with Pro</li>
            <li><b>◀</b> (Left) — Previous step / capture</li>
            <li><b>▶</b> (Right) — Next step / capture</li>
            <li><b>M</b> (Enter) — Tell ESP32 to take a NEW capture</li>
          </ul>
          <p className="text-[10px] text-muted-foreground mt-2">
            To confirm pairing: open phone Bluetooth settings → the ring should show as <b>Connected</b> (name usually
            "AB Shutter", "BR100" or similar). Press any ring button while focused on this page — if you see "Ring …"
            text in the bridge status above, the pairing is live. If nothing happens, re-pair the ring and toggle its
            M-mode until the page reacts.
          </p>
        </Card>




        <Card className="p-4">
          <div className="flex items-start gap-3 mb-3">
            <FileText className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <h2 className="font-semibold text-sm">Class guide for the next capture</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Paste your textbook method, teacher steps, or solution guide here before taking the picture.
              </p>
            </div>
          </div>
          <textarea
            value={contextText}
            onChange={(e) => setContextText(e.target.value.slice(0, 12000))}
            placeholder="Example: In class we solve quadratic equations by factoring first, then checking both roots..."
            className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <input type="file" accept=".txt,.md,.csv,.text" onChange={(e) => loadGuideFile(e.target.files?.[0] ?? null)} />
            <span>{contextText.length}/12000 characters loaded</span>
          </div>
        </Card>

        <Card className="p-4">
          {lastImage ? (
            <div className="mb-3">
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
                  {usedModel && <span className="ml-1">• {usedModel.replace("google/", "")}</span>}
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
              min={0.6}
              max={1.6}
              step={0.1}
              value={tts.rate}
              onChange={(e) => tts.setRate(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="text-xs tabular-nums w-8 text-right">{tts.rate.toFixed(1)}x</span>
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
              The backend is confirmed working: it accepted a JPEG test upload. Your current failure is the ESP32 HTTPS send step.
            </li>
            <li>
              Point your ESP32 firmware at the published URL +{" "}
              <code className="bg-background px-1 rounded">/api/public/event</code>.
            </li>
            <li>
              After flashing, open the Serial Monitor IP address like <code className="bg-background px-1 rounded">http://192.168.x.x/</code> to preview the camera and press Capture from the board dashboard.
            </li>
            <li>
              For Serial Monitor testing, type <code className="bg-background px-1 rounded">cap</code> and wait for
              <code className="bg-background px-1 rounded ml-1">HTTP 200</code>. If it says HTTP -3, the board camera worked but the upload failed before reaching the app.
            </li>
            <li>
              Open this page on your phone, tap <b>Enable audio</b>, connect your earbuds, then lock
              the phone. Press the capture button on the ESP32 whenever you want to analyze something.
            </li>
            <li>
              <a className="underline" href="/firmware/esp32_smart_camera.ino" download>
                Download Arduino firmware
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
