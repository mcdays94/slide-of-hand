import { useEffect, useMemo, useRef, useState } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  animate as motionAnimate,
} from "framer-motion";
import {
  Github,
  MessageSquare,
  PenTool,
  Database,
  BookOpen,
  Bug,
  FileText,
  Cloud,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import type { SlideDef } from "@/framework/viewer/types";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { easeEntrance, easeButton } from "../lib/motion";
import {
  MCP_SERVERS,
  CODE_MODE_TOKENS,
  totalTokens,
  tokenSavingsPct,
  type McpServer,
} from "./_token-explosion-logic";

/**
 * Slide 06 — The token explosion.
 *
 * Recreates the visual from cloudflare.leo.arsen.in/deck/codemode (slide 1):
 * a central "Agent" node connected to 8 MCP servers, with the giant
 * headline numbers (2,594 endpoints / 15 servers / 1,069 tokens) above
 * and a real-feeling Erlenmeyer FLASK on the right that fills with
 * orange "liquid" as schemas pour in — and empties on the Code Mode
 * pivot. Liquid sloshes via two stacked SVG sine paths sliding at
 * different speeds, with a meniscus highlight to sell the volume.
 *
 * Phase plan (0..2):
 *   0 — static layout: agent + 8 server pills connected by faint lines,
 *       flask empty, headline numbers visible.
 *   1 — schemas pour into the flask, liquid fills 0% → 100% (overflow),
 *       counter spins 0 → ~50,000, "Context explosion" banner pinned
 *       directly ABOVE the flask mouth (where the meniscus is).
 *   2 — Code Mode pivot: flask drains back down to ~2%, counter sweeps
 *       down to 1,069, "−98% tokens" badge pinned directly BELOW the
 *       (now nearly empty) flask base with a small up-arrow pointing
 *       to the flask.
 *
 * All pure math (running totals, savings %) lives in
 * `_token-explosion-logic.ts` and is unit-tested in
 * `tests/token-explosion/token-fill.test.ts`.
 *
 * Reduced motion: liquid snaps to its phase-end fill, counter shows the
 * final number with no spin, the explosion banner doesn't pulse, the
 * wave doesn't slosh, schema cards fade in instead of sliding.
 */

// ─── Visual constants ────────────────────────────────────────────────
//
// The viewBox aspect is tuned to match the slide body's real aspect on
// 16:9 displays (~2.4:1 once chrome and the headline-numbers row are
// subtracted). Designing the viewBox to match prevents giant letterbox
// bands when `preserveAspectRatio="xMidYMid meet"` has to fit a
// mismatched ratio.

const VIEW_W = 1800;
const VIEW_H = 750;

// Agent node — centre of the LEFT 60% of the canvas (≈ 0..1080).
const AGENT_X = 560;
const AGENT_Y = 380;

// Erlenmeyer flask — anchored in the RIGHT ~40% (1400..1720), with
// strong vertical presence so it reads as a real container.
const FLASK_BBOX_X = 1410;
const FLASK_BBOX_W = 280;
const FLASK_TOP_Y = 80;
const FLASK_BOTTOM_Y = 680;
const FLASK_NECK_TOP_Y = 100; // mouth (rim) sits a hair below the bbox top
const FLASK_NECK_BASE_Y = 200; // where the conical body starts
const FLASK_NECK_HALF_W = 36; // half-width of the neck (mouth is ~72px wide)
const FLASK_BASE_HALF_W = FLASK_BBOX_W / 2 - 4; // a hair shy of the bbox edge
const FLASK_CX = FLASK_BBOX_X + FLASK_BBOX_W / 2; // 1550

// Server-pill fan around the agent — 8 pills laid out on an arc that
// wraps the LEFT side, leaving the right edge open for the flask.
const NODE_RADIUS = 320;
const PILL_W = 196;
const PILL_H = 56;

// Wave geometry. Period = 1× flask width; we draw a strip 4 periods
// wide and slide it left by exactly one period over LOOP_S — so the
// motion is perfectly seamless because sine is periodic.
const WAVE_PERIOD = FLASK_BBOX_W;
const WAVE_PERIODS = 4;
const WAVE_AMP = 5;
const WAVE_LOOP_S = 3;

// ─── Server icon registry ────────────────────────────────────────────

/**
 * For servers where we have a brand SVG in /public/logos we use it; the
 * rest fall back to a lucide icon coloured with the brand orange.
 */
const SERVER_ICONS: Record<
  string,
  { kind: "logo"; src: string } | { kind: "lucide"; Icon: typeof Github }
> = {
  github: { kind: "lucide", Icon: Github },
  jira: { kind: "lucide", Icon: Bug },
  confluence: { kind: "lucide", Icon: FileText },
  "cf-docs": { kind: "lucide", Icon: BookOpen },
  workers: { kind: "logo", src: "/cf-code-mode/logos/cloudflare.svg" },
  slack: { kind: "lucide", Icon: MessageSquare },
  excalidraw: { kind: "lucide", Icon: PenTool },
  r2: { kind: "lucide", Icon: Database },
};

// ─── Layout helpers ──────────────────────────────────────────────────

interface NodePos {
  server: McpServer;
  x: number;
  y: number;
}

/**
 * Lay the 8 servers out on a generous arc that sweeps from upper-left
 * to lower-left around the agent. Keeping them on the LEFT half leaves
 * room for the flask on the right.
 */
function computeNodePositions(): NodePos[] {
  const startDeg = -150;
  const endDeg = 150;
  const n = MCP_SERVERS.length;
  return MCP_SERVERS.map((server, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const deg = startDeg + (endDeg - startDeg) * t;
    const rad = (deg * Math.PI) / 180;
    return {
      server,
      x: AGENT_X + Math.cos(rad) * NODE_RADIUS,
      y: AGENT_Y + Math.sin(rad) * NODE_RADIUS,
    };
  });
}

/**
 * Build the closed Erlenmeyer flask outline (a path string). The flask
 * is symmetric about FLASK_CX: a short cylindrical neck up top, a
 * conical body widening to a wide flat base.
 *
 * Coordinate sketch (right half, mirrored on the left):
 *
 *      ┌──────┐  ← FLASK_NECK_TOP_Y  (the mouth/rim)
 *      │      │
 *      │ neck │
 *      │      │
 *      └──╲   │   ← FLASK_NECK_BASE_Y  (cone shoulder)
 *          ╲  │
 *           ╲ │
 *            ╲│   ← FLASK_BOTTOM_Y    (rounded base corner)
 *             └──── flat base
 */
function flaskOutlinePath(): string {
  const cx = FLASK_CX;
  const yTop = FLASK_NECK_TOP_Y;
  const yShoulder = FLASK_NECK_BASE_Y;
  const yBase = FLASK_BOTTOM_Y;
  const neckHalf = FLASK_NECK_HALF_W;
  const baseHalf = FLASK_BASE_HALF_W;
  const r = 14; // base corner radius

  const neckLeft = cx - neckHalf;
  const neckRight = cx + neckHalf;
  const baseLeft = cx - baseHalf;
  const baseRight = cx + baseHalf;

  return [
    // start at top-left of mouth
    `M ${neckLeft} ${yTop}`,
    // top rim across (flat)
    `L ${neckRight} ${yTop}`,
    // down the right side of the neck
    `L ${neckRight} ${yShoulder}`,
    // cone outward to bottom-right (slight curve at the shoulder)
    `Q ${neckRight + 8} ${yShoulder + 24} ${baseRight} ${yBase - r}`,
    // round the bottom-right corner
    `Q ${baseRight} ${yBase} ${baseRight - r} ${yBase}`,
    // flat base
    `L ${baseLeft + r} ${yBase}`,
    // round the bottom-left corner
    `Q ${baseLeft} ${yBase} ${baseLeft} ${yBase - r}`,
    // cone back inward to the neck shoulder (mirror)
    `Q ${neckLeft - 8} ${yShoulder + 24} ${neckLeft} ${yShoulder}`,
    // up the left side of the neck
    `L ${neckLeft} ${yTop}`,
    "Z",
  ].join(" ");
}

/**
 * Build a wide "liquid strip" path with a sinusoidal top edge, in
 * ABSOLUTE viewBox coordinates centered horizontally on the flask. The
 * strip extends 4 periods wide; sliding it left by exactly one period
 * over the loop produces a seamless wave because sine is periodic.
 *
 * The strip's surface (top edge) sits at y=0 by convention — callers
 * translate the parent group to position the surface at the desired
 * fill height.
 *
 *   waveStripPath(0)        // wave A
 *   waveStripPath(Math.PI)  // wave B (180° phase-shifted, layered on top)
 */
export function waveStripPath(phase: number, amp = WAVE_AMP): string {
  const totalW = WAVE_PERIOD * WAVE_PERIODS;
  const steps = WAVE_PERIODS * 24;
  // Strip starts one period to the LEFT of the flask body so we can
  // translate -PERIOD (one full wave) and still cover the visible
  // flask interior.
  const x0 = FLASK_BBOX_X - WAVE_PERIOD;
  const yAt = (i: number) => {
    const theta = phase + (i / steps) * WAVE_PERIODS * 2 * Math.PI;
    return Math.sin(theta) * amp;
  };
  const parts: string[] = [];
  parts.push(`M ${x0} ${yAt(0)}`);
  for (let i = 1; i <= steps; i++) {
    const x = x0 + (i / steps) * totalW;
    parts.push(`L ${x} ${yAt(i)}`);
  }
  // Close to make a closed shape that extends downward to fill the
  // body below the surface — a generous overshoot since the clip path
  // confines us to the flask interior anyway.
  const yFloor = FLASK_BOTTOM_Y + 40;
  parts.push(`L ${x0 + totalW} ${yFloor}`);
  parts.push(`L ${x0} ${yFloor}`);
  parts.push("Z");
  return parts.join(" ");
}

// ─── The slide ───────────────────────────────────────────────────────

export const tokenExplosionSlide: SlideDef = {
  id: "token-explosion",
  title: "The token explosion.",
  sectionLabel: "The problem",
  sectionNumber: "02",
  phases: 2,
  layout: "default",
  render: ({ phase }) => <TokenExplosionBody phase={phase} />,
};

function TokenExplosionBody({ phase }: { phase: number }) {
  const reduce = useReducedMotion() ?? false;
  const nodes = useMemo(() => computeNodePositions(), []);
  const mcpTotal = useMemo(() => totalTokens(MCP_SERVERS), []);
  const savingsPct = useMemo(
    () => tokenSavingsPct(mcpTotal, CODE_MODE_TOKENS),
    [mcpTotal],
  );

  return (
    <div
      className="relative mx-auto flex h-full w-full flex-col px-[clamp(24px,3vw,80px)]"
      style={{ rowGap: "clamp(8px, 1.6vh, 28px)", maxWidth: "min(98vw, 2400px)" }}
    >
      {/* Headline numbers — three giant figures across the top. */}
      <HeadlineNumbers
        mcpTotal={mcpTotal}
        codeModeTotal={CODE_MODE_TOKENS}
      />

      {/* Main visualization — agent + servers on the LEFT 60%, flask on
          the RIGHT 40%, drawn as a single SVG so the connecting lines
          align perfectly with the icons. The viewBox is sized for the
          real container aspect (~2.4:1) so the slide stays balanced
          across 1080p and 4K. */}
      <div className="relative flex-1 min-h-0">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <defs>
            {/* Liquid gradient — soft warm orange. */}
            <linearGradient id="flask-liquid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-cf-orange)" stopOpacity="0.85" />
              <stop offset="55%" stopColor="var(--color-cf-orange)" stopOpacity="0.7" />
              <stop offset="100%" stopColor="var(--color-cf-orange)" stopOpacity="0.55" />
            </linearGradient>
            {/* Secondary wave — slightly cooler, layered for depth. */}
            <linearGradient id="flask-liquid-back" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-cf-orange)" stopOpacity="0.45" />
              <stop offset="100%" stopColor="var(--color-cf-orange)" stopOpacity="0.35" />
            </linearGradient>
            {/* Glass tint — barely visible, gives the flask a slight body. */}
            <linearGradient id="flask-glass" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--color-cf-text)" stopOpacity="0.04" />
              <stop offset="50%" stopColor="var(--color-cf-text)" stopOpacity="0.0" />
              <stop offset="100%" stopColor="var(--color-cf-text)" stopOpacity="0.06" />
            </linearGradient>
            {/* Clip path that confines the liquid to the flask interior. */}
            <clipPath id="flask-clip">
              <path d={flaskOutlinePath()} />
            </clipPath>
          </defs>

          {/* Connecting lines from each server pill to the agent. They fade
              out in phase 2 (Code Mode replaces the whole topology). */}
          {nodes.map((n, i) => (
            <motion.line
              key={n.server.id}
              x1={n.x}
              y1={n.y}
              x2={AGENT_X}
              y2={AGENT_Y}
              stroke="var(--color-cf-border)"
              strokeWidth={1.5}
              strokeDasharray="4 6"
              initial={{ opacity: 0 }}
              animate={{ opacity: phase >= 2 ? 0 : 0.85 }}
              transition={{
                duration: reduce ? 0 : 0.45,
                ease: easeEntrance,
                delay: reduce ? 0 : 0.05 * i,
              }}
            />
          ))}

          {/* Server pills */}
          {nodes.map((n, i) => (
            <ServerPill
              key={n.server.id}
              node={n}
              index={i}
              phase={phase}
              reduce={reduce}
            />
          ))}

          {/* Central agent node — brand-orange Worker icon */}
          <AgentNode phase={phase} reduce={reduce} />

          {/* Flask — the context-window vessel */}
          <Flask phase={phase} reduce={reduce} />

          {/* Schema cards pouring in (phase 1 only). They render last
              so they're drawn on top of the flask outline. */}
          {phase >= 1 && phase < 2 && (
            <SchemaCards reduce={reduce} />
          )}

          {/* Phase 2: a single `code()` card sits in the empty flask */}
          {phase >= 2 && <CodeCard reduce={reduce} />}

          {/* Token counter — rendered as foreignObject above the flask
              so it scales with the viewBox and never overlaps the HTML
              headline numbers. */}
          <TokenCounter
            phase={phase}
            mcpTotal={mcpTotal}
            codeModeTotal={CODE_MODE_TOKENS}
            reduce={reduce}
          />
        </svg>

        {/* Phase 1: Context-explosion banner anchored to the TOP of the
            flask (right above the meniscus / mouth) — physically tied
            to the visual. */}
        <ExplosionBanner visible={phase === 1} reduce={reduce} />

        {/* Phase 2: −98% tokens badge anchored to the BOTTOM of the
            flask, with a small up-arrow tying it back to the empty
            flask base. */}
        <SavingsBadge visible={phase >= 2} pct={savingsPct} reduce={reduce} />
      </div>
    </div>
  );
}

// ─── Headline numbers ────────────────────────────────────────────────

function HeadlineNumbers({
  mcpTotal,
  codeModeTotal,
}: {
  mcpTotal: number;
  codeModeTotal: number;
}) {
  // Three numbers grouped tightly on the left so they read as ONE
  // story (endpoints → servers → tokens), not three independent stats
  // spread across the slide. Visually closer = brain reads them as
  // related, which is the whole point of this row.
  const items = [
    {
      value: "2,594",
      label: "API endpoints",
      color: "var(--color-cf-text)",
    },
    {
      value: "15",
      label: "MCP servers",
      color: "var(--color-cf-text)",
    },
    {
      value: codeModeTotal.toLocaleString(),
      label: "tokens · Code Mode",
      color: "var(--color-cf-orange)",
      strike: true,
      strikeFrom: mcpTotal.toLocaleString(),
    },
  ];

  return (
    <div className="flex flex-wrap items-end gap-x-[clamp(28px,3vw,72px)] gap-y-3">
      {items.map((it, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.5,
            ease: easeEntrance,
            delay: 0.08 + i * 0.1,
          }}
          className="flex flex-col items-start gap-1"
        >
          <div className="flex items-baseline gap-3">
            {it.strike && (
              <span
                className="font-mono text-cf-text-subtle line-through"
                style={{ fontSize: "clamp(16px, 1.3vw, 30px)" }}
                aria-hidden="true"
              >
                {it.strikeFrom}
              </span>
            )}
            <span
              className="font-medium leading-[0.92] tracking-[-0.04em]"
              style={{
                color: it.color,
                fontSize: "clamp(44px, 5.2vw, 124px)",
              }}
            >
              {it.value}
            </span>
          </div>
          <span
            className="font-mono uppercase tracking-[0.14em] text-cf-text-muted"
            style={{ fontSize: "clamp(10px, 0.8vw, 15px)" }}
          >
            {it.label}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

// ─── Server pill ─────────────────────────────────────────────────────

/**
 * Pill-shaped server tile: icon (left) + label (right), plenty of
 * padding so the icon and text breathe at projection size. Replaces
 * the old tiny circle+caption pattern that QA flagged as unreadable.
 */
function ServerPill({
  node,
  index,
  phase,
  reduce,
}: {
  node: NodePos;
  index: number;
  phase: number;
  reduce: boolean;
}) {
  const icon = SERVER_ICONS[node.server.id];
  // Servers fade out in phase 2 — Code Mode replaces them with `code()`.
  const visible = phase < 2;
  const x = node.x - PILL_W / 2;
  const y = node.y - PILL_H / 2;

  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{
        opacity: visible ? 1 : 0,
        scale: visible ? 1 : 0.92,
      }}
      transition={{
        duration: reduce ? 0 : 0.45,
        ease: easeEntrance,
        delay: reduce ? 0 : 0.08 * index,
      }}
    >
      <foreignObject x={x} y={y} width={PILL_W} height={PILL_H}>
        <div
          className="flex h-full w-full items-center gap-3 rounded-full border px-4"
          style={{
            background: "var(--color-cf-bg-100)",
            borderColor: "var(--color-cf-border)",
            boxShadow: "0 1px 0 rgba(82,16,0,0.04)",
          }}
        >
          <span
            className="flex shrink-0 items-center justify-center rounded-full"
            style={{
              width: 32,
              height: 32,
              background: "var(--color-cf-orange-light)",
              color: "var(--color-cf-orange)",
            }}
          >
            {icon?.kind === "logo" ? (
              <img
                src={icon.src}
                alt=""
                className="h-[60%] w-[60%] object-contain"
                draggable={false}
              />
            ) : icon?.kind === "lucide" ? (
              <icon.Icon size={18} strokeWidth={1.75} />
            ) : (
              <Cloud size={18} strokeWidth={1.75} />
            )}
          </span>
          <span
            className="font-medium tracking-[-0.005em] text-cf-text"
            style={{
              fontSize: "clamp(11px, 0.95vw, 14px)",
              lineHeight: 1.1,
            }}
          >
            {node.server.label}
          </span>
        </div>
      </foreignObject>
    </motion.g>
  );
}

// ─── Agent node ──────────────────────────────────────────────────────

function AgentNode({ phase, reduce }: { phase: number; reduce: boolean }) {
  // The agent now reads as a mini chat-app UI (twin of the slide-04
  // ChatGPT mock) instead of a plain Cloudflare cloud icon, so the
  // narrative carries: same agent we just met on slide 04, now drowning
  // in MCP context. Phase 1 adds a subtle "drowning" pulse around the
  // app frame.
  const W = 240;
  const H = 168;
  const pulsing = phase === 1 && !reduce;
  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: easeEntrance }}
    >
      {/* Soft halo behind the app — pulses in phase 1 to hint stress */}
      <motion.rect
        x={AGENT_X - W / 2 - 16}
        y={AGENT_Y - H / 2 - 16}
        width={W + 32}
        height={H + 32}
        rx={20}
        fill="var(--color-cf-orange-light)"
        animate={
          pulsing
            ? { opacity: [0.45, 0.75, 0.45] }
            : { opacity: 0.45 }
        }
        transition={
          pulsing
            ? { duration: 1.6, ease: easeButton, repeat: Infinity }
            : undefined
        }
      />
      {/* Main app card */}
      <foreignObject
        x={AGENT_X - W / 2}
        y={AGENT_Y - H / 2}
        width={W}
        height={H}
      >
        <div
          className="flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-cf-bg-100"
          style={{
            borderColor: "var(--color-cf-orange)",
            boxShadow: "0 18px 38px -22px rgba(255,72,1,0.4)",
          }}
        >
          {/* Title bar */}
          <div
            className="flex shrink-0 items-center gap-1.5 border-b px-3 py-2"
            style={{
              background: "var(--color-cf-orange)",
              borderColor: "var(--color-cf-orange)",
            }}
          >
            <span className="block h-1.5 w-1.5 rounded-full bg-white/80" />
            <span className="block h-1.5 w-1.5 rounded-full bg-white/80" />
            <span className="block h-1.5 w-1.5 rounded-full bg-white/80" />
            <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white/90">
              agent.app
            </span>
          </div>
          {/* Body — "user prompt" + "thinking" lines */}
          <div className="flex flex-1 flex-col gap-1.5 px-3 py-3">
            <div className="flex justify-end">
              <div
                className="rounded-lg rounded-br-sm px-2 py-1 text-[10px] leading-tight text-cf-text"
                style={{
                  background: "var(--color-cf-bg-200)",
                  border: "1px solid var(--color-cf-border)",
                  maxWidth: "85%",
                }}
              >
                Build me a feature.
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <div
                className="h-[5px] rounded-full"
                style={{
                  width: "90%",
                  background: "color-mix(in srgb, var(--color-cf-orange) 30%, var(--color-cf-bg-200))",
                }}
              />
              <div
                className="h-[5px] rounded-full"
                style={{
                  width: "70%",
                  background: "color-mix(in srgb, var(--color-cf-orange) 22%, var(--color-cf-bg-200))",
                }}
              />
              <div
                className="h-[5px] rounded-full"
                style={{
                  width: "55%",
                  background: "color-mix(in srgb, var(--color-cf-orange) 18%, var(--color-cf-bg-200))",
                }}
              />
            </div>
          </div>
        </div>
      </foreignObject>
      {/* Label */}
      <foreignObject
        x={AGENT_X - 110}
        y={AGENT_Y + H / 2 + 16}
        width={220}
        height={28}
      >
        <div className="flex w-full items-center justify-center font-mono text-[12px] uppercase tracking-[0.18em] text-cf-orange">
          The agent
        </div>
      </foreignObject>
    </motion.g>
  );
}

// ─── Flask — the liquid container ────────────────────────────────────

function Flask({ phase, reduce }: { phase: number; reduce: boolean }) {
  // Liquid level as a fraction of the flask's interior height. Phase 0
  // = empty, phase 1 = right at the brim (overflowing), phase 2 = a
  // bare sip (1069 / 51200 ≈ 2%).
  const targetFill = useMemo(() => {
    if (phase === 0) return 0;
    if (phase === 1) return 1;
    return CODE_MODE_TOKENS / totalTokens(MCP_SERVERS);
  }, [phase]);

  const fillMv = useMotionValue(0);
  const overflowMv = useMotionValue(0); // 0..1 — drives the meniscus glow

  useEffect(() => {
    if (reduce) {
      fillMv.set(targetFill);
      overflowMv.set(phase === 1 ? 1 : 0);
      return;
    }
    // Phase 1: dramatic 0.8s base + per-server overlap → ~1.6s total.
    // Phase 2: 2s drain.
    const duration =
      phase === 1
        ? 0.8 + (MCP_SERVERS.length - 1) * 0.1
        : phase === 2
          ? 2.0
          : 0.6;
    const ease = phase === 2 ? easeButton : easeEntrance;
    const ctrl = motionAnimate(fillMv, targetFill, {
      duration,
      ease: [...ease],
    });
    const overflowCtrl = motionAnimate(overflowMv, phase === 1 ? 1 : 0, {
      duration: 0.6,
      ease: [...easeEntrance],
      delay: phase === 1 ? duration * 0.7 : 0,
    });
    return () => {
      ctrl.stop();
      overflowCtrl.stop();
    };
  }, [phase, targetFill, fillMv, overflowMv, reduce]);

  // The fillable interior runs from FLASK_NECK_TOP_Y (full) to
  // FLASK_BOTTOM_Y (empty). At fill=1, surface sits at the rim; at
  // fill=0, surface sits at the base.
  const innerTop = FLASK_NECK_TOP_Y;
  const innerBottom = FLASK_BOTTOM_Y;
  const innerHeight = innerBottom - innerTop;
  const surfaceY = useTransform(fillMv, (f) => {
    const clamped = Math.max(0, Math.min(1, f));
    return innerBottom - clamped * innerHeight;
  });

  // Two stacked wave-strip paths, 180° out of phase, at slightly
  // different speeds so the surface looks alive without ever showing
  // a seam (each strip slides exactly one period over its own loop).
  const waveAPath = useMemo(() => waveStripPath(0), []);
  const waveBPath = useMemo(() => waveStripPath(Math.PI), []);

  // Hide the wave when the liquid is essentially empty (avoids tiny
  // wave artefacts dancing on a pretend-empty flask).
  const waveOpacity = useTransform(fillMv, (f) => (f < 0.015 ? 0 : 1));

  return (
    <g>
      {/* Glass body fill — a barely-there gradient inside the flask. */}
      <path
        d={flaskOutlinePath()}
        fill="url(#flask-glass)"
      />

      {/* Liquid — clipped to the flask interior. Two wave layers slosh
          at different speeds; the inner group translates vertically to
          set the surface height. */}
      <g clipPath="url(#flask-clip)">
        <motion.g style={{ y: surfaceY }}>
          {/* Back wave (deeper, slower, slight phase offset) */}
          <motion.g
            style={{ opacity: waveOpacity }}
            animate={
              reduce
                ? undefined
                : { x: [0, -WAVE_PERIOD] }
            }
            transition={
              reduce
                ? undefined
                : {
                    duration: WAVE_LOOP_S * 1.3,
                    ease: "linear",
                    repeat: Infinity,
                  }
            }
          >
            <path d={waveBPath} fill="url(#flask-liquid-back)" />
          </motion.g>
          {/* Front wave (lighter, faster) */}
          <motion.g
            style={{ opacity: waveOpacity }}
            animate={reduce ? undefined : { x: [0, -WAVE_PERIOD] }}
            transition={
              reduce
                ? undefined
                : {
                    duration: WAVE_LOOP_S,
                    ease: "linear",
                    repeat: Infinity,
                  }
            }
          >
            <path d={waveAPath} fill="url(#flask-liquid)" />
            {/* Meniscus highlight — a thin warm-white stroke along the
                wave crest sells the "real liquid surface" feel. */}
            <path
              d={waveAPath}
              fill="none"
              stroke="rgba(255, 251, 245, 0.6)"
              strokeWidth={1.25}
            />
          </motion.g>
        </motion.g>
      </g>

      {/* (Removed the red overflow ellipse — the rising liquid level
          itself communicates "full" without needing a separate halo,
          and the user found the red mark redundant.) */}

      {/* Flask outline — drawn ON TOP of the liquid so the rim & sides
          read as glass. */}
      <path
        d={flaskOutlinePath()}
        fill="none"
        stroke="var(--color-cf-text)"
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* Rim flares — the little outward lips at the mouth that
          telegraph "scientific glassware". */}
      <line
        x1={FLASK_CX - FLASK_NECK_HALF_W - 12}
        y1={FLASK_NECK_TOP_Y}
        x2={FLASK_CX - FLASK_NECK_HALF_W}
        y2={FLASK_NECK_TOP_Y}
        stroke="var(--color-cf-text)"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <line
        x1={FLASK_CX + FLASK_NECK_HALF_W}
        y1={FLASK_NECK_TOP_Y}
        x2={FLASK_CX + FLASK_NECK_HALF_W + 12}
        y2={FLASK_NECK_TOP_Y}
        stroke="var(--color-cf-text)"
        strokeWidth={2.5}
        strokeLinecap="round"
      />

      {/* Tick marks on the cone wall — every 25% of capacity. We draw
          them on the right edge of the cone where the cone is widest
          enough for them to read. */}
      {[0.25, 0.5, 0.75].map((t) => {
        // Linearly interpolate the cone's right edge between
        // (NECK_BASE, neckRight) and (BOTTOM, baseRight - r).
        const yShoulder = FLASK_NECK_BASE_Y;
        const yBase = FLASK_BOTTOM_Y;
        // t is fraction of the FILLABLE height counted from the base.
        const y = yBase - t * (yBase - FLASK_NECK_TOP_Y);
        // Approximate the cone half-width at y (linear between neck
        // shoulder and base).
        const tCone = Math.min(
          1,
          Math.max(0, (yBase - y) / (yBase - yShoulder)),
        );
        const halfW =
          FLASK_BASE_HALF_W -
          tCone * (FLASK_BASE_HALF_W - FLASK_NECK_HALF_W);
        const x1 = FLASK_CX + halfW - 14;
        const x2 = FLASK_CX + halfW - 4;
        return (
          <line
            key={t}
            x1={x1}
            y1={y}
            x2={x2}
            y2={y}
            stroke="var(--color-cf-text-subtle)"
            strokeWidth={1}
          />
        );
      })}

      {/* Flask label */}
      <foreignObject
        x={FLASK_BBOX_X - 60}
        y={FLASK_BOTTOM_Y + 14}
        width={FLASK_BBOX_W + 120}
        height={28}
      >
        <div className="flex w-full items-center justify-center font-mono text-[11px] uppercase tracking-[0.18em] text-cf-text-muted">
          Context window
        </div>
      </foreignObject>
    </g>
  );
}

// ─── Schema cards (phase 1) ──────────────────────────────────────────

function SchemaCards({ reduce }: { reduce: boolean }) {
  // Bumped from 150×26 → 220×42 so the server names + token counts are
  // legible at projection distance (the user explicitly flagged this).
  const cardW = 220;
  const cardH = 42;
  const startX = AGENT_X + 80;
  const startY = AGENT_Y - 80;
  const targetX = FLASK_CX - cardW / 2;
  return (
    <g>
      {MCP_SERVERS.map((server, i) => {
        // Pile bottom-up inside the flask cone — taller cards mean
        // fewer fit before they go above the rim, which is fine; the
        // first 5–6 piling up reads as "stack of context overhead".
        const targetY = FLASK_BOTTOM_Y - cardH - 18 - i * (cardH + 6);
        return (
          <motion.g
            key={server.id}
            initial={{ opacity: 0, x: startX, y: startY, rotate: -8 }}
            animate={{
              opacity: 1,
              x: targetX,
              y: targetY,
              rotate: 0,
            }}
            transition={{
              duration: reduce ? 0 : 0.8,
              ease: easeEntrance,
              delay: reduce ? 0 : i * 0.1,
            }}
          >
            <rect
              x={0}
              y={0}
              width={cardW}
              height={cardH}
              rx={8}
              fill="var(--color-cf-bg-200)"
              stroke="var(--color-cf-orange)"
              strokeWidth={1.25}
            />
            <foreignObject x={0} y={0} width={cardW} height={cardH}>
              <div className="flex h-full w-full items-center justify-between px-3 font-mono text-[15px] tracking-[0.02em] text-cf-text">
                <span className="truncate font-medium">{server.label}</span>
                <span className="text-cf-orange">
                  {server.tokens.toLocaleString()}
                </span>
              </div>
            </foreignObject>
          </motion.g>
        );
      })}
    </g>
  );
}

// ─── Code Mode card (phase 2) ────────────────────────────────────────

function CodeCard({ reduce }: { reduce: boolean }) {
  const cardW = 180;
  const cardH = 36;
  const x = FLASK_CX - cardW / 2;
  const y = FLASK_BOTTOM_Y - cardH - 18;
  return (
    <motion.g
      initial={{ opacity: 0, y: y + 24 }}
      animate={{ opacity: 1, y }}
      transition={{
        duration: reduce ? 0 : 0.6,
        ease: easeEntrance,
        delay: reduce ? 0 : 0.6,
      }}
    >
      <rect
        x={x}
        y={0}
        width={cardW}
        height={cardH}
        rx={6}
        fill="var(--color-cf-bg-200)"
        stroke="var(--color-cf-orange)"
        strokeWidth={1.5}
      />
      <foreignObject x={x} y={0} width={cardW} height={cardH}>
        <div className="flex h-full w-full items-center justify-between px-3 font-mono text-[12px] tracking-[0.04em] text-cf-text">
          <span>1 tool:</span>
          <span className="font-medium text-cf-orange">code()</span>
        </div>
      </foreignObject>
    </motion.g>
  );
}

// ─── Token counter ───────────────────────────────────────────────────

function TokenCounter({
  phase,
  mcpTotal,
  codeModeTotal,
  reduce,
}: {
  phase: number;
  mcpTotal: number;
  codeModeTotal: number;
  reduce: boolean;
}) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const target = phase === 0 ? 0 : phase === 1 ? mcpTotal : codeModeTotal;
    if (reduce) {
      setDisplay(target);
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    const duration = phase === 1 ? 1.6 : phase === 2 ? 2.0 : 0.4;
    const start = performance.now();
    let raf = 0;
    function tick(now: number) {
      const t = Math.min((now - start) / 1000 / duration, 1);
      const eased =
        phase === 2
          ? (t * t) / (t * t + (1 - t) * (1 - t))
          : 1 - Math.pow(1 - t, 3);
      const v = from + (target - from) * eased;
      setDisplay(v);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, mcpTotal, codeModeTotal, reduce]);

  const value = Math.round(display).toLocaleString();
  const colour =
    phase === 1
      ? "var(--color-cf-error)"
      : phase === 2
        ? "var(--color-cf-success)"
        : "var(--color-cf-text-muted)";

  // Counter sits BELOW the flask label so it never collides with the
  // headline numbers row. We park it underneath the "Context window"
  // caption.
  const x = FLASK_BBOX_X - 80;
  const y = FLASK_BOTTOM_Y + 44;
  const w = FLASK_BBOX_W + 160;
  const h = 64;
  return (
    <foreignObject x={x} y={y} width={w} height={h} data-testid="token-counter">
      <div className="pointer-events-none flex h-full w-full flex-col items-center justify-center gap-1">
        <span
          className="font-mono font-medium leading-none tracking-[-0.02em] tabular-nums"
          style={{ color: colour, fontSize: "44px" }}
        >
          {value}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-cf-text-muted">
          tokens in context
        </span>
      </div>
    </foreignObject>
  );
}

// ─── Banner positioning helpers ──────────────────────────────────────
//
// HTML banners are absolutely positioned over the SVG container. We
// translate flask-coordinate anchors (in viewBox units) into percent
// offsets that match how `preserveAspectRatio="xMidYMid meet"` places
// the viewBox in the responsive container.

const FLASK_CX_PCT = (FLASK_CX / VIEW_W) * 100;          // ≈ 86%
const FLASK_TOP_PCT = (FLASK_TOP_Y / VIEW_H) * 100;      // ≈ 11%

// ─── CONTEXT EXPLOSION banner (phase 1) ─────────────────────────────

function ExplosionBanner({
  visible,
  reduce,
}: {
  visible: boolean;
  reduce: boolean;
}) {
  return (
    <motion.div
      className="pointer-events-none absolute z-20"
      style={{
        left: `${FLASK_CX_PCT}%`,
        // Sit JUST ABOVE the flask mouth — the banner's bottom edge
        // hovers a hair north of the meniscus.
        top: `${FLASK_TOP_PCT}%`,
        transform: "translate(-50%, -100%)",
      }}
      initial={false}
      animate={{
        opacity: visible ? 1 : 0,
        y: visible ? -8 : 4,
        scale: visible ? 1 : 0.94,
      }}
      transition={{ duration: reduce ? 0 : 0.45, ease: easeEntrance }}
      aria-hidden={!visible}
    >
      {/* Soft halo behind the banner — anchors it as an "alert" cluster. */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 blur-2xl"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in srgb, var(--color-cf-error) 22%, transparent), transparent 80%)",
          transform: "scale(1.6)",
        }}
        aria-hidden="true"
      />
      <CornerBrackets>
        <motion.div
          className="flex items-center gap-2.5 border px-5 py-2 font-mono font-medium uppercase tracking-[0.16em]"
          style={{
            color: "var(--color-cf-error)",
            background:
              "color-mix(in srgb, var(--color-cf-error) 10%, var(--color-cf-bg-100))",
            borderColor:
              "color-mix(in srgb, var(--color-cf-error) 32%, transparent)",
            fontSize: "clamp(11px, 0.95vw, 14px)",
          }}
          animate={
            visible && !reduce ? { opacity: [0.85, 1, 0.85] } : {}
          }
          transition={
            visible && !reduce
              ? { duration: 1.5, ease: easeButton, repeat: Infinity }
              : undefined
          }
        >
          <AlertTriangle size={14} strokeWidth={2} />
          <span>Context explosion</span>
          <ArrowUp size={14} strokeWidth={2} aria-hidden="true" />
        </motion.div>
      </CornerBrackets>
    </motion.div>
  );
}

// ─── −98% savings badge (phase 2) ───────────────────────────────────

function SavingsBadge({
  visible,
  pct,
  reduce,
}: {
  visible: boolean;
  pct: number;
  reduce: boolean;
}) {
  // Phase-2 payoff: a BIG centred callout that takes the empty agent
  // half of the slide and reads as "this is what just happened". Sits
  // far above the flask's token counter so the two no longer collide.
  return (
    <motion.div
      className="pointer-events-none absolute z-20"
      style={{
        // Sit ABOVE the flask, same axis as the phase-1 explosion banner
        // so the visual story stays consistent. Anchor the RIGHT edge of
        // the badge to the flask centre so the badge can never run off
        // the slide.
        right: `calc(${100 - FLASK_CX_PCT}% - 80px)`,
        top: `${FLASK_TOP_PCT}%`,
        transform: "translate(0, -100%)",
      }}
      initial={false}
      animate={{
        opacity: visible ? 1 : 0,
        y: visible ? 0 : 8,
        scale: visible ? 1 : 0.94,
      }}
      transition={{
        duration: reduce ? 0 : 0.5,
        ease: easeEntrance,
        delay: reduce ? 0 : 0.4,
      }}
      aria-hidden={!visible}
    >
      <div className="flex flex-col items-end gap-2">
        {/* Soft success halo behind the badge. */}
        <div className="relative">
          <div
            className="pointer-events-none absolute inset-0 -z-10 blur-2xl"
            style={{
              background:
                "radial-gradient(closest-side, color-mix(in srgb, var(--color-cf-success) 28%, transparent), transparent 80%)",
              transform: "scale(1.7)",
            }}
            aria-hidden="true"
          />
          <CornerBrackets>
            <div
              className="flex items-center gap-2.5 whitespace-nowrap border px-5 py-2.5 font-mono font-medium uppercase tracking-[0.16em]"
              style={{
                color: "var(--color-cf-success)",
                background: "var(--color-cf-success-bg)",
                borderColor:
                  "color-mix(in srgb, var(--color-cf-success) 36%, transparent)",
                fontSize: "clamp(15px, 1.4vw, 24px)",
              }}
            >
              <ArrowDown size={18} strokeWidth={2.2} />
              <span>−{pct}% tokens</span>
            </div>
          </CornerBrackets>
        </div>
        <span className="whitespace-nowrap font-mono text-[clamp(10px,0.8vw,13px)] uppercase tracking-[0.18em] text-cf-text-muted">
          one tool · one round-trip
        </span>
      </div>
    </motion.div>
  );
}

