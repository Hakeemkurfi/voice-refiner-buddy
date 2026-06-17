import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
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

  const handleCapture = useCallback(async (image_b64: string, model: "flash" | "pro" = "flash") => {
    setBusy(true);
    setError(null);
    setLastImage(image_b64);
    setExtracted("");
    sayStatus(model === "pro" ? "Re-analyzing with the stronger model." : "Picture received. I am analyzing it now.");
    try {
      const out = await analyze({ data: { image_b64, contextText: contextRef.current, model } });
      addItem({ id: crypto.randomUUID(), title: out.title, steps: out.steps }, true);
      setExtracted(out.extractedText ?? "");
      setUsedModel(out.modelUsed ?? "");
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
  }, [addItem, analyze, sayStatus]);

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
        if (row.image_b64) handleCapture(row.image_b64);
        else sayStatus("Capture message received, but there was no JPEG image attached.");
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

  useEffect(() => {
    const channel = supabase
      .channel("events-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "events" },
        (payload) => {
          const row = payload.new as EventRow;
          processEvent(row, "live");
        },
      )
      .subscribe((status) => setRealtimeOnline(status === "SUBSCRIBED"));
    return () => {
      supabase.removeChannel(channel);
    };
  }, [processEvent]);

  useEffect(() => {
    checkServer();
    const timer = window.setInterval(checkServer, 3000);
    return () => window.clearInterval(timer);
  }, [checkServer]);

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

  const testCapture = async () => {
    // fake test pixel so user can try without esp32
    const dummy =
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AB//Z";
    await handleCapture(dummy);
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
            </div>
            <Button size="sm" variant="outline" onClick={checkServer} className="gap-1">
              <RefreshCw className="h-3 w-3" />
              Check
            </Button>
          </div>
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
                className="block relative rounded-lg overflow-hidden bg-muted border"
              >
                <img
                  src={`data:image/jpeg;base64,${lastImage}`}
                  alt="What the AI sees"
                  className="w-full max-h-96 object-contain bg-black/5"
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
                  onClick={() => handleCapture(lastImage, "pro")}
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
