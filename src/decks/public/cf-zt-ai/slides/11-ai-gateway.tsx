import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Database, Gauge, Layers, ShieldCheck } from "lucide-react";
import type { SlideDef } from "@/framework/viewer/types";
import { Tag } from "../components/primitives/Tag";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { Cite } from "../components/primitives/Cite";
import { SourceFooter } from "../components/primitives/SourceFooter";

/* =====================================================================
   AI Gateway · Routing Diagram (v3)
   ---------------------------------------------------------------------
   Visual model (this is the third iteration — see prior commits for v1
   and v2; the brief from the speaker after v2 was specific):

     • Each app has its own coloured flow leaving its RIGHT edge.
     • Flows enter the gateway at DIFFERENT y values per app — so we can
       distinguish them as they cross the gateway interior.
     • Pills flash ONLY when a flow's dot is currently inside the pill's
       x-range — derived from path geometry, never on a timer.
     • Spawn rate is slower so there's space between pulses; pills don't
       look like they're flashing constantly.

   Layering (critical for readability):

     z=10  HTML cards (apps, pills, providers, gateway header & footer)
            — these visually "swallow" the dot at their borders, so the
              flow reads as: dot leaves app → travels through empty gw
              interior → vanishes into pill → reappears on far side →
              vanishes into provider.
     z= 0  SVG layer with paths and dots.
            — gateway BODY is transparent so dots are visible between
              pills inside the gateway region.

   Three pulse archetypes:

     forwarded  ~65%   end-to-end to a specific provider (per-app default)
     cached     ~25%   dot stops at Cache pill — request served at edge
     blocked    ~10%   dot stops at DLP pill, pill flashes red — prompt
                         never leaves Cloudflare
   ===================================================================== */

// --- Canvas dimensions -------------------------------------------------
const VB_W = 1480;
const VB_H = 580;

// --- Apps (RIGHT-anchored: app.x = right edge of the card) ------------
type App = {
  id: string;
  name: string;
  color: string;
  /** Right-edge x in viewBox space — also the path start point. */
  x: number;
  /** Centre y in viewBox space — flow stays at this y across the gateway. */
  y: number;
  defaultProvider: number;
};

// y values are tuned to fall inside the pill area (PILL_TOP..PILL_BOT =
// 120..480) so each app's straight-line traversal of the gateway crosses
// every pill's bounding box.
const APPS: App[] = [
  {
    id: "support",
    name: "support-bot",
    color: "#ff4801",
    x: 200,
    y: 175,
    defaultProvider: 0, // OpenAI
  },
  {
    id: "internal",
    name: "internal-rag",
    color: "#2563eb",
    x: 200,
    y: 270,
    defaultProvider: 2, // Workers AI
  },
  {
    id: "marketing",
    name: "marketing-cms",
    color: "#ee0ddb",
    x: 200,
    y: 340,
    defaultProvider: 1, // Anthropic
  },
  {
    id: "engineering",
    name: "engineering-bot",
    color: "#0a95ff",
    x: 200,
    y: 425,
    defaultProvider: 3, // OpenRouter
  },
];

// --- Policies (4 modules inside the gateway) --------------------------
const POLICIES = [
  {
    id: "cache",
    label: "Cache",
    detail: "edge return",
    explainer: "idempotent prompts served from the nearest PoP",
    icon: Database,
    color: "#2563eb",
  },
  {
    id: "rate",
    label: "Rate-limit",
    detail: "per-user · per-app",
    explainer: "token quotas, cost caps, abuse defence",
    icon: Gauge,
    color: "#eab308",
  },
  {
    id: "fall",
    label: "Fallback",
    detail: "switch on 5xx · 429",
    explainer: "auto-route to a healthy provider",
    icon: Layers,
    color: "#0a95ff",
  },
  {
    id: "dlp",
    label: "DLP",
    detail: "inspect prompts",
    explainer: "block secrets, PII, regulated data",
    icon: ShieldCheck,
    color: "#dc2626",
  },
];

// --- Gateway box bounds -----------------------------------------------
const GW_LEFT = 290;
const GW_RIGHT = 1240;
const GW_TOP = 60;
const GW_BOTTOM = 540;
const GW_W = GW_RIGHT - GW_LEFT; // 950
const GW_H = GW_BOTTOM - GW_TOP; // 480

// Pill geometry — 4 cards spread across the gateway interior, ~75% of
// the gateway's height, with their icons at vertical centre y=300.
const PILL_PAD = 14;
const PILL_GAP = 18;
const PILL_W = (GW_W - 2 * PILL_PAD - 3 * PILL_GAP) / 4; // 219.5
const PILL_TOP = GW_TOP + 60; // y=120
const PILL_BOT = GW_BOTTOM - 60; // y=480
const PILL_H = PILL_BOT - PILL_TOP; // 360

// Pill x-edges (used by both glow scheduler and HTML overlay).
const PILL_LX = [0, 1, 2, 3].map(
  (i) => GW_LEFT + PILL_PAD + i * (PILL_W + PILL_GAP),
);
const PILL_RX = PILL_LX.map((lx) => lx + PILL_W);
const PILL_CX = PILL_LX.map((lx) => lx + PILL_W / 2);

// --- Providers (LEFT-anchored — dot lands at the card's left doorstep)
type Provider = {
  id: string;
  name: string;
  logo: string;
  model: string;
  color: string;
  x: number;
  y: number;
};

const PROVIDERS: Provider[] = [
  {
    id: "openai",
    name: "OpenAI",
    logo: "/cf-zt-ai/logos/openai.svg",
    model: "gpt-4o",
    color: "#10a37f",
    x: 1290,
    y: 75,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    logo: "/cf-zt-ai/logos/anthropic.svg",
    model: "claude-3.5",
    color: "#d97757",
    x: 1290,
    y: 168,
  },
  {
    id: "workers-ai",
    name: "Workers AI",
    logo: "/cf-zt-ai/logos/cloudflare.svg",
    model: "llama-3.3",
    color: "#ff4801",
    x: 1290,
    y: 261,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    logo: "/cf-zt-ai/logos/openrouter.svg",
    model: "any model",
    color: "#6366f1",
    x: 1290,
    y: 354,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    logo: "/cf-zt-ai/logos/deepseek.svg",
    model: "v3",
    color: "#4d6bfe",
    x: 1290,
    y: 447,
  },
  {
    id: "vertex",
    name: "Vertex AI",
    logo: "/cf-zt-ai/logos/gemini.svg",
    model: "gemini-2.5",
    color: "#4285f4",
    x: 1290,
    y: 540,
  },
];

// --- Pulse generation -------------------------------------------------
type PulseKind = "forwarded" | "cached" | "blocked";

interface Pulse {
  id: number;
  kind: PulseKind;
  appIdx: number;
  /** Rendered dot/halo/trail colour — the *app's* colour, regardless
   *  of pulse kind, so flows are distinguishable per-app. */
  color: string;
  providerIdx: number;
  pathD: string;
  duration: number;
  /** When (ms after start) the dot enters and exits each pill it
   *  traverses. Pre-computed from path geometry so the glow tracks
   *  the visible dot exactly. */
  pillIntervals: { idx: number; enter: number; exit: number }[];
  /** Pill the pulse terminates at (cached/blocked only). */
  terminalPillIdx: number | null;
}

function rotateIndex(not: number, n: number): number {
  return (not + 1 + Math.floor(Math.random() * (n - 1))) % n;
}

function generatePulse(seq: number): Pulse {
  // Weighted draw across kinds. Kept similar to v2 — the brief was
  // "less frequent" not "different distribution".
  const r = Math.random();
  const kind: PulseKind = r < 0.1 ? "blocked" : r < 0.35 ? "cached" : "forwarded";

  const appIdx = Math.floor(Math.random() * APPS.length);
  const app = APPS[appIdx];

  // Provider only matters for forwarded.
  let providerIdx = app.defaultProvider;
  if (kind === "forwarded" && Math.random() < 0.2) {
    providerIdx = rotateIndex(app.defaultProvider, PROVIDERS.length);
  }

  // Path geometry — straight horizontal line at app.y across the
  // gateway interior, with a curve to the provider on the far side.
  const provider = PROVIDERS[providerIdx];
  let pathD: string;
  let duration: number;
  /** End x of the gateway-interior segment (changes per kind). */
  let interiorEndX: number;
  /** Total approximate path length — used for glow timing. */
  let totalLen: number;
  /** Length of the straight portion before any exit curve. */
  let straightLen: number;

  // Entry segment: app right edge → gateway entry. Always straight at
  // app.y, length = GW_LEFT - app.x = 90.
  // Entry segment length is fixed (GW_LEFT - app.x = 90); declared inline below.

  if (kind === "cached") {
    interiorEndX = PILL_CX[0];
    pathD = [
      `M ${app.x} ${app.y}`,
      `L ${interiorEndX} ${app.y}`,
    ].join(" ");
    straightLen = interiorEndX - app.x;
    totalLen = straightLen;
    duration = 1.4;
  } else if (kind === "blocked") {
    interiorEndX = PILL_CX[3];
    pathD = [
      `M ${app.x} ${app.y}`,
      `L ${interiorEndX} ${app.y}`,
    ].join(" ");
    straightLen = interiorEndX - app.x;
    totalLen = straightLen;
    duration = 1.8;
  } else {
    interiorEndX = GW_RIGHT;
    pathD = [
      `M ${app.x} ${app.y}`,
      `L ${interiorEndX} ${app.y}`,
      // Curve to the provider's left-edge doorstep.
      `C ${GW_RIGHT + 40} ${app.y}, ${provider.x - 50} ${provider.y}, ${provider.x} ${provider.y}`,
    ].join(" ");
    straightLen = interiorEndX - app.x;
    // Approximate the exit curve as a straight chord plus 5%.
    const dx = provider.x - GW_RIGHT;
    const dy = provider.y - app.y;
    const exitLen = Math.sqrt(dx * dx + dy * dy) * 1.05;
    totalLen = straightLen + exitLen;
    duration = 2.6;
  }

  // Pill enter/exit timings — ONLY include pills whose x-range falls
  // within the dot's actual path. Cached only crosses pill 0; blocked
  // crosses pills 0..3; forwarded crosses all 4.
  const pillIntervals: Pulse["pillIntervals"] = [];
  const dotSpeed = totalLen / (duration * 1000); // px per ms

  for (let i = 0; i < PILL_LX.length; i++) {
    // Skip pills that are entirely past where the dot stops.
    if (PILL_LX[i] > interiorEndX) continue;
    // Skip pills entirely before the gateway entry.
    if (PILL_RX[i] < GW_LEFT) continue;

    // Distance from path start (app.x) to pill's left/right edge.
    const distToLeft = Math.max(PILL_LX[i] - app.x, 0);
    const distToRight = Math.min(PILL_RX[i], interiorEndX) - app.x;

    if (distToRight <= distToLeft) continue; // numeric safety

    pillIntervals.push({
      idx: i,
      enter: distToLeft / dotSpeed,
      exit: distToRight / dotSpeed,
    });
  }

  let terminalPillIdx: number | null = null;
  if (kind === "cached") terminalPillIdx = 0;
  else if (kind === "blocked") terminalPillIdx = 3;

  return {
    id: Date.now() + seq,
    kind,
    appIdx,
    color: app.color,
    providerIdx,
    pathD,
    duration,
    pillIntervals,
    terminalPillIdx,
  };
}

// =====================================================================
// Slide
// =====================================================================
export const aiGatewaySlide: SlideDef = {
  id: "ai-gateway",
  title: "AI Gateway · routing for every model",
  layout: "default",
  sectionLabel: "PROTECT",
  sectionNumber: "03",
  render: () => <AIGatewayBody />,
};

function AIGatewayBody() {
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [activeApp, setActiveApp] = useState<Set<number>>(new Set());
  const [activeProvider, setActiveProvider] = useState<Set<number>>(new Set());
  /** Per-pill counter so concurrent pulses correctly stack glow. */
  const [pillGlow, setPillGlow] = useState<Record<number, number>>({});
  /** Pill currently flashing red (DLP block). */
  const [pillBlocked, setPillBlocked] = useState<Set<number>>(new Set());
  /** Pill currently flashing green (cache hit terminal). */
  const [pillCached, setPillCached] = useState<Set<number>>(new Set());
  const [counts, setCounts] = useState({ cached: 0, blocked: 0, total: 0 });

  useEffect(() => {
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let seq = 0;

    const incPill = (idx: number) =>
      setPillGlow((g) => ({ ...g, [idx]: (g[idx] || 0) + 1 }));
    const decPill = (idx: number) =>
      setPillGlow((g) => {
        const v = (g[idx] || 1) - 1;
        if (v <= 0) {
          const { [idx]: _drop, ...rest } = g;
          return rest;
        }
        return { ...g, [idx]: v };
      });

    const spawn = () => {
      seq += 1;
      const p = generatePulse(seq);
      setPulses((prev) => [...prev, p]);

      // App glow (instant, holds while dot leaves the app card).
      setActiveApp((s) => new Set(s).add(p.appIdx));
      timeouts.push(
        setTimeout(() => {
          setActiveApp((s) => {
            const ns = new Set(s);
            ns.delete(p.appIdx);
            return ns;
          });
        }, 800),
      );

      // Schedule per-pill on/off based on the dot's actual path
      // intervals — NEVER on an arbitrary timer.
      p.pillIntervals.forEach(({ idx, enter, exit }) => {
        timeouts.push(setTimeout(() => incPill(idx), Math.max(0, enter)));
        timeouts.push(setTimeout(() => decPill(idx), exit));
      });

      // Terminal pill specials: cache hit (green) or DLP block (red).
      if (p.kind === "cached" && p.terminalPillIdx != null) {
        const t = p.terminalPillIdx;
        timeouts.push(
          setTimeout(() => {
            setPillCached((s) => new Set(s).add(t));
          }, p.duration * 1000 - 80),
        );
        timeouts.push(
          setTimeout(
            () => {
              setPillCached((s) => {
                const ns = new Set(s);
                ns.delete(t);
                return ns;
              });
            },
            (p.duration + 0.45) * 1000,
          ),
        );
      }
      if (p.kind === "blocked" && p.terminalPillIdx != null) {
        const t = p.terminalPillIdx;
        timeouts.push(
          setTimeout(() => {
            setPillBlocked((s) => new Set(s).add(t));
          }, p.duration * 1000 - 80),
        );
        timeouts.push(
          setTimeout(
            () => {
              setPillBlocked((s) => {
                const ns = new Set(s);
                ns.delete(t);
                return ns;
              });
            },
            (p.duration + 0.55) * 1000,
          ),
        );
      }

      // Provider glow on a successful arrival.
      if (p.kind === "forwarded") {
        const tProviderOn = p.duration * 1000 - 220;
        timeouts.push(
          setTimeout(() => {
            setActiveProvider((s) => new Set(s).add(p.providerIdx));
          }, tProviderOn),
        );
        timeouts.push(
          setTimeout(
            () => {
              setActiveProvider((s) => {
                const ns = new Set(s);
                ns.delete(p.providerIdx);
                return ns;
              });
            },
            tProviderOn + 850,
          ),
        );
      }

      // Cleanup the pulse element after the path has fully faded.
      timeouts.push(
        setTimeout(
          () => setPulses((prev) => prev.filter((x) => x.id !== p.id)),
          (p.duration + 0.5) * 1000,
        ),
      );

      setCounts((c) => ({
        cached: c.cached + (p.kind === "cached" ? 1 : 0),
        blocked: c.blocked + (p.kind === "blocked" ? 1 : 0),
        total: c.total + 1,
      }));
    };

    timeouts.push(setTimeout(spawn, 350));
    // Slower than v2 (1050ms) — the brief was "less fast" so each
    // pulse has visual breathing room.
    const interval = setInterval(spawn, 1700);

    return () => {
      clearInterval(interval);
      timeouts.forEach(clearTimeout);
    };
  }, []);

  const denom = Math.max(counts.total, 1);
  const cachePct = Math.round((counts.cached / denom) * 100);
  const blockPct = Math.round((counts.blocked / denom) * 100);

  return (
    <div className="mx-auto flex h-full w-full max-w-[1480px] flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Tag tone="error">Protect · Architecture</Tag>
          <h2 className="mt-3 text-3xl tracking-[-0.035em] sm:text-5xl">
            One <span className="text-cf-orange">AI Gateway</span>, every
            model. Routed by policy.
          </h2>
          <p className="mt-2 max-w-2xl text-cf-text-muted">
            Same SDK call your apps already use. Just point the base URL
            at Cloudflare
            <Cite
              n={1}
              href="https://developers.cloudflare.com/ai-gateway/"
            />. Every prompt walks Cache → Rate-limit → Fallback → DLP,
            then routes to the provider that fits the prompt. Each
            colour below is a different app's traffic.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Stat label="Cache hit" value={`${cachePct}%`} accent="var(--color-cf-success)" />
          <Stat label="DLP block" value={`${blockPct}%`} accent="var(--color-cf-error)" />
          <Stat label="Inflight" value={`${pulses.length}`} accent="var(--color-cf-orange)" />
        </div>
      </div>

      {/* Diagram canvas */}
      <div className="relative flex flex-1 items-center justify-center">
        <div
          className="relative w-full"
          style={{ aspectRatio: `${VB_W} / ${VB_H}`, maxHeight: "100%" }}
        >
          {/* SVG layer (under HTML cards). Pulses fly through here; they
              are visually swallowed by HTML cards when crossing pills,
              apps, or providers because those cards sit at z=10. */}
          <svg
            className="pointer-events-none absolute inset-0 z-0 h-full w-full"
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
          >
            {/* Static rails (one per app y) — frame the per-app lanes. */}
            {APPS.map((app) => (
              <line
                key={`rail-${app.id}`}
                x1={GW_LEFT}
                y1={app.y}
                x2={GW_RIGHT}
                y2={app.y}
                stroke="var(--color-cf-border)"
                strokeWidth={1}
                strokeDasharray="6 5"
                opacity={0.4}
              />
            ))}
            {pulses.map((p) => (
              <PulseSvg key={p.id} pulse={p} />
            ))}
          </svg>

          {/* HTML overlay (above SVG). Each card "swallows" the dot at
              its bounding rectangle. */}
          <div className="absolute inset-0 z-10">
            {APPS.map((app, i) => (
              <AppCard key={app.id} app={app} active={activeApp.has(i)} />
            ))}

            <GatewayFrame
              pillGlow={pillGlow}
              pillBlocked={pillBlocked}
              pillCached={pillCached}
            />

            {PROVIDERS.map((provider, i) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                active={activeProvider.has(i)}
              />
            ))}

            {/* Column labels */}
            <span
              className="absolute font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle"
              style={{ left: 0, top: 0 }}
            >
              Your apps
            </span>
            <span
              className="absolute font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle"
              style={{
                left: `${(GW_LEFT / VB_W) * 100}%`,
                top: 0,
              }}
            >
              Cloudflare AI Gateway · per-policy chain
            </span>
            <span
              className="absolute font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle"
              style={{ right: 0, top: 0 }}
            >
              Providers · routed per policy
            </span>
          </div>
        </div>
      </div>

      {/* Bottom callout */}
      <div className="rounded-2xl border border-dashed border-cf-orange/40 bg-cf-orange-light p-4 font-mono text-sm text-cf-text">
        <span className="text-cf-orange">$ </span>
        <span>OPENAI_BASE_URL=</span>
        <span className="font-medium text-cf-orange">
          https://gateway.ai.cloudflare.com/v1/&lt;account&gt;/&lt;gateway&gt;/openai
        </span>
        <Cite
          n={2}
          href="https://developers.cloudflare.com/ai-gateway/providers/openai/"
        />
        <span className="ml-2 text-cf-text-subtle">
          # one env var · zero SDK changes
        </span>
      </div>

      <SourceFooter
        sources={[
          {
            n: 1,
            label: "Cloudflare AI Gateway · product docs",
            href: "https://developers.cloudflare.com/ai-gateway/",
          },
          {
            n: 2,
            label: "AI Gateway · OpenAI-compatible base URL",
            href: "https://developers.cloudflare.com/ai-gateway/providers/openai/",
          },
        ]}
      />
    </div>
  );
}

// =====================================================================
// SVG: per-pulse trail + travelling dot + halo
// =====================================================================
function PulseSvg({ pulse }: { pulse: Pulse }) {
  const color = pulse.color;

  // Slight tint adjustment so cache/block events still telegraph their
  // semantic colour while keeping the per-app hue dominant on the trail.
  const haloColor =
    pulse.kind === "blocked"
      ? "var(--color-cf-error)"
      : pulse.kind === "cached"
        ? "var(--color-cf-success)"
        : color;

  return (
    <g>
      <motion.path
        d={pulse.pathD}
        fill="none"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        initial={{ opacity: 0, pathLength: 0 }}
        animate={{
          opacity: [0, 0.6, 0.6, 0],
          pathLength: 1,
        }}
        transition={{
          opacity: {
            duration: pulse.duration + 0.4,
            times: [0, 0.15, 0.85, 1],
            ease: "linear",
          },
          pathLength: { duration: pulse.duration, ease: "linear" },
        }}
      />
      {/* Halo — slightly larger than the dot, in the kind-tinted hue
          (lets cached/blocked still register as green/red at the
          terminal even though the trail itself uses the app colour). */}
      <circle r={11} fill={haloColor} opacity={0.22}>
        <animateMotion
          path={pulse.pathD}
          dur={`${pulse.duration}s`}
          fill="freeze"
        />
      </circle>
      {/* Dot — the request itself, in the app's colour. */}
      <circle r={5} fill={color}>
        <animateMotion
          path={pulse.pathD}
          dur={`${pulse.duration}s`}
          fill="freeze"
        />
      </circle>
    </g>
  );
}

// =====================================================================
// HTML: app card (RIGHT-anchored — app.x is the card's right edge)
// =====================================================================
function AppCard({ app, active }: { app: App; active: boolean }) {
  return (
    <div
      className="absolute flex items-center gap-2 whitespace-nowrap rounded-lg border bg-cf-bg-200 px-3 py-2 transition-all duration-300"
      style={{
        left: `${(app.x / VB_W) * 100}%`,
        top: `${(app.y / VB_H) * 100}%`,
        // Right edge anchored on app.x (so the path's M point is at the
        // card's right-edge) while the card grows leftward into spare
        // canvas.
        transform: "translate(-100%, -50%)",
        borderColor: active ? app.color : "var(--color-cf-border)",
        boxShadow: active
          ? `0 0 18px color-mix(in srgb, ${app.color} 32%, transparent), 0 0 0 3px color-mix(in srgb, ${app.color} 14%, transparent)`
          : "var(--shadow-cf-card)",
      }}
    >
      <span
        className="h-2 w-2 flex-shrink-0 rounded-full transition-shadow"
        style={{
          background: app.color,
          boxShadow: active
            ? `0 0 10px ${app.color}, 0 0 0 2px color-mix(in srgb, ${app.color} 30%, transparent)`
            : "none",
        }}
      />
      <span className="font-mono text-xs text-cf-text-muted">{app.name}</span>
    </div>
  );
}

// =====================================================================
// HTML: provider card (LEFT-anchored — dot lands at left doorstep)
// =====================================================================
function ProviderCard({
  provider,
  active,
}: {
  provider: Provider;
  active: boolean;
}) {
  return (
    <div
      className="absolute flex items-center gap-2.5 rounded-lg border bg-cf-bg-200 px-3 py-2 transition-all duration-300"
      style={{
        left: `${(provider.x / VB_W) * 100}%`,
        top: `${(provider.y / VB_H) * 100}%`,
        transform: "translate(0, -50%)",
        minWidth: "12%",
        borderColor: active ? provider.color : "var(--color-cf-border)",
        boxShadow: active
          ? `0 0 18px color-mix(in srgb, ${provider.color} 32%, transparent), 0 0 0 3px color-mix(in srgb, ${provider.color} 14%, transparent)`
          : "var(--shadow-cf-card)",
      }}
    >
      <img
        src={provider.logo}
        alt=""
        className="h-4 w-4 flex-shrink-0"
        draggable={false}
      />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="text-xs font-medium text-cf-text">
          {provider.name}
        </span>
        <span className="truncate font-mono text-[9px] uppercase tracking-[0.06em] text-cf-text-subtle">
          {provider.model}
        </span>
      </div>
    </div>
  );
}

// =====================================================================
// HTML: gateway frame (transparent body) with the 4 tall policy pills
// =====================================================================
function GatewayFrame({
  pillGlow,
  pillBlocked,
  pillCached,
}: {
  pillGlow: Record<number, number>;
  pillBlocked: Set<number>;
  pillCached: Set<number>;
}) {
  const left = (GW_LEFT / VB_W) * 100;
  const right = (GW_RIGHT / VB_W) * 100;
  const top = (GW_TOP / VB_H) * 100;
  const bottom = (GW_BOTTOM / VB_H) * 100;

  return (
    <div
      className="absolute"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        width: `${right - left}%`,
        height: `${bottom - top}%`,
      }}
    >
      {/* Frame: border + corner brackets, NO body fill so dots are
          visible while crossing the gateway interior. */}
      <CornerBrackets className="relative h-full w-full overflow-hidden rounded-xl border border-cf-border">
        {/* Header bar — solid bg, sits above SVG (since the parent is
            in the z=10 HTML layer). */}
        <div className="absolute top-0 right-0 left-0 flex items-center justify-between border-b border-cf-border bg-cf-bg-100 px-4 py-2">
          <span className="flex items-center gap-2">
            <img
              src="/cf-zt-ai/cloudflare-logo.png"
              alt="Cloudflare"
              className="block h-3.5 w-auto select-none"
              draggable={false}
            />
            <span className="text-cf-text-subtle">·</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-orange">
              AI Gateway
            </span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
            region: eu-west-1 · auto
          </span>
        </div>

        {/* Pills — absolute, positioned at known viewBox coords. */}
        {POLICIES.map((p, i) => (
          <PolicyPill
            key={p.id}
            policy={p}
            index={i}
            glowing={(pillGlow[i] || 0) > 0}
            blocked={pillBlocked.has(i)}
            cached={pillCached.has(i)}
          />
        ))}

        {/* Footer */}
        <div className="absolute right-4 bottom-3 left-4 flex items-center justify-between bg-cf-bg-100/85 backdrop-blur-sm rounded-md px-2 py-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
            Per-app policy resolver · prompt routing
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-cf-success">
            <motion.span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--color-cf-success)" }}
              animate={{ opacity: [0.45, 1, 0.45] }}
              transition={{
                duration: 1.6,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
            <span>routing live</span>
          </span>
        </div>
      </CornerBrackets>
    </div>
  );
}

// =====================================================================
// One policy pill — tall card spanning ~75% of gateway height
// =====================================================================
function PolicyPill({
  policy,
  index,
  glowing,
  blocked,
  cached,
}: {
  policy: (typeof POLICIES)[number];
  index: number;
  glowing: boolean;
  blocked: boolean;
  cached: boolean;
}) {
  // Pill positioned in canvas space, percentages of the gateway frame.
  const leftPct = ((PILL_LX[index] - GW_LEFT) / GW_W) * 100;
  const widthPct = (PILL_W / GW_W) * 100;
  const topPct = ((PILL_TOP - GW_TOP) / GW_H) * 100;
  const heightPct = (PILL_H / GW_H) * 100;

  const isHot = glowing || blocked || cached;
  const accent = blocked
    ? "#dc2626"
    : cached
      ? "var(--color-cf-success)"
      : policy.color;

  // Frosted glass — pill body is *very* transparent so flow lines
  // underneath remain clearly readable. The card identity comes from
  // the border + corner-glow + icon, not a solid fill.
  // (Iterations: 70% → 38% → 22% bg-opacity.)
  const baseGlassBg = isHot
    ? `color-mix(in srgb, ${accent} 14%, color-mix(in srgb, var(--color-cf-bg-200) 22%, transparent))`
    : `color-mix(in srgb, var(--color-cf-bg-200) 22%, transparent)`;

  return (
    <div
      className="absolute flex flex-col rounded-xl border transition-all duration-200"
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
        width: `${widthPct}%`,
        height: `${heightPct}%`,
        borderColor: isHot ? accent : "var(--color-cf-border)",
        background: baseGlassBg,
        backdropFilter: "blur(4px) saturate(1.05)",
        WebkitBackdropFilter: "blur(4px) saturate(1.05)",
        boxShadow: blocked
          ? `0 0 28px color-mix(in srgb, ${accent} 60%, transparent), 0 0 0 3px color-mix(in srgb, ${accent} 35%, transparent)`
          : cached
            ? `0 0 24px color-mix(in srgb, ${accent} 50%, transparent), 0 0 0 3px color-mix(in srgb, ${accent} 28%, transparent)`
            : glowing
              ? `0 0 22px color-mix(in srgb, ${accent} 42%, transparent), 0 0 0 2px color-mix(in srgb, ${accent} 22%, transparent)`
              : "none",
      }}
    >
      {/* Top: label + step number */}
      <div className="flex items-start justify-between p-3">
        <div className="flex flex-col leading-tight">
          <span
            className="text-[15px] font-medium tracking-[-0.01em]"
            style={{ color: isHot ? accent : "var(--color-cf-text)" }}
          >
            {policy.label}
          </span>
          <span className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-cf-text-subtle">
            {policy.detail}
          </span>
        </div>
        <span
          className="rounded-full border px-1.5 py-px font-mono text-[9px] font-medium tabular-nums"
          style={{
            color: isHot ? accent : "var(--color-cf-text-subtle)",
            borderColor: isHot
              ? `color-mix(in srgb, ${accent} 45%, transparent)`
              : "var(--color-cf-border)",
            background: isHot
              ? `color-mix(in srgb, ${accent} 10%, transparent)`
              : "transparent",
          }}
        >
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>

      {/* Centre: icon — at vertical centre of the pill. */}
      <div className="relative flex flex-1 items-center justify-center">
        <motion.span
          className="absolute h-16 w-16 rounded-full"
          aria-hidden="true"
          style={{
            background: `color-mix(in srgb, ${accent} ${isHot ? 18 : 6}%, transparent)`,
            boxShadow: isHot
              ? `inset 0 0 0 1px color-mix(in srgb, ${accent} 38%, transparent)`
              : "inset 0 0 0 1px var(--color-cf-border)",
          }}
          animate={
            isHot
              ? { scale: [1, 1.18, 1], opacity: [1, 0.7, 1] }
              : { scale: 1, opacity: 1 }
          }
          transition={{ duration: 0.45, ease: "easeOut" }}
        />
        <span
          className="relative flex h-12 w-12 items-center justify-center rounded-full transition-colors duration-200"
          style={{
            background: isHot
              ? `color-mix(in srgb, ${accent} 22%, var(--color-cf-bg-100))`
              : "var(--color-cf-bg-100)",
            color: accent,
            border: `1.5px solid ${
              isHot ? accent : "var(--color-cf-border)"
            }`,
          }}
        >
          <policy.icon className="h-5 w-5" strokeWidth={2.1} />
        </span>
      </div>

      {/* Bottom: explainer + status badge */}
      <div className="flex items-end justify-between gap-2 p-3 pt-2">
        <span className="text-[10.5px] leading-snug text-cf-text-muted">
          {policy.explainer}
        </span>
        <motion.span
          className="rounded-full px-1.5 py-px font-mono text-[8.5px] font-medium uppercase tracking-[0.08em] whitespace-nowrap"
          animate={{
            scale: blocked ? [1, 1.12, 1] : 1,
          }}
          transition={{
            duration: blocked ? 0.45 : 0.2,
            repeat: blocked ? 1 : 0,
          }}
          style={{
            color: isHot
              ? accent
              : "var(--color-cf-text-subtle)",
            background: isHot
              ? `color-mix(in srgb, ${accent} 14%, transparent)`
              : "transparent",
            border: `1px solid ${
              isHot
                ? `color-mix(in srgb, ${accent} 50%, transparent)`
                : "var(--color-cf-border)"
            }`,
          }}
        >
          {blocked ? "blocked" : cached ? "cache hit" : glowing ? "active" : "idle"}
        </motion.span>
      </div>
    </div>
  );
}

// =====================================================================
// Tiny stat tile for the header
// =====================================================================
function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="cf-card flex flex-col items-end px-4 py-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
        {label}
      </span>
      <span
        className="font-mono text-2xl font-medium tabular-nums"
        style={{ color: accent }}
      >
        {value}
      </span>
    </div>
  );
}
