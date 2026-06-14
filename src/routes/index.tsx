import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
  type: "capture" | "next" | "prev" | "replay" | "stop";
  image_b64: string | null;
  created_at: string;
};

function Index() {
  const tts = useTtsQueue();
  const analyze = useServerFn(analyzeImage);
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastImage, setLastImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [log, setLog] = useState<{ t: string; type: string; id: string }[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  const handleCapture = async (image_b64: string) => {
    setBusy(true);
    setError(null);
    setLastImage(image_b64);
    try {
      const out = await analyze({ data: { image_b64 } });
      tts.addItem({ id: crypto.randomUUID(), title: out.title, steps: out.steps }, true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const channel = supabase
      .channel("events-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "events" },
        (payload) => {
          const row = payload.new as EventRow;
          if (seenRef.current.has(row.id)) return;
          seenRef.current.add(row.id);
          setLog((l) => [{ t: new Date().toLocaleTimeString(), type: row.type, id: row.id.slice(0, 8) }, ...l].slice(0, 20));
          switch (row.type) {
            case "capture":
              if (row.image_b64) handleCapture(row.image_b64);
              break;
            case "next":
              tts.next();
              break;
            case "prev":
              tts.prev();
              break;
            case "replay":
              tts.replay();
              break;
            case "stop":
              tts.stop();
              break;
          }
        },
      )
      .subscribe((status) => setOnline(status === "SUBSCRIBED"));
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unlockAudio = () => {
    if (typeof window === "undefined") return;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
    setAudioUnlocked(true);
  };

  const testCapture = async () => {
    // fake test pixel so user can try without esp32
    const dummy =
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AB//Z";
    await handleCapture(dummy);
  };

  const currentItem = tts.items[tts.currentItemIdx];
  const currentStep = currentItem?.steps?.[tts.stepIdx];

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
            {online ? "Listening" : "Offline"}
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
          <div className="flex items-center gap-3">
            <div className="relative w-24 h-24 rounded-lg overflow-hidden bg-muted flex items-center justify-center shrink-0">
              {lastImage ? (
                <img
                  src={`data:image/jpeg;base64,${lastImage}`}
                  alt="Last capture"
                  className="w-full h-full object-cover"
                />
              ) : (
                <Camera className="h-8 w-8 text-muted-foreground" />
              )}
              {busy && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 text-white animate-spin" />
                </div>
              )}
            </div>
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
              No events yet. Press CAPTURE on the ESP32 (or type <code>cap</code> in Serial Monitor).
              Every hit will appear here within ~1 second.
            </p>
          ) : (
            <ul className="text-xs font-mono space-y-1 max-h-48 overflow-auto">
              {log.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className="text-muted-foreground">{e.t}</span>
                  <Badge variant="outline" className="text-[10px] py-0">{e.type}</Badge>
                  <span className="text-muted-foreground">{e.id}</span>
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
              Publish this app, then point your ESP32 firmware at the published URL +{" "}
              <code className="bg-background px-1 rounded">/api/public/event</code>.
            </li>
            <li>
              Set <code className="bg-background px-1 rounded">DEVICE_SECRET</code> in backend secrets
              and the same value in <code>esp32_smart_camera.ino</code>.
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
