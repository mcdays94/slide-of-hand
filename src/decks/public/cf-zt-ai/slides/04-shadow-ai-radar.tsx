import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Radar, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import type { SlideDef } from "@/framework/viewer/types";
import { Tag } from "../components/primitives/Tag";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { Cite } from "../components/primitives/Cite";
import { SourceFooter } from "../components/primitives/SourceFooter";
import { easeButton, easeEntrance } from "../lib/motion";

interface DetectedApp {
  id: string;
  name: string;
  category: string;
  users: number;
  /** Position on radar 0..1 */
  x: number;
  y: number;
  status: "shadow" | "sanctioned" | "blocked";
  vendor: string;
}

// All apps here generate outbound traffic that Cloudflare Gateway/CASB
// can actually inspect. (Locally-running models like ollama on a laptop
// would be invisible to Cloudflare and are an MDM/EDR concern instead;
// they were removed from this list after a fact-check pass.)
const APPS: DetectedApp[] = [
  { id: "chatgpt", name: "ChatGPT", category: "Conversational", users: 412, x: 0.3, y: 0.4, status: "sanctioned", vendor: "OpenAI" },
  { id: "claude", name: "Claude", category: "Conversational", users: 318, x: 0.6, y: 0.55, status: "sanctioned", vendor: "Anthropic" },
  { id: "perplexity", name: "Perplexity", category: "Research", users: 92, x: 0.7, y: 0.3, status: "shadow", vendor: "Perplexity" },
  { id: "cursor", name: "Cursor", category: "Coding", users: 48, x: 0.4, y: 0.7, status: "shadow", vendor: "Cursor" },
  { id: "characterai", name: "Character.AI", category: "Personal", users: 18, x: 0.78, y: 0.78, status: "blocked", vendor: "Character" },
  { id: "midjourney", name: "Midjourney", category: "Creative", users: 14, x: 0.22, y: 0.62, status: "blocked", vendor: "Midjourney" },
  { id: "you", name: "You.com", category: "Research", users: 27, x: 0.5, y: 0.22, status: "shadow", vendor: "You.com" },
  { id: "huggingface", name: "Hugging Face", category: "Inference API", users: 31, x: 0.8, y: 0.5, status: "shadow", vendor: "Hugging Face" },
  { id: "elevenlabs", name: "ElevenLabs", category: "Voice", users: 9, x: 0.2, y: 0.32, status: "shadow", vendor: "ElevenLabs" },
  { id: "runway", name: "Runway", category: "Video", users: 6, x: 0.65, y: 0.78, status: "shadow", vendor: "Runway" },
  { id: "copilot", name: "Copilot", category: "Coding", users: 184, x: 0.34, y: 0.62, status: "sanctioned", vendor: "Microsoft" },
];

const STATUS_META = {
  shadow: { color: "var(--color-cf-warning)", icon: ShieldAlert, label: "Shadow" },
  sanctioned: { color: "var(--color-cf-success)", icon: ShieldCheck, label: "Sanctioned" },
  blocked: { color: "var(--color-cf-error)", icon: ShieldX, label: "Blocked" },
} as const;

export const shadowAiRadarSlide: SlideDef = {
  id: "shadow-ai-radar",
  title: "Shadow AI on the radar",
  layout: "default",
  sectionLabel: "DISCOVER",
  sectionNumber: "01",
  render: () => <ShadowAiRadarBody />,
};

function ShadowAiRadarBody() {
  const [sweepAngle, setSweepAngle] = useState(0);
  const [discovered, setDiscovered] = useState<Set<string>>(new Set());
  /** Apps the sweep is *currently* over — used for the radar-style ping
   *  glow that pulses as the line passes. */
  const [touched, setTouched] = useState<Set<string>>(new Set());

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    function tick(now: number) {
      const dt = (now - last) / 1000;
      last = now;
      setSweepAngle((a) => (a + dt * 90) % 360);
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // For each frame: figure out which apps the LEADING RED LINE is
  // currently passing over.
  //
  // Coordinate system: in CSS the rendered "leading line" is a child
  // of a div rotated by `sweepAngle` (CSS clockwise). Initially the
  // line points east. After CSS rotate(α) clockwise, the line points
  // at the screen position where (cos α, sin α) lands — which means
  // the line's atan2 angle (in screen coords, with y pointing down)
  // is exactly `sweepAngle`.
  //
  // So the touch test is "is the app's atan2 angle within ±5° of
  // sweepAngle?" — no rotation offsets needed. Earlier iterations
  // applied a +270° offset that mapped the test onto a totally
  // different position; that's why the icons weren't reacting in sync
  // with the visible line.
  useEffect(() => {
    const center = { x: 0.5, y: 0.5 };
    const newlyDiscovered: string[] = [];
    const nowTouched = new Set<string>();
    APPS.forEach((app) => {
      const dx = app.x - center.x;
      const dy = app.y - center.y;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const angleNormalized = (angle + 360) % 360;
      const sweepNormalized = ((sweepAngle % 360) + 360) % 360;
      const diff = (angleNormalized - sweepNormalized + 360) % 360;
      // ±6° band centred on the leading line — wide enough to give
      // the eye a perceptible flash at 90°/s sweep speed.
      const onLeadingLine = diff < 6 || diff > 354;
      if (onLeadingLine) {
        nowTouched.add(app.id);
        if (!discovered.has(app.id)) newlyDiscovered.push(app.id);
      }
    });

    setTouched((prev) => {
      if (prev.size === nowTouched.size) {
        let same = true;
        for (const id of prev) {
          if (!nowTouched.has(id)) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return nowTouched;
    });

    if (newlyDiscovered.length > 0) {
      setDiscovered((s) => {
        const next = new Set(s);
        newlyDiscovered.forEach((id) => next.add(id));
        return next;
      });
    }
  }, [sweepAngle, discovered]);

  return (
    <div className="mx-auto flex h-full w-full max-w-[1480px] flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Tag>Discover</Tag>
          <h2 className="mt-3 text-3xl tracking-[-0.035em] sm:text-5xl">
            <span className="text-cf-orange">Shadow AI</span> on the radar.
          </h2>
          <p className="mt-2 max-w-2xl text-cf-text-muted">
            Cloudflare CASB and Gateway sweep your traffic continuously
            <Cite
              n={1}
              href="https://developers.cloudflare.com/learning-paths/holistic-ai-security/concepts/shadow-ai/"
            />. Personal accounts. Local models. Browser plug-ins. With
            <span className="font-medium text-cf-text">
              {" "}78% of workers bringing their own AI to work
            </span>
            <Cite
              n={2}
              href="https://www.microsoft.com/en-us/worklab/work-trend-index/ai-at-work-is-here-now-comes-the-hard-part"
            />, the first scan almost always surfaces a long tail of
            tools IT had no visibility into.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="cf-tag flex items-center gap-2">
            <Radar className="h-3 w-3 cf-float" /> Scanning
          </span>
          <CornerBrackets className="cf-card flex items-center gap-3 px-4 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
              Discovered
            </span>
            <span className="font-mono text-2xl font-medium text-cf-orange tabular-nums">
              {discovered.size}
            </span>
            <span className="text-cf-text-subtle">/</span>
            <span className="font-mono text-2xl font-medium text-cf-text-muted tabular-nums">
              {APPS.length}
            </span>
          </CornerBrackets>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]">
        {/* Radar */}
        <div className="relative flex items-center justify-center">
          <div
            className="relative aspect-square w-full max-w-[560px] rounded-full border border-cf-border bg-cf-bg-200"
            style={{
              backgroundImage:
                "radial-gradient(circle at center, var(--color-cf-bg-200) 0%, var(--color-cf-bg-100) 100%)",
            }}
          >
            {/* Concentric guides */}
            {[0.25, 0.5, 0.75].map((r) => (
              <div
                key={r}
                className="cf-dashed-line-h absolute"
                style={{
                  borderRadius: "9999px",
                  inset: `${r * 50}%`,
                  border: "1px dashed var(--color-cf-border)",
                  background: "transparent",
                }}
              />
            ))}
            {/* Cross hair */}
            <div className="cf-dashed-line-h absolute left-0 right-0 top-1/2" />
            <div className="cf-dashed-line-v absolute bottom-0 left-1/2 top-0" />

            {/* Sweep wedge */}
            <motion.div
              className="absolute inset-0"
              animate={{ rotate: sweepAngle }}
              transition={{ duration: 0, ease: "linear" }}
              style={{ transformOrigin: "50% 50%" }}
              aria-hidden="true"
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "conic-gradient(from 0deg, rgba(255,72,1,0.0) 0deg, rgba(255,72,1,0.18) 30deg, rgba(255,72,1,0.0) 60deg)",
                  borderRadius: "9999px",
                }}
              />
              {/* Leading red line — extends from center to the rim of
                  the radar. Bumped to 2px tall so the audience can
                  visually track it; gradient is bright at the inner end
                  and fades to transparent at the rim. */}
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  width: "50%",
                  height: 2,
                  background:
                    "linear-gradient(to right, rgba(255,72,1,0.95) 0%, rgba(255,72,1,0.7) 65%, rgba(255,72,1,0) 100%)",
                  boxShadow: "0 0 8px rgba(255,72,1,0.55)",
                  transformOrigin: "0 50%",
                  transform: "translateY(-1px)",
                }}
              />
            </motion.div>

            {/* Center pulse — Cloudflare logo dot */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="relative h-8 w-8">
                <span className="cf-live-dot absolute inset-0 !h-8 !w-8 !bg-cf-orange" />
              </div>
            </div>

            {/* App markers — quiet by default. When the sweep's leading
                line passes over an icon, we add a subtle box-shadow
                glow only. No scale, no pulse ring — just a brief halo
                so the audience reads "the radar just touched this". */}
            {APPS.map((app) => {
              const isDiscovered = discovered.has(app.id);
              const isTouched = touched.has(app.id);
              const meta = STATUS_META[app.status];
              return (
                <motion.div
                  key={app.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{
                    left: `${app.x * 100}%`,
                    top: `${app.y * 100}%`,
                  }}
                  initial={false}
                  animate={{
                    scale: isDiscovered ? 1 : 0.6,
                    opacity: isDiscovered ? 1 : 0.35,
                  }}
                  transition={{ duration: 0.3, ease: easeEntrance }}
                >
                  <div
                    className="flex flex-col items-center gap-1"
                    style={{ color: meta.color }}
                  >
                    <span
                      className="relative flex h-7 w-7 items-center justify-center rounded-full border-2 transition-shadow duration-300"
                      style={{
                        borderColor: isDiscovered
                          ? meta.color
                          : "var(--color-cf-border)",
                        background: isDiscovered
                          ? `color-mix(in srgb, ${meta.color} 20%, var(--color-cf-bg-200))`
                          : "var(--color-cf-bg-200)",
                        boxShadow: isTouched
                          ? `0 0 12px color-mix(in srgb, ${meta.color} 65%, transparent)`
                          : "none",
                      }}
                    >
                      <meta.icon className="h-3 w-3" />
                    </span>
                    {isDiscovered && (
                      <span className="rounded-full border border-cf-border bg-cf-bg-100 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-cf-text shadow-cf-card">
                        {app.name}
                      </span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Right rail: discovered list */}
        <div className="flex flex-col gap-3">
          <div className="cf-card flex flex-col gap-2 p-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
              Detection breakdown
            </span>
            <div className="grid grid-cols-3 gap-2">
              {(["sanctioned", "shadow", "blocked"] as const).map((status) => {
                const meta = STATUS_META[status];
                const count = APPS.filter((a) => a.status === status).length;
                return (
                  <div
                    key={status}
                    className="rounded-lg border p-2"
                    style={{
                      borderColor: meta.color + "40",
                      background: meta.color + "10",
                    }}
                  >
                    <div
                      className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider"
                      style={{ color: meta.color }}
                    >
                      <meta.icon className="h-2.5 w-2.5" />
                      {meta.label}
                    </div>
                    <div
                      className="mt-1 text-2xl font-medium tabular-nums"
                      style={{ color: meta.color }}
                    >
                      {count}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <CornerBrackets className="cf-card flex-1 overflow-hidden">
            <div className="flex items-center justify-between border-b border-cf-border bg-cf-bg-100 px-4 py-2.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
                Live discoveries
              </span>
              <span className="cf-live-dot" />
            </div>
            <div className="cf-no-scrollbar max-h-[420px] overflow-auto">
              <AnimatePresence>
                {APPS.filter((a) => discovered.has(a.id))
                  .sort((a, b) => b.users - a.users)
                  .map((app) => {
                    const meta = STATUS_META[app.status];
                    return (
                      <motion.div
                        key={app.id}
                        layout
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, ease: easeButton }}
                        className="flex items-center gap-3 border-b border-dashed border-cf-border px-4 py-3 last:border-0"
                      >
                        <span
                          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
                          style={{ background: meta.color + "20", color: meta.color }}
                        >
                          <meta.icon className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-cf-text">
                            {app.name}
                          </span>
                          <span className="block font-mono text-[10px] uppercase tracking-wider text-cf-text-subtle">
                            {app.category} · {app.vendor}
                          </span>
                        </div>
                        <span className="flex flex-col items-end">
                          <span className="font-mono text-sm tabular-nums text-cf-text-muted">
                            {app.users}
                          </span>
                          <span className="font-mono text-[9px] uppercase tracking-wider text-cf-text-subtle">
                            users
                          </span>
                        </span>
                      </motion.div>
                    );
                  })}
              </AnimatePresence>
              {discovered.size === 0 && (
                <div className="flex h-32 items-center justify-center text-sm text-cf-text-subtle">
                  Scanning…
                </div>
              )}
            </div>
          </CornerBrackets>
        </div>
      </div>

      <SourceFooter
        sources={[
          {
            n: 1,
            label: "Cloudflare · What is Shadow AI?",
            href: "https://developers.cloudflare.com/learning-paths/holistic-ai-security/concepts/shadow-ai/",
          },
          {
            n: 2,
            label:
              "Microsoft & LinkedIn · Work Trend Index 2024 (78% BYOAI)",
            href: "https://www.microsoft.com/en-us/worklab/work-trend-index/ai-at-work-is-here-now-comes-the-hard-part",
          },
        ]}
      />
    </div>
  );
}
