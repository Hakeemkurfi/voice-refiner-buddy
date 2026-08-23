import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const Route = createFileRoute("/hakeemneurotech")({
  head: () => ({
    meta: [
      { title: "Axon Dynamics NeuroSync — Real-Time Brain Emotion & Bulb Control" },
      {
        name: "description",
        content:
          "EEG-driven neuro console by Axon Dynamics: live brainwave graphs, real-time emotion detection and thought-controlled ESP32 relay bulb switching.",
      },
      { property: "og:title", content: "Axon Dynamics NeuroSync — Brain-Controlled Interface" },
      {
        property: "og:description",
        content:
          "Live neuron activity, EEG waveforms, emotion state and ESP32 relay bulb control from a single brain-computer interface console.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Axon Dynamics NeuroSync" },
      {
        name: "twitter:description",
        content: "Real-time EEG emotion detection and thought-controlled bulb switching on ESP32.",
      },
    ],
  }),
  component: NeuroConsole,
});

/* ------------------------------------------------------------------ */
/* Emotion model                                                       */
/* ------------------------------------------------------------------ */

type EmotionId = "rest" | "happy" | "laugh" | "excitement" | "stressed" | "anger";

type Emotion = {
  id: EmotionId;
  label: string;
  glyph: string;
  narrative: string;
  /** dominant EEG band signature used to shape the synthesised wave */
  band: string;
  freq: number;
  amp: number;
  noise: number;
  /** default arousal applied when this channel fires */
  arousal: number;
  /** keyboard / HID ring keys that fire this channel directly */
  keys: string[];
  ringLabel: string;
  bands: { delta: number; theta: number; alpha: number; beta: number; gamma: number };
};

const EMOTIONS: Emotion[] = [
  {
    id: "rest",
    label: "Rest",
    glyph: "◍",
    narrative: "Cortex idling. Alpha rhythm dominant over the occipital lobes.",
    band: "Alpha 8–12 Hz",
    freq: 1.0,
    amp: 0.42,
    noise: 0.05,
    arousal: 0.25,
    keys: ["r", "R", "0", "6"],
    ringLabel: "R key",
    bands: { delta: 0.22, theta: 0.3, alpha: 0.82, beta: 0.25, gamma: 0.12 },
  },
  {
    id: "happy",
    label: "Happy",
    glyph: "◕",
    narrative: "Left-frontal activation rising. Positive valence detected.",
    band: "Alpha–Beta blend",
    freq: 1.5,
    amp: 0.55,
    noise: 0.08,
    arousal: 0.5,
    keys: ["ArrowLeft", "1"],
    ringLabel: "Swipe left",
    bands: { delta: 0.18, theta: 0.34, alpha: 0.62, beta: 0.58, gamma: 0.28 },
  },
  {
    id: "laugh",
    label: "Laugh",
    glyph: "◉",
    narrative: "Rapid burst pattern across motor and limbic channels.",
    band: "Beta burst 16–24 Hz",
    freq: 2.6,
    amp: 0.72,
    noise: 0.16,
    arousal: 0.68,
    keys: ["ArrowRight", "2"],
    ringLabel: "Swipe right",
    bands: { delta: 0.14, theta: 0.28, alpha: 0.4, beta: 0.86, gamma: 0.52 },
  },
  {
    id: "excitement",
    label: "Excitement",
    glyph: "✦",
    narrative: "High arousal. Gamma coupling across fronto-parietal network.",
    band: "Gamma 30–45 Hz",
    freq: 3.4,
    amp: 0.8,
    noise: 0.2,
    arousal: 0.82,
    keys: ["ArrowUp", "3"],
    ringLabel: "Swipe up",
    bands: { delta: 0.12, theta: 0.24, alpha: 0.32, beta: 0.78, gamma: 0.92 },
  },
  {
    id: "stressed",
    label: "Stressed",
    glyph: "⧗",
    narrative: "Suppressed alpha, elevated beta. Cognitive load is high.",
    band: "Beta 20–30 Hz",
    freq: 3.0,
    amp: 0.6,
    noise: 0.3,
    arousal: 0.74,
    keys: ["s", "S", "5"],
    ringLabel: "S key",
    bands: { delta: 0.2, theta: 0.44, alpha: 0.2, beta: 0.9, gamma: 0.46 },
  },
  {
    id: "anger",
    label: "Anger",
    glyph: "▲",
    narrative: "Right-frontal asymmetry with sharp amygdala-driven spikes.",
    band: "High-Beta 25–35 Hz",
    freq: 4.0,
    amp: 0.95,
    noise: 0.4,
    arousal: 0.92,
    keys: ["ArrowDown", "4"],
    ringLabel: "Swipe down",
    bands: { delta: 0.26, theta: 0.5, alpha: 0.14, beta: 0.96, gamma: 0.66 },
  },
];


const byId = (id: string): Emotion => EMOTIONS.find((e) => e.id === id) ?? EMOTIONS[0];

/* ------------------------------------------------------------------ */
/* Console                                                             */
/* ------------------------------------------------------------------ */

function NeuroConsole() {
  const [emotionId, setEmotionId] = useState<EmotionId>("rest");
  const [bulb, setBulb] = useState(false);
  const [intensity, setIntensity] = useState(0.45);
  const [linked, setLinked] = useState<"offline" | "live">("offline");
  const [lastEvent, setLastEvent] = useState<string>("awaiting neural input");
  const [log, setLog] = useState<string[]>([]);
  const [remoteEeg, setRemoteEeg] = useState<number[] | null>(null);

  const emotion = byId(emotionId);
  const pushLog = useCallback((line: string) => {
    const t = new Date().toLocaleTimeString([], { hour12: false });
    setLog((prev) => [`${t}  ${line}`, ...prev].slice(0, 8));
  }, []);

  /* ---- backend sync ------------------------------------------------ */

  const post = useCallback(
    async (payload: Record<string, unknown>) => {
      try {
        const res = await fetch("/api/public/neuro", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = (await res.json()) as { ok?: boolean; state?: Record<string, unknown> };
        if (json.ok && json.state) setLinked("live");
        return json;
      } catch {
        setLinked("offline");
        return null;
      }
    },
    [],
  );

  const bulbRef = useRef(false);
  const localEditAt = useRef(0);
  const applyState = useCallback(
    (s: { emotion?: string; bulb?: boolean; intensity?: number; eeg?: number[] } | null) => {
      if (!s) return;
      // Don't let a stale poll response undo an action the user just made.
      if (Date.now() - localEditAt.current < 2500) return;
      if (s.emotion) setEmotionId(s.emotion as EmotionId);
      if (typeof s.bulb === "boolean") { bulbRef.current = s.bulb; setBulb(s.bulb); }
      if (typeof s.intensity === "number") setIntensity(s.intensity);
      if (Array.isArray(s.eeg) && s.eeg.length > 8) setRemoteEeg(s.eeg);
    },
    [],
  );

  // Poll the device bridge so an ESP32 press is mirrored on screen.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/public/neuro", { cache: "no-store" });
        const json = (await res.json()) as { ok?: boolean; state?: Record<string, unknown> };
        if (!alive) return;
        if (json.ok) {
          setLinked("live");
          applyState(json.state as never);
        } else setLinked("offline");
      } catch {
        if (alive) setLinked("offline");
      }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [applyState]);

  /* ---- actions ------------------------------------------------------ */

  const [decoding, setDecoding] = useState(true);
  const [pulseKey, setPulseKey] = useState(0);

  const setEmotion = useCallback(
    (id: EmotionId, src: string) => {
      localEditAt.current = Date.now();
      setEmotionId(id);
      setPulseKey((k) => k + 1);
      setIntensity(byId(id).arousal);
      setLastEvent(`${byId(id).label.toLowerCase()} detected`);
      pushLog(`EEG classifier → ${byId(id).label.toUpperCase()}  [${src}]`);
      void post({ emotion: id, intensity: byId(id).arousal });
    },
    [post, pushLog],
  );

  const toggleBulb = useCallback(
    (src: string) => {
      localEditAt.current = Date.now();
      const nb = !bulbRef.current;
      bulbRef.current = nb;
      setBulb(nb);
      pushLog(`Motor-imagery intent → RELAY GPIO26 ${nb ? "HIGH (bulb ON)" : "LOW (bulb OFF)"}  [${src}]`);
      setLastEvent(nb ? "thought command: light on" : "thought command: light off");
      void post({ toggle_bulb: true });
    },
    [post, pushLog],
  );

  const toggleDecoding = useCallback(() => {
    setDecoding((d) => {
      pushLog(d ? "Decoder halted — cortical stream paused" : "Decoder armed — acquiring cortical stream");
      setLastEvent(d ? "decoder stopped" : "decoding brain activity…");
      return !d;
    });
  }, [pushLog]);

  /* ---- HID ring / keyboard input ------------------------------------ */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === " " || k === "Enter") {
        e.preventDefault();
        toggleBulb("ring · middle");
        return;
      }
      if (k.toLowerCase() === "d") {
        e.preventDefault();
        toggleDecoding();
        return;
      }
      const byKey = EMOTIONS.find((em) => em.keys.includes(k));
      if (byKey) {
        e.preventDefault();
        setEmotion(byKey.id, `ring · ${byKey.ringLabel.toLowerCase()}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleBulb, toggleDecoding, setEmotion]);

  const themeClass = `neuro neuro-emo-${emotionId}`;

  return (
    <main className={`${themeClass} min-h-screen w-full transition-colors duration-700`}>
      <div className="mx-auto w-full max-w-7xl px-5 py-8 md:px-8 md:py-12">
        <Header linked={linked} />

        <section className="mt-8 grid gap-5 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-7">
            <CorticalMap emotion={emotion} intensity={decoding ? intensity : 0.08} bulb={bulb} />
          </div>
          <div className="min-w-0 lg:col-span-5">
            <BulbPanel bulb={bulb} onToggle={() => toggleBulb("console")} />
          </div>
        </section>

        <section className="mt-5">
          <DecoderPole
            emotion={emotion}
            intensity={intensity}
            lastEvent={lastEvent}
            decoding={decoding}
            pulseKey={pulseKey}
            onSelect={(id) => setEmotion(id, "console")}
            onToggleDecoding={toggleDecoding}
          />
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-8">
            <EegPanel
              emotion={emotion}
              intensity={intensity}
              remote={remoteEeg}
              decoding={decoding}
            />
          </div>
          <div className="grid min-w-0 gap-5 lg:col-span-4">
            <BandPanel emotion={emotion} intensity={intensity} />
            <LogPanel log={log} />
          </div>
        </section>

        <Footer />
      </div>
    </main>
  );
}


/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function Panel({
  title,
  hint,
  children,
  className = "",
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`neuro-panel rounded-2xl p-5 ${className}`}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] opacity-70">{title}</h2>
        {hint ? <span className="text-[0.68rem] opacity-45">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Header({ linked }: { linked: "offline" | "live" }) {
  return (
    <header className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
      <div className="flex items-start gap-4">
        <svg viewBox="0 0 48 48" className="mt-1 h-11 w-11 shrink-0" aria-hidden="true">
          <circle cx="24" cy="24" r="21" fill="none" stroke="var(--emo)" strokeWidth="1.2" opacity="0.5" />
          <path
            d="M24 6 L38 15 L38 33 L24 42 L10 33 L10 15 Z"
            fill="none"
            stroke="var(--emo)"
            strokeWidth="1.6"
          />
          <circle cx="24" cy="24" r="5" fill="var(--emo)" className="neuro-pulse" />
        </svg>
        <div>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.34em]" style={{ color: "var(--emo)" }}>
            Axon Dynamics
          </p>
          <h1 className="mt-1 text-3xl font-semibold leading-tight md:text-4xl">
            NeuroSync Cortical Console
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed opacity-70">
            Real-time emotion decoding from EEG headset streams, with thought-driven actuation of a
            physical relay bulb through an ESP32 edge node.
          </p>
        </div>
      </div>

      <div className="neuro-panel rounded-2xl px-5 py-4 text-sm md:min-w-[19rem]">
        <p className="text-[0.68rem] uppercase tracking-[0.22em] opacity-55">Research Affiliation</p>
        <p className="mt-2 font-medium leading-snug">Harbin Engineering University</p>
        <p className="text-sm opacity-70">Department of Science and Intelligent Systems</p>
        <p className="text-sm opacity-70">Class of Artificial Intelligence</p>
        <p className="text-sm opacity-70">Research area: Neuroscience</p>
        <div className="mt-3 flex items-center gap-2 border-t pt-3" style={{ borderColor: "var(--neuro-line)" }}>
          <span
            className="h-2 w-2 rounded-full neuro-pulse"
            style={{ background: linked === "live" ? "var(--emo)" : "var(--neuro-muted)" }}
          />
          <span className="text-xs uppercase tracking-[0.18em] opacity-75">
            {linked === "live" ? "Neural bridge online" : "Bridge reconnecting"}
          </span>
        </div>
      </div>
    </header>
  );
}

/** Animated neuron field: thoughts firing across a cortical network. */
function CorticalMap({
  emotion,
  intensity,
  bulb,
}: {
  emotion: Emotion;
  intensity: number;
  bulb: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({ emotion, intensity });
  stateRef.current = { emotion, intensity };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const nodes = Array.from({ length: 46 }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.0006,
      vy: (Math.random() - 0.5) * 0.0006,
      phase: Math.random() * Math.PI * 2,
    }));

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const accent = () =>
      getComputedStyle(canvas).getPropertyValue("--emo").trim() || "oklch(0.8 0.12 200)";

    const draw = (t: number) => {
      const { emotion: em, intensity: inten } = stateRef.current;
      const speed = 0.4 + em.freq * 0.28 + inten * 0.5;
      const col = accent();
      ctx.clearRect(0, 0, w, h);

      for (const n of nodes) {
        n.x += n.vx * speed * 16;
        n.y += n.vy * speed * 16;
        if (n.x < 0 || n.x > 1) n.vx *= -1;
        if (n.y < 0 || n.y > 1) n.vy *= -1;
      }

      // synapses
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = (a.x - b.x) * w;
          const dy = (a.y - b.y) * h;
          const d = Math.hypot(dx, dy);
          if (d > 132) continue;
          const pulse = 0.5 + 0.5 * Math.sin(t * 0.001 * speed + (a.phase + b.phase));
          ctx.strokeStyle = col;
          ctx.globalAlpha = (1 - d / 132) * 0.22 * (0.45 + pulse * 0.8);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x * w, a.y * h);
          ctx.lineTo(b.x * w, b.y * h);
          ctx.stroke();
        }
      }

      // somas
      for (const n of nodes) {
        const fire = 0.5 + 0.5 * Math.sin(t * 0.0016 * speed + n.phase * 3);
        const r = 1.6 + fire * (1.6 + inten * 2.4);
        ctx.globalAlpha = 0.35 + fire * 0.6;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(n.x * w, n.y * h, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <Panel title="Cortical activity map" hint="live ·-channel montage" className="h-full">
      <div className="relative overflow-hidden rounded-xl" style={{ background: "oklch(0 0 0 / 22%)" }}>
        <canvas ref={ref} className="block h-[19rem] w-full md:h-[24rem]" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className="rounded-full neuro-pulse"
            style={{
              width: `${9 + intensity * 6}rem`,
              height: `${9 + intensity * 6}rem`,
              background: "radial-gradient(circle, var(--emo-soft), transparent 70%)",
            }}
          />
        </div>
        <div className="pointer-events-none absolute bottom-3 left-4 text-[0.68rem] uppercase tracking-[0.2em] opacity-70">
          Thought stream · {emotion.band}
        </div>
        <div className="pointer-events-none absolute bottom-3 right-4 text-[0.68rem] uppercase tracking-[0.2em] opacity-70">
          Actuator {bulb ? "engaged" : "idle"}
        </div>
      </div>
      <p className="mt-4 text-sm leading-relaxed opacity-70">{emotion.narrative}</p>
    </Panel>
  );
}

/** One consolidated pole: live decoded state + the emotion channel bank. */
function DecoderPole({
  emotion,
  intensity,
  lastEvent,
  decoding,
  pulseKey,
  onSelect,
  onToggleDecoding,
}: {
  emotion: Emotion;
  intensity: number;
  lastEvent: string;
  decoding: boolean;
  pulseKey: number;
  onSelect: (id: EmotionId) => void;
  onToggleDecoding: () => void;
}) {
  const pct = Math.round(intensity * 100);
  const circ = 2 * Math.PI * 44;

  return (
    <Panel
      title="Emotion decoding"
      hint={decoding ? "classifier running" : "classifier halted"}
      className="overflow-hidden"
    >
      <div className="grid gap-6 lg:grid-cols-12">
        {/* live readout */}
        <div className="min-w-0 lg:col-span-5">
          <div className="flex items-center gap-5">
            <div className="relative h-32 w-32 shrink-0">
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="44" fill="none" stroke="var(--neuro-line)" strokeWidth="7" />
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  fill="none"
                  stroke="var(--emo)"
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray={circ}
                  strokeDashoffset={circ * (1 - Math.max(0.08, intensity))}
                  style={{ transition: "stroke-dashoffset 600ms ease" }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span
                  key={pulseKey}
                  className="neuro-pop text-4xl"
                  style={{ color: "var(--emo)" }}
                >
                  {emotion.glyph}
                </span>
              </div>
              {decoding ? (
                <span
                  className="neuro-ripple pointer-events-none absolute inset-0 rounded-full"
                  style={{ border: "1px solid var(--emo)" }}
                />
              ) : null}
            </div>
            <div className="min-w-0">
              <p key={`${pulseKey}-l`} className="neuro-pop text-4xl font-semibold tracking-tight" style={{ color: "var(--emo)" }}>
                {emotion.label}
              </p>
              <p className="mt-1 text-sm opacity-70">
                Arousal {pct}% · {emotion.band}
              </p>
              <p className="mt-2 truncate text-xs uppercase tracking-[0.16em] opacity-50">
                {decoding ? lastEvent : "decoder stopped"}
              </p>
            </div>
          </div>

          <p className="mt-4 text-sm leading-relaxed opacity-70">{emotion.narrative}</p>

          <button
            type="button"
            onClick={onToggleDecoding}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold uppercase tracking-[0.16em] transition-transform active:scale-[0.98]"
            style={{
              background: decoding ? "var(--emo)" : "var(--emo-soft)",
              color: decoding ? "var(--neuro-bg-deep)" : "var(--neuro-fg)",
              border: "1px solid var(--emo)",
            }}
          >
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${decoding ? "neuro-pulse" : ""}`}
              style={{ background: decoding ? "var(--neuro-bg-deep)" : "var(--emo)" }}
            />
            {decoding ? "Stop decoding" : "Start decoding"}
          </button>
        </div>

        {/* channel bank */}
        <div className="min-w-0 lg:col-span-7">
          <p className="mb-3 text-[0.68rem] uppercase tracking-[0.22em] opacity-55">
            Detected channels — fires on ring input
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {EMOTIONS.map((e) => {
              const on = e.id === emotion.id;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onSelect(e.id)}
                  className={`neuro-emo-${e.id} neuro-chip relative overflow-hidden rounded-2xl px-3 py-4 text-left transition-all duration-300 ${
                    on ? "neuro-pop scale-[1.03]" : "opacity-70 hover:opacity-100"
                  }`}
                  style={
                    on
                      ? {
                          borderColor: "var(--emo)",
                          background: "var(--emo-soft)",
                          boxShadow: "0 0 0 1px var(--emo), 0 12px 34px -12px var(--emo)",
                        }
                      : undefined
                  }
                >
                  <span
                    className={`text-2xl ${on ? "neuro-pulse" : ""}`}
                    style={{ color: "var(--emo)" }}
                  >
                    {e.glyph}
                  </span>
                  <span className="mt-1 block text-sm font-semibold">{e.label}</span>
                  <span className="block text-[0.64rem] uppercase tracking-[0.14em] opacity-55">
                    {e.band}
                  </span>
                  <span
                    className="mt-2 block text-[0.62rem] uppercase tracking-[0.16em]"
                    style={{ color: on ? "var(--emo)" : undefined, opacity: on ? 0.9 : 0.4 }}
                  >
                    {e.ringLabel}
                  </span>
                  {on ? (
                    <span
                      className="neuro-ripple pointer-events-none absolute inset-0 rounded-2xl"
                      style={{ border: "1px solid var(--emo)" }}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Panel>
  );
}


function BulbPanel({ bulb, onToggle }: { bulb: boolean; onToggle: () => void }) {
  return (
    <Panel title="Thought-actuated lamp" hint="ESP32 · relay GPIO 26">
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
        <svg
          viewBox="0 0 64 96"
          className={`h-44 w-32 shrink-0 sm:h-48 sm:w-36 ${bulb ? "neuro-lit" : ""}`}
          aria-hidden="true"
        >
          <defs>
            <radialGradient id="bulbGlow" cx="50%" cy="38%" r="55%">
              <stop offset="0%" stopColor="var(--emo)" stopOpacity={bulb ? 0.95 : 0.06} />
              <stop offset="100%" stopColor="var(--emo)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="32" cy="34" r="30" fill="url(#bulbGlow)" />
          <path
            d="M32 8c-11 0-19 8.4-19 19 0 7.6 4.3 11.6 6.8 15.3 1.9 2.8 2.7 4.6 2.9 7.7h18.6c.2-3.1 1-4.9 2.9-7.7C46.7 38.6 51 34.6 51 27 51 16.4 43 8 32 8Z"
            fill="none"
            stroke="var(--emo)"
            strokeWidth="2"
            opacity={bulb ? 1 : 0.45}
          />
          <path
            d="M24 42c3-5 5-8 8-8s5 3 8 8"
            fill="none"
            stroke="var(--emo)"
            strokeWidth="2"
            opacity={bulb ? 1 : 0.28}
          />
          <rect x="22" y="55" width="20" height="5" rx="2" fill="var(--emo)" opacity="0.6" />
          <rect x="22" y="63" width="20" height="5" rx="2" fill="var(--emo)" opacity="0.6" />
          <rect x="24" y="71" width="16" height="9" rx="3" fill="var(--emo)" opacity="0.35" />
        </svg>

        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="text-3xl font-semibold" style={{ color: bulb ? "var(--emo)" : undefined }}>
            {bulb ? "Lamp ON" : "Lamp OFF"}
          </p>
          <p className="mt-1 text-sm opacity-65">
            Relay pin driven {bulb ? "HIGH" : "LOW"} by the decoded motor-imagery intent.
          </p>
          <button
            type="button"
            onClick={onToggle}
            className="mt-4 w-full rounded-xl px-4 py-3 text-sm font-medium transition-transform active:scale-[0.98]"
            style={{
              background: bulb ? "var(--emo)" : "var(--emo-soft)",
              color: bulb ? "var(--neuro-bg-deep)" : "var(--neuro-fg)",
              border: "1px solid var(--emo)",
            }}
          >
            Toggle by thought
          </button>
        </div>
      </div>
    </Panel>
  );
}


function EegPanel({
  emotion,
  intensity,
  remote,
  decoding,
}: {
  emotion: Emotion;
  intensity: number;
  remote: number[] | null;
  decoding: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({ emotion, intensity, remote, decoding });
  stateRef.current = { emotion, intensity, remote, decoding };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const CH = 4;
    const N = 240;
    const buffers: number[][] = Array.from({ length: CH }, () => new Array(N).fill(0));
    // Per-channel slow-drifting oscillator parameters → the trace never repeats.
    const drift = Array.from({ length: CH }, (_, c) => ({
      f1: 0.8 + c * 0.31,
      f2: 1.9 + c * 0.47,
      f3: 3.3 + c * 0.19,
      p1: Math.random() * 6.28,
      p2: Math.random() * 6.28,
      p3: Math.random() * 6.28,
      burst: 0,
      nextBurst: 40 + Math.random() * 200,
    }));
    let raf = 0;
    let w = 0;
    let h = 0;
    let t = 0;
    let frame = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const accent = () => getComputedStyle(canvas).getPropertyValue("--emo").trim() || "#7dd";
    const grid = () => getComputedStyle(canvas).getPropertyValue("--neuro-grid").trim() || "#2226";

    const draw = () => {
      const { emotion: em, intensity: inten, remote: rem, decoding: on } = stateRef.current;
      frame++;
      const gain = on ? 1 : 0.12;
      t += 0.05 + em.freq * 0.03 * gain;

      for (let c = 0; c < CH; c++) {
        const d = drift[c];
        // Slowly wander the oscillator frequencies and phases (non-stationary EEG).
        d.f1 += (Math.random() - 0.5) * 0.006;
        d.f2 += (Math.random() - 0.5) * 0.01;
        d.f3 += (Math.random() - 0.5) * 0.014;
        d.f1 = Math.min(1.6, Math.max(0.5, d.f1));
        d.f2 = Math.min(3.2, Math.max(1.1, d.f2));
        d.f3 = Math.min(5.5, Math.max(2.0, d.f3));
        d.p1 += 0.004;
        d.p2 -= 0.007;
        d.p3 += 0.011;

        // Occasional spindles / spikes, more frequent at high arousal.
        if (on && --d.nextBurst <= 0) {
          d.burst = 12 + Math.random() * 26;
          d.nextBurst = 60 + Math.random() * (320 - inten * 220);
        }
        let burstAmp = 0;
        if (d.burst > 0) {
          d.burst--;
          burstAmp = Math.sin(d.burst * 0.7) * (0.35 + inten * 0.7) * em.amp;
        }

        const envelope = 0.65 + 0.35 * Math.sin(t * 0.19 + c * 1.7);
        const devSample =
          rem && rem.length ? rem[(Math.floor(t * 6) + c * 13) % rem.length] * 0.6 : 0;
        const v =
          (devSample +
            Math.sin(t * em.freq * d.f1 + d.p1) * em.amp * (0.45 + inten) * envelope +
            Math.sin(t * em.freq * d.f2 + d.p2) * em.amp * 0.34 +
            Math.sin(t * em.freq * d.f3 + d.p3) * em.amp * 0.18 * (0.4 + inten) +
            burstAmp +
            (Math.random() - 0.5) * em.noise * 2) *
          gain;
        buffers[c].push(v);
        buffers[c].shift();
      }

      ctx.clearRect(0, 0, w, h);
      const rowH = h / CH;

      ctx.strokeStyle = grid();
      ctx.lineWidth = 1;
      const off = (frame * 0.6) % 48;
      for (let x = -off; x <= w; x += 48) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y <= h; y += rowH / 2) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      const col = accent();
      ctx.shadowColor = col;
      for (let c = 0; c < CH; c++) {
        const mid = rowH * c + rowH / 2;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const x = (i / (N - 1)) * w;
          const y = mid - buffers[c][i] * (rowH * 0.34);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = col;
        ctx.shadowBlur = 8;
        ctx.globalAlpha = 0.95 - c * 0.16;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <Panel
      title="EEG waveform stream"
      hint={
        !decoding
          ? "decoder paused"
          : remote
            ? "ESP32 telemetry · 256 Hz"
            : "synthesised montage · 256 Hz"
      }
    >
      <div className="rounded-xl p-2" style={{ background: "oklch(0 0 0 / 22%)" }}>
        <canvas ref={ref} className="block h-56 w-full" />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[0.7rem] uppercase tracking-[0.18em] opacity-60">
        <span>Ch1 AF3</span>
        <span>Ch2 F4</span>
        <span>Ch3 T7</span>
        <span>Ch4 O1</span>
      </div>
    </Panel>
  );
}


function BandPanel({ emotion, intensity }: { emotion: Emotion; intensity: number }) {
  const rows = useMemo(
    () =>
      (Object.entries(emotion.bands) as [string, number][]).map(([k, v]) => ({
        name: k,
        value: Math.min(1, v * (0.7 + intensity * 0.6)),
      })),
    [emotion, intensity],
  );
  return (
    <Panel title="Spectral power bands" hint="µV² normalised">
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.name}>
            <div className="mb-1 flex justify-between text-xs uppercase tracking-[0.16em] opacity-65">
              <span>{r.name}</span>
              <span>{Math.round(r.value * 100)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "oklch(1 0 0 / 8%)" }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${r.value * 100}%`, background: "var(--emo)" }}
              />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function LogPanel({ log }: { log: string[] }) {
  return (
    <Panel title="Neural event log" hint="last 8">
      <ul className="space-y-1.5 font-mono text-[0.72rem] leading-relaxed opacity-75">
        {log.length === 0 ? <li className="opacity-50">standing by for cortical events…</li> : null}
        {log.map((l, i) => (
          <li key={`${l}-${i}`} className="truncate">
            {l}
          </li>
        ))}
      </ul>
    </Panel>
  );
}


function Footer() {
  return (
    <footer
      className="mt-10 border-t pt-6 text-center text-xs leading-relaxed opacity-70"
      style={{ borderColor: "var(--neuro-line)" }}
    >
      <a
        href="/firmware/axon_neuro_bulb.ino"
        download
        className="mx-auto mb-6 block w-full max-w-xs rounded-xl px-4 py-2.5 text-center text-sm font-medium transition-transform active:scale-[0.98]"
        style={{ background: "var(--emo-soft)", border: "1px solid var(--emo)", color: "var(--neuro-fg)" }}
      >
        Download ESP32 firmware (.ino)
      </a>
      <p className="font-medium tracking-[0.12em] uppercase" style={{ color: "var(--emo)" }}>
        Axon Dynamics
      </p>

      <p className="mt-1">Developed by Hakeem Kurfi · Katsina, Nigeria</p>
      <p className="mt-1 opacity-70">
        Harbin Engineering University — Department of Science and Intelligent Systems · Class of AI ·
        Research: Neuroscience
      </p>
    </footer>
  );
}
