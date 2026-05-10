import { motion, useReducedMotion } from "framer-motion";
import type { SlideDef } from "@/framework/viewer/types";
import { easeEntrance, easeButton } from "../lib/motion";
import {
  DIAGRAM_PHASES,
  DIAGRAM_STEPS,
  computeStepTiming,
  isStepVisible,
  reducedMotionTiming,
  stepsRevealedAt,
  type DiagramStep,
} from "./_diagram-logic";

/**
 * Slide 11 — Animated "How Code Mode works" diagram.
 *
 * Recreation of the diagram from blog.cloudflare.com/code-mode/. Two
 * stacked rows:
 *
 *   ── Traditional MCP (4 steps) ───────────────────────────────────
 *      [ LLM ]  ↔  [ Agent ]  ↔  [ MCP server ]
 *
 *   ── Code Mode (6 steps) ─────────────────────────────────────────
 *      [ LLM ]  ↔  [ Agent ]  ↔  [ Sandbox 🔑 ]  ↔  [ MCP server ]
 *
 * Phases (0..6) are described in `_diagram-logic.ts`. The pure logic
 * (visibility per phase, animation timing per step) lives there and is
 * unit-tested. This module is the visual shell — SVG paths drawn with
 * `pathLength`, plus pop-in badges and HTML labels via foreignObject.
 *
 * Layout coordinates use a fixed 1200×680 SVG viewBox so that the
 * diagram scales smoothly to whatever projector / browser size the
 * deck is run at. The container caps the maximum width so the diagram
 * doesn't get gigantic on a 4K monitor at the booth.
 *
 * Reduced motion: when `prefers-reduced-motion: reduce` is set we snap
 * directly to the end-state (paths fully drawn, badges fully visible)
 * with no `pathLength` animation, no scale pop, no key bobble.
 */

// ─── Coordinate system ────────────────────────────────────────────────
// Compressed vertically (was 740) so the diagram sits in the upper-
// middle of the available slide height instead of bottoming out.
const VIEW_W = 1200;
const VIEW_H = 680;

// Top row — 3 nodes (LLM, Agent, MCP). Pulled up slightly from 150.
const TOP_Y = 130;
const TOP_LLM_X = 200;
const TOP_AGENT_X = 600;
const TOP_MCP_X = 1000;

// Bottom row — 4 nodes (LLM, Agent, Sandbox, MCP). Was y=540 — moved
// up to 470 so the long arcs above/below have room to clear the
// Sandbox node, labels fit inside the (smaller) viewBox, and the
// slide doesn't feel bottom-heavy.
const BOT_Y = 470;
const BOT_LLM_X = 120;
const BOT_AGENT_X = 420;
const BOT_SANDBOX_X = 720;
const BOT_MCP_X = 1020;

// Each node is rendered as a roughly 120×120 visual; the arrows
// terminate `NODE_INSET` away from the center so they don't crash
// into the icon.
const NODE_INSET = 70;

// ─── Geometry helpers ─────────────────────────────────────────────────

interface Point {
  x: number;
  y: number;
}

/**
 * Quadratic-Bezier path from `from` to `to` along a horizontal axis.
 *
 * - `curve` is the vertical peak offset of the arc (negative = arcs
 *   upward, positive = arcs downward).
 * - `laneOffset` perpendicular-nudges the *endpoints* (positive =
 *   lower lane). This is how we keep the forward and return arrows of
 *   a bidirectional pair from kissing the same node-edge point and
 *   reading as overlapping. The forward arc gets, say, `-10` and the
 *   return arc gets `+10`; together with opposite `curve` signs the
 *   two arcs occupy clearly separate lanes.
 */
function arcPath(from: Point, to: Point, curve: number, laneOffset = 0): string {
  const dir = Math.sign(to.x - from.x) || 1;
  const x1 = from.x + dir * NODE_INSET;
  const x2 = to.x - dir * NODE_INSET;
  const y1 = from.y + laneOffset;
  const y2 = to.y + laneOffset;
  const cx = (x1 + x2) / 2;
  const cy = from.y + curve;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

/** Midpoint (t=0.5) of a quadratic bezier with control (cx, peakY). */
function arcMidpoint(from: Point, to: Point, curve: number, laneOffset = 0): Point {
  const dir = Math.sign(to.x - from.x) || 1;
  const x1 = from.x + dir * NODE_INSET;
  const x2 = to.x - dir * NODE_INSET;
  const y1 = from.y + laneOffset;
  const y2 = to.y + laneOffset;
  const cx = (x1 + x2) / 2;
  const cy = from.y + curve;
  // Quadratic Bezier midpoint at t=0.5
  return {
    x: 0.25 * x1 + 0.5 * cx + 0.25 * x2,
    y: 0.25 * y1 + 0.5 * cy + 0.25 * y2,
  };
}

// ─── Per-step geometry table ──────────────────────────────────────────
// Authoritative source of truth for "where does each arrow go?".
// Order matches DIAGRAM_STEPS exactly.

interface StepGeometry {
  from: Point;
  to: Point;
  /** Vertical curve offset. Negative = arc upward. */
  curve: number;
  /**
   * Perpendicular endpoint offset (in SVG units, positive = lower).
   * Used to push paired forward/return arrows into distinct lanes so
   * they don't kiss at the node edges and read as one merged stroke.
   */
  laneOffset: number;
  /** Where the label box anchors relative to the arrow midpoint. */
  labelAnchor: "above" | "below";
}

// Endpoint lane separation. Together with opposite `curve` signs this
// gives every bidirectional pair two clearly distinct arcs.
//
// The bottom-row Agent has FOUR arrows arriving/leaving on its right
// side — bot-1 (long arc from MCP, up), bot-4 (Agent→Sandbox, up),
// bot-5 (Sandbox→Agent, down), bot-6 (Agent→MCP, long down). With a
// single LANE value the long and short pairs would land on the same
// node-edge points and read as merged strokes. We split into two
// lanes: short pairs use `LANE_SHORT`, the long over-/under-Sandbox
// arcs use `LANE_LONG` (a wider offset), giving 4 distinct lanes on
// the Agent's right edge.
const LANE_SHORT = 12;
const LANE_LONG = 32;

const STEP_GEOMETRY: Record<string, StepGeometry> = {
  // ── Top row — Traditional MCP ─────────────────────────────────────
  // Pair 1: top-1 (MCP→Agent, arc up)  vs  top-4 (Agent→MCP, arc down)
  // Pair 2: top-2 (Agent→LLM, arc up) vs  top-3 (LLM→Agent, arc down)
  "top-1": {
    from: { x: TOP_MCP_X, y: TOP_Y },
    to: { x: TOP_AGENT_X, y: TOP_Y },
    curve: -85,
    laneOffset: -LANE_SHORT,
    labelAnchor: "above",
  },
  "top-2": {
    from: { x: TOP_AGENT_X, y: TOP_Y },
    to: { x: TOP_LLM_X, y: TOP_Y },
    curve: -85,
    laneOffset: -LANE_SHORT,
    labelAnchor: "above",
  },
  "top-3": {
    from: { x: TOP_LLM_X, y: TOP_Y },
    to: { x: TOP_AGENT_X, y: TOP_Y },
    curve: 85,
    laneOffset: LANE_SHORT,
    labelAnchor: "below",
  },
  "top-4": {
    from: { x: TOP_AGENT_X, y: TOP_Y },
    to: { x: TOP_MCP_X, y: TOP_Y },
    curve: 85,
    laneOffset: LANE_SHORT,
    labelAnchor: "below",
  },
  // ── Bottom row — Code Mode ────────────────────────────────────────
  // Four arrows touch the Agent's right edge — they need four distinct
  // lanes. From topmost to bottommost on that edge:
  //   bot-1 (MCP→Agent, long up, peak well above Sandbox) — far-up lane
  //   bot-4 (Agent→Sandbox, short up)                     — near-up lane
  //   bot-5 (Sandbox→Agent, short down)                   — near-down lane
  //   bot-6 (Agent→MCP,   long down, valley well below)   — far-down lane
  "bot-1": {
    // MCP → Agent (long arc, soaring over Sandbox)
    from: { x: BOT_MCP_X, y: BOT_Y },
    to: { x: BOT_AGENT_X, y: BOT_Y },
    curve: -190,
    laneOffset: -LANE_LONG,
    labelAnchor: "above",
  },
  "bot-2": {
    from: { x: BOT_AGENT_X, y: BOT_Y },
    to: { x: BOT_LLM_X, y: BOT_Y },
    curve: -85,
    laneOffset: -LANE_SHORT,
    labelAnchor: "above",
  },
  "bot-3": {
    from: { x: BOT_LLM_X, y: BOT_Y },
    to: { x: BOT_AGENT_X, y: BOT_Y },
    curve: 85,
    laneOffset: LANE_SHORT,
    labelAnchor: "below",
  },
  "bot-4": {
    from: { x: BOT_AGENT_X, y: BOT_Y },
    to: { x: BOT_SANDBOX_X, y: BOT_Y },
    curve: -90,
    laneOffset: -LANE_SHORT,
    labelAnchor: "above",
  },
  "bot-5": {
    from: { x: BOT_SANDBOX_X, y: BOT_Y },
    to: { x: BOT_AGENT_X, y: BOT_Y },
    curve: 90,
    laneOffset: LANE_SHORT,
    labelAnchor: "below",
  },
  "bot-6": {
    // Agent → MCP (long arc, plunging under Sandbox)
    from: { x: BOT_AGENT_X, y: BOT_Y },
    to: { x: BOT_MCP_X, y: BOT_Y },
    curve: 190,
    laneOffset: LANE_LONG,
    labelAnchor: "below",
  },
};

function geometryFor(step: DiagramStep): StepGeometry {
  const key = `${step.row === "top" ? "top" : "bot"}-${step.step}`;
  return STEP_GEOMETRY[key];
}

// ─── Node visuals ─────────────────────────────────────────────────────
// Each node is rendered inside a foreignObject so we can use HTML/CSS
// for the icon styling without re-deriving every visual in raw SVG.

const COLOR_LLM = "var(--color-cf-info)"; // #2563EB
const COLOR_MCP = "var(--color-cf-compute)"; // #0A95FF
const COLOR_AGENT = "var(--color-cf-orange)";
const COLOR_SANDBOX_BASE = "#E5B07A";
const COLOR_SANDBOX_DARK = "#B97E40";
const COLOR_SANDBOX_FLAG = "var(--color-cf-orange)";
const COLOR_KEY = "#D9A441"; // brass

function NodeBox({
  cx,
  cy,
  title,
  subtitle,
  children,
}: {
  cx: number;
  cy: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const W = 160;
  const H = 160;
  return (
    <foreignObject x={cx - W / 2} y={cy - H / 2} width={W} height={H}>
      <div
        // foreignObject demands an xmlns on inner HTML for some renderers
        // (notably older Safari) — set it explicitly.
        // @ts-expect-error xmlns on html div is valid in foreignObject
        xmlns="http://www.w3.org/1999/xhtml"
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          color: "var(--color-cf-text)",
          fontFamily: "var(--font-sans)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 92,
            height: 92,
          }}
        >
          {children}
        </div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 500,
            letterSpacing: "-0.01em",
            textAlign: "center",
            lineHeight: 1.1,
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "var(--color-cf-text-muted)",
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
    </foreignObject>
  );
}

function LLMIcon() {
  // A "cloud-style brain" — rounded gear-ish shape in CF info blue.
  return (
    <svg viewBox="0 0 64 64" width={72} height={72} aria-hidden>
      <defs>
        <linearGradient id="llmGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--color-cf-info)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--color-cf-compute)" stopOpacity="1" />
        </linearGradient>
      </defs>
      {/* Soft halo */}
      <circle cx="32" cy="32" r="30" fill="url(#llmGrad)" opacity="0.12" />
      {/* Main brain shape — two lobes */}
      <path
        d="M22 18c-5 0-9 4-9 9 0 2 1 4 2 5-1 1-2 3-2 5 0 4 3 8 8 9 1 3 4 5 7 5 1 0 2 0 3-1 1 1 2 1 3 1 3 0 6-2 7-5 5-1 8-5 8-9 0-2-1-4-2-5 1-1 2-3 2-5 0-5-4-9-9-9-2 0-4 1-5 2-1-1-2-2-4-2-1 0-2 1-3 1-1 0-2-1-3-1-2 0-3 1-4 2-1-1-3-2-5-2z"
        fill={COLOR_LLM}
      />
      {/* Sulci lines — subtle highlights */}
      <path
        d="M22 28c2 0 4 2 4 4M30 22v8M30 38v6M38 22v8M38 38v6M42 28c-2 0-4 2-4 4"
        fill="none"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AgentIcon() {
  // A browser/worker chrome card with the brand orange.
  return (
    <svg viewBox="0 0 80 64" width={88} height={70} aria-hidden>
      <rect
        x="2"
        y="2"
        width="76"
        height="60"
        rx="8"
        fill="var(--color-cf-bg-100)"
        stroke={COLOR_AGENT}
        strokeWidth="2.5"
      />
      <rect
        x="2"
        y="2"
        width="76"
        height="14"
        rx="8"
        fill={COLOR_AGENT}
        opacity="0.92"
      />
      <circle cx="9" cy="9" r="1.6" fill="var(--color-cf-bg-100)" />
      <circle cx="14.5" cy="9" r="1.6" fill="var(--color-cf-bg-100)" />
      <circle cx="20" cy="9" r="1.6" fill="var(--color-cf-bg-100)" />
      {/* Code lines inside the body */}
      <rect x="10" y="24" width="40" height="3" rx="1.5" fill={COLOR_AGENT} opacity="0.85" />
      <rect x="10" y="32" width="56" height="3" rx="1.5" fill="var(--color-cf-text-muted)" opacity="0.6" />
      <rect x="10" y="40" width="32" height="3" rx="1.5" fill="var(--color-cf-text-muted)" opacity="0.5" />
      <rect x="10" y="48" width="48" height="3" rx="1.5" fill="var(--color-cf-text-muted)" opacity="0.4" />
    </svg>
  );
}

function MCPServerIcon() {
  // Three stacked server units in CF compute blue.
  return (
    <svg viewBox="0 0 72 78" width={72} height={78} aria-hidden>
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(0,${i * 26})`}>
          <rect
            x="4"
            y="2"
            width="64"
            height="22"
            rx="4"
            fill="var(--color-cf-bg-100)"
            stroke={COLOR_MCP}
            strokeWidth="2"
          />
          <circle cx="11" cy="13" r="2" fill={COLOR_MCP} />
          <circle cx="18" cy="13" r="2" fill={COLOR_MCP} opacity="0.5" />
          <rect x="28" y="11" width="34" height="4" rx="1" fill={COLOR_MCP} opacity="0.35" />
        </g>
      ))}
    </svg>
  );
}

/**
 * Sandcastle illustration with a literal physical key on top — the
 * "bindings hide your keys" visual hook. The key bobbles continuously
 * (3-second loop) unless reduced-motion is requested.
 */
function SandcastleIcon({ reduced }: { reduced: boolean }) {
  return (
    <svg viewBox="0 0 96 96" width={96} height={96} aria-hidden>
      {/* Sand base — wide base + textured stippling */}
      <ellipse cx="48" cy="86" rx="42" ry="6" fill={COLOR_SANDBOX_DARK} opacity="0.45" />
      {/* Main castle body */}
      <rect x="18" y="48" width="60" height="36" rx="2" fill={COLOR_SANDBOX_BASE} />
      {/* Crenellations on top */}
      <rect x="18" y="44" width="8" height="6" fill={COLOR_SANDBOX_BASE} />
      <rect x="34" y="44" width="8" height="6" fill={COLOR_SANDBOX_BASE} />
      <rect x="54" y="44" width="8" height="6" fill={COLOR_SANDBOX_BASE} />
      <rect x="70" y="44" width="8" height="6" fill={COLOR_SANDBOX_BASE} />
      {/* Side towers */}
      <rect x="10" y="38" width="14" height="46" rx="2" fill={COLOR_SANDBOX_BASE} />
      <rect x="72" y="38" width="14" height="46" rx="2" fill={COLOR_SANDBOX_BASE} />
      {/* Tower crenellations */}
      <rect x="10" y="34" width="4" height="6" fill={COLOR_SANDBOX_BASE} />
      <rect x="16" y="34" width="4" height="6" fill={COLOR_SANDBOX_BASE} />
      <rect x="20" y="34" width="4" height="6" fill={COLOR_SANDBOX_BASE} />
      <rect x="72" y="34" width="4" height="6" fill={COLOR_SANDBOX_BASE} />
      <rect x="78" y="34" width="4" height="6" fill={COLOR_SANDBOX_BASE} />
      <rect x="82" y="34" width="4" height="6" fill={COLOR_SANDBOX_BASE} />
      {/* Central tower */}
      <rect x="38" y="20" width="20" height="30" fill={COLOR_SANDBOX_BASE} />
      <rect x="38" y="16" width="4" height="6" fill={COLOR_SANDBOX_BASE} />
      <rect x="44" y="16" width="4" height="6" fill={COLOR_SANDBOX_BASE} />
      <rect x="50" y="16" width="4" height="6" fill={COLOR_SANDBOX_BASE} />
      <rect x="54" y="16" width="4" height="6" fill={COLOR_SANDBOX_BASE} />
      {/* Door */}
      <path d="M44 70 v14 h8 v-14 a4 4 0 0 0 -8 0 z" fill={COLOR_SANDBOX_DARK} opacity="0.55" />
      {/* Window */}
      <rect x="46" y="30" width="4" height="6" fill={COLOR_SANDBOX_DARK} opacity="0.45" />
      {/* Shading along base */}
      <rect x="18" y="80" width="60" height="4" fill={COLOR_SANDBOX_DARK} opacity="0.25" />
      {/* Flag pole + flag (static) */}
      <rect x="47.5" y="2" width="1" height="14" fill={COLOR_SANDBOX_DARK} />
      <path d="M48.5 3 L60 6 L48.5 9 z" fill={COLOR_SANDBOX_FLAG} />

      {/* The KEY — the visual hook. Sits on top of the central tower
          and gently bobbles. Render as a small group we can transform. */}
      <motion.g
        animate={
          reduced
            ? undefined
            : {
                y: [0, -3, 0, -1, 0],
                rotate: [-6, 4, -2, 6, -6],
              }
        }
        transition={{
          duration: 3,
          ease: "easeInOut",
          repeat: Infinity,
        }}
        style={{ transformOrigin: "60px 26px", transformBox: "fill-box" } as React.CSSProperties}
      >
        {/* Key bow (round head) */}
        <circle cx="60" cy="14" r="5" fill={COLOR_KEY} stroke={COLOR_SANDBOX_DARK} strokeWidth="1" />
        <circle cx="60" cy="14" r="2" fill={COLOR_SANDBOX_BASE} />
        {/* Key shaft */}
        <rect x="59" y="18" width="2" height="14" fill={COLOR_KEY} stroke={COLOR_SANDBOX_DARK} strokeWidth="0.5" />
        {/* Teeth */}
        <rect x="61" y="26" width="3" height="2" fill={COLOR_KEY} />
        <rect x="61" y="29" width="2" height="2" fill={COLOR_KEY} />
      </motion.g>
    </svg>
  );
}

// ─── Numbered badge ───────────────────────────────────────────────────

function StepBadge({
  cx,
  cy,
  step,
  fill,
  visible,
  delay,
  duration,
  reduced,
}: {
  cx: number;
  cy: number;
  step: number;
  /** Badge fill — should match the arrow / flow-dot colour. */
  fill: string;
  visible: boolean;
  delay: number;
  duration: number;
  reduced: boolean;
}) {
  return (
    <motion.g
      initial={false}
      animate={{
        opacity: visible ? 1 : 0,
        scale: visible ? 1 : 0.4,
      }}
      transition={
        reduced
          ? { duration: 0 }
          : {
              opacity: { duration: 0.18, delay: visible ? delay : 0, ease: easeButton },
              scale: { duration, delay: visible ? delay : 0, ease: easeEntrance },
            }
      }
      style={{ transformOrigin: `${cx}px ${cy}px`, transformBox: "fill-box" } as React.CSSProperties}
    >
      <circle cx={cx} cy={cy} r={16} fill={fill} stroke="var(--color-cf-bg-100)" strokeWidth={3} />
      <text
        x={cx}
        y={cy + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="var(--color-cf-bg-100)"
        fontFamily="var(--font-mono)"
        fontWeight={600}
        fontSize={14}
      >
        {step}
      </text>
    </motion.g>
  );
}

// ─── Step label box (HTML via foreignObject) ──────────────────────────

function StepLabel({
  midpoint,
  anchor,
  label,
  visible,
  delay,
  reduced,
}: {
  midpoint: Point;
  anchor: "above" | "below";
  label: string;
  visible: boolean;
  delay: number;
  reduced: boolean;
}) {
  // Position the label box just past the badge in the anchor direction.
  const W = 200;
  const H = 60;
  const offsetY = anchor === "above" ? -H - 18 : 18;
  return (
    <motion.foreignObject
      x={midpoint.x - W / 2}
      y={midpoint.y + offsetY}
      width={W}
      height={H}
      initial={false}
      animate={{ opacity: visible ? 1 : 0 }}
      transition={
        reduced
          ? { duration: 0 }
          : { duration: 0.25, delay: visible ? delay : 0, ease: easeButton }
      }
    >
      <div
        // @ts-expect-error xmlns on html div is valid in foreignObject
        xmlns="http://www.w3.org/1999/xhtml"
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: anchor === "above" ? "flex-end" : "flex-start",
          justifyContent: "center",
          textAlign: "center",
          fontFamily: "var(--font-sans)",
          fontSize: 12.5,
          lineHeight: 1.3,
          color: "var(--color-cf-text-muted)",
          padding: "2px 6px",
        }}
      >
        <span>{label}</span>
      </div>
    </motion.foreignObject>
  );
}

// ─── Animated arrow (SVG path with pathLength tween) ──────────────────

function StepArrow({
  d,
  pathId,
  color,
  visible,
  delay,
  duration,
  reduced,
  markerId,
}: {
  d: string;
  pathId: string;
  color: string;
  visible: boolean;
  delay: number;
  duration: number;
  reduced: boolean;
  markerId: string;
}) {
  return (
    <motion.path
      id={pathId}
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={2.5}
      strokeLinecap="round"
      markerEnd={`url(#${markerId})`}
      initial={false}
      animate={{
        pathLength: visible ? 1 : 0,
        opacity: visible ? 1 : 0,
      }}
      transition={
        reduced
          ? { duration: 0 }
          : {
              pathLength: { duration, delay: visible ? delay : 0, ease: easeEntrance },
              opacity: { duration: 0.12, delay: visible ? delay : 0 },
            }
      }
    />
  );
}

// ─── Flow dots — packets streaming source → destination ───────────────
//
// Once a step's arrow has finished drawing, we emit a small stream of
// dots that travel along the path on a continuous loop. SMIL
// `<animateMotion>` with an `<mpath>` reference is the simplest way to
// drive this — no per-frame React re-renders, the browser walks the
// path natively, and the animation cleans up automatically when the
// owning DOM node unmounts (no setInterval/setTimeout to clear).
//
// Three dots, each on the same 2.4s loop but staggered 0.8s apart,
// produce the "stream" feel asked for in the brief.

const DOT_COUNT = 3;
const DOT_DURATION = 2.4; // seconds for a packet to traverse the path
const DOT_STAGGER = DOT_DURATION / DOT_COUNT; // even spacing along the lane

function FlowDots({
  pathId,
  color,
  visible,
  startDelay,
}: {
  /** Element id of the SVG path the dots ride. */
  pathId: string;
  /** Dot fill colour. */
  color: string;
  /** True only when the parent step is revealed AND the path has drawn. */
  visible: boolean;
  /**
   * Extra delay (seconds) before the FIRST dot appears — usually the
   * step's `pathDelay + pathDuration` so the stream begins after the
   * arrow finishes drawing.
   */
  startDelay: number;
}) {
  if (!visible) return null;
  return (
    <g aria-hidden>
      {Array.from({ length: DOT_COUNT }, (_, i) => {
        const begin = `${(startDelay + i * DOT_STAGGER).toFixed(2)}s`;
        return (
          <circle key={i} r={5} fill={color} opacity={0.95}>
            <animateMotion
              dur={`${DOT_DURATION}s`}
              repeatCount="indefinite"
              rotate="auto"
              begin={begin}
              fill="freeze"
            >
              <mpath href={`#${pathId}`} />
            </animateMotion>
            {/* Fade in at the start of each lap so the dot doesn't
                pop into existence mid-arc. */}
            <animate
              attributeName="opacity"
              values="0;0.95;0.95;0"
              keyTimes="0;0.08;0.92;1"
              dur={`${DOT_DURATION}s`}
              repeatCount="indefinite"
              begin={begin}
            />
          </circle>
        );
      })}
    </g>
  );
}

// ─── Whole-step component (arrow + badge + label) ─────────────────────

function DiagramStepRender({
  step,
  phase,
  reduced,
}: {
  step: DiagramStep;
  phase: number;
  reduced: boolean;
}) {
  const visible = isStepVisible(step, phase);
  const peers = stepsRevealedAt(step.revealAtPhase);
  const indexInPhase = peers.indexOf(step);
  const timing = reduced ? reducedMotionTiming() : computeStepTiming(indexInPhase);

  const geom = geometryFor(step);
  const d = arcPath(geom.from, geom.to, geom.curve, geom.laneOffset);
  const mid = arcMidpoint(geom.from, geom.to, geom.curve, geom.laneOffset);

  // Step colour — the actor producing the data flow.
  // Top row: MCP (compute blue). Bottom row: bot-3/bot-5 are LLM/Sandbox
  // outputs (info blue), the rest originate from the Agent (orange).
  const color = step.row === "top"
    ? COLOR_MCP
    : step.step === 3 || step.step === 5
      ? COLOR_LLM
      : COLOR_AGENT;
  const idSuffix = `${step.row}-${step.step}`;
  const markerId = `arrow-${idSuffix}`;
  const pathId = `path-${idSuffix}`;

  return (
    <g>
      {/* Per-arrow marker so colour matches the path */}
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
        </marker>
      </defs>
      <StepArrow
        d={d}
        pathId={pathId}
        color={color}
        visible={visible}
        delay={timing.pathDelay}
        duration={timing.pathDuration}
        reduced={reduced}
        markerId={markerId}
      />
      {/* Flowing-dot stream — only when motion is allowed and the
          arrow is fully drawn. SMIL animation, no JS timers. */}
      {!reduced && (
        <FlowDots
          pathId={pathId}
          color={color}
          visible={visible}
          startDelay={timing.pathDelay + timing.pathDuration}
        />
      )}
      <StepBadge
        cx={mid.x}
        cy={mid.y}
        step={step.step}
        fill={color}
        visible={visible}
        delay={timing.badgeDelay}
        duration={timing.badgeDuration}
        reduced={reduced}
      />
      <StepLabel
        midpoint={mid}
        anchor={geom.labelAnchor}
        label={step.label}
        visible={visible}
        delay={timing.badgeDelay}
        reduced={reduced}
      />
    </g>
  );
}

// ─── Body ─────────────────────────────────────────────────────────────

function DiagramBody({ phase }: { phase: number }) {
  const reducedRaw = useReducedMotion();
  const reduced = !!reducedRaw;

  return (
    <motion.div
      className="mx-auto flex w-full max-w-[1280px] flex-col gap-3 pt-2"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: easeEntrance }}
    >
      <h2 className="text-[clamp(28px,3.4vw,48px)] font-medium leading-[1.05] tracking-[-0.035em] text-cf-text">
        How Code Mode works.
      </h2>
      <p className="text-[clamp(14px,1.2vw,18px)] leading-[1.5] text-cf-text-muted">
        Same actors. Different protocol. Code Mode replaces the LLM&rsquo;s
        per-tool ping-pong with a single TypeScript program executed inside
        a millisecond Worker isolate.{" "}
        <span className="text-cf-text">
          Think of the agent as a kitchen the LLM gives a recipe to —
          instead of asking for one ingredient at a time, the LLM hands
          over the whole shopping list as code and the kitchen runs it.
        </span>
      </p>

      <div
        className="relative mx-auto w-full"
        // Cap the diagram's intrinsic height so the bottom legend cards
        // never get pushed below the slide chrome on 1080p screens.
        style={{
          aspectRatio: `${VIEW_W} / ${VIEW_H}`,
          maxHeight: "min(56vh, 720px)",
          maxWidth: "calc(min(56vh, 720px) * 1.764)",
        }}
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          width="100%"
          height="100%"
          role="img"
          aria-label="Animated diagram comparing Traditional MCP and Code Mode flows"
        >
          {/* Row dividers / labels */}
          <text
            x={20}
            y={28}
            fill="var(--color-cf-text-subtle)"
            fontFamily="var(--font-mono)"
            fontSize={12}
            letterSpacing="2"
          >
            01 · TRADITIONAL MCP
          </text>
          <text
            x={20}
            y={284}
            fill="var(--color-cf-orange)"
            fontFamily="var(--font-mono)"
            fontSize={12}
            letterSpacing="2"
          >
            02 · CODE MODE
          </text>
          {/* Dashed horizontal divider between the two rows */}
          <line
            x1={20}
            x2={VIEW_W - 20}
            y1={260}
            y2={260}
            stroke="var(--color-cf-border)"
            strokeDasharray="6 6"
            strokeWidth={1}
          />

          {/* TOP ROW NODES */}
          <NodeBox cx={TOP_LLM_X} cy={TOP_Y} title="LLM" subtitle="model">
            <LLMIcon />
          </NodeBox>
          <NodeBox cx={TOP_AGENT_X} cy={TOP_Y} title="Agent" subtitle="worker">
            <AgentIcon />
          </NodeBox>
          <NodeBox cx={TOP_MCP_X} cy={TOP_Y} title="MCP server" subtitle="tools">
            <MCPServerIcon />
          </NodeBox>

          {/* BOTTOM ROW NODES */}
          <NodeBox cx={BOT_LLM_X} cy={BOT_Y} title="LLM" subtitle="model">
            <LLMIcon />
          </NodeBox>
          <NodeBox cx={BOT_AGENT_X} cy={BOT_Y} title="Agent" subtitle="worker">
            <AgentIcon />
          </NodeBox>
          <NodeBox cx={BOT_SANDBOX_X} cy={BOT_Y} title="Isolate Sandbox" subtitle="dynamic worker">
            <SandcastleIcon reduced={reduced} />
          </NodeBox>
          <NodeBox cx={BOT_MCP_X} cy={BOT_Y} title="MCP server" subtitle="tools">
            <MCPServerIcon />
          </NodeBox>

          {/* All step arrows + badges + labels */}
          {DIAGRAM_STEPS.map((step) => (
            <DiagramStepRender
              key={`${step.row}-${step.step}`}
              step={step}
              phase={phase}
              reduced={reduced}
            />
          ))}
        </svg>
      </div>

      {/* Plain-English glossary footer — appears once the bottom row
          starts revealing (phase 4) so it sets up the audience BEFORE
          the dense terminology lands. Compact one-line explanations so
          the slide doesn't overflow on 1080p. */}
      <motion.div
        initial={false}
        animate={{ opacity: phase >= 4 ? 1 : 0 }}
        transition={{ duration: 0.45, ease: easeEntrance, delay: phase >= 4 ? 0.4 : 0 }}
        className="mt-2 grid grid-cols-2 gap-3"
        aria-hidden={phase < 4}
      >
        <div className="rounded-lg border border-cf-border bg-cf-bg-200 px-4 py-2.5">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-orange">
            TypeScript API
          </div>
          <p className="text-[clamp(11px,0.95vw,14px)] leading-snug text-cf-text-muted">
            A list of named functions the LLM can call —{" "}
            <code className="font-mono text-cf-text">codemode.listZones()</code>{" "}
            instead of an opaque tool ID.
          </p>
        </div>
        <div className="rounded-lg border border-cf-border bg-cf-bg-200 px-4 py-2.5">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-orange">
            Calls back into the agent
          </div>
          <p className="text-[clamp(11px,0.95vw,14px)] leading-snug text-cf-text-muted">
            The sandbox can&rsquo;t reach MCP directly — the agent
            intercepts each call, runs the tool, hands back the result.
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

export const howItWorksDiagramSlide: SlideDef = {
  id: "how-it-works-diagram",
  title: "How Code Mode works.",
  layout: "default",
  sectionLabel: "Code Mode",
  sectionNumber: "04",
  phases: DIAGRAM_PHASES,
  render: ({ phase }) => <DiagramBody phase={phase} />,
};
