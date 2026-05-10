import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Cpu,
  Database,
  Eye,
  Fingerprint,
  Lock,
  Search,
  ShieldCheck,
  Sparkles,
  User,
  Cloud,
} from "lucide-react";
import type { SlideDef } from "@/framework/viewer/types";
import { Tag } from "../components/primitives/Tag";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { easeEntrance, staggerContainer, staggerItem } from "../lib/motion";

// =====================================================================
// Pillars (unchanged from previous version)
// =====================================================================

const PILLARS = [
  {
    n: "01",
    label: "Discover",
    icon: Search,
    color: "var(--color-cf-orange)",
    blurb: "Find every AI tool. Surface usage. Triage by risk.",
    products: ["Shadow IT Discovery", "App Library"],
  },
  {
    n: "02",
    label: "Govern",
    icon: ShieldCheck,
    color: "var(--color-cf-compute)",
    blurb: "Identity-aware. Posture-aware. Per-app policies.",
    products: ["Cloudflare Access", "Gateway HTTP policies"],
  },
  {
    n: "03",
    label: "Protect",
    icon: Lock,
    color: "var(--color-cf-error)",
    blurb:
      "Inspect prompts. Isolate risky tools. One ingress for every model.",
    products: ["AI Prompt Protection (DLP)", "Browser Isolation", "AI Gateway"],
  },
  {
    n: "04",
    label: "Observe",
    icon: Eye,
    color: "var(--color-cf-info)",
    blurb: "Audit metadata for every call. Content only when guardrails fire.",
    products: ["AI Gateway · Logs", "Logpush → R2 / S3 / Splunk"],
  },
  {
    n: "05",
    label: "Empower",
    icon: Sparkles,
    color: "var(--color-cf-ai)",
    blurb: "Curated MCP servers for your agents, governed by Access.",
    products: ["MCP Server Portal", "Workers AI"],
  },
];

// =====================================================================
// Flow timeline geometry (single source of truth — used by both SVG
// path strings AND the HTML overlay so the rail and the icons can
// never drift apart).
//
// Canvas dimensions are tightened to 1200×320 (was 1480×310). The
// previous viewBox left ~25% of horizontal space empty on the right of
// the diagram with a `meet` aspect-ratio strategy, which made the
// composition feel unbalanced. The new ratio (3.75:1) more closely
// matches the actual rendered card aspect.
// =====================================================================

const VB_W = 1200;
const VB_H = 340;

/** y of the main rail — also the centre y of every cf-owned node. */
const RAIL_Y = 100;

/**
 * Three users stacked vertically on the left. Each pulse picks one
 * (rotating) user as its source — replaces the previous "single User
 * node with rotating label" approach so the audience can see multiple
 * humans visibly using the platform.
 */
interface UserDef {
  id: string;
  label: string;
  role: string;
  /** Centre x. */
  x: number;
  /** Centre y. */
  y: number;
}

const USERS: UserDef[] = [
  // y values spread 70px apart so each disc + its label + role detail
  // (~52px tall total) has a clean ~18px gap before the next user.
  // Earlier 50px spacing made user-1's "engineering" label collide
  // with user-2's disc.
  { id: "u1", label: "User 1", role: "engineering", x: 60, y: 30 },
  { id: "u2", label: "User 2", role: "marketing", x: 60, y: 100 },
  { id: "u3", label: "User 3", role: "support", x: 60, y: 170 },
];

/** Disc radius (px) for the small user icons (h-9 = 36px). */
const USER_DISC_RADIUS = 18;

interface FlowNode {
  id: string;
  icon: typeof User;
  label: string;
  detail: string;
  x: number;
  cf: boolean;
  /** Whether a red pulse can terminate here. */
  blockable: boolean;
}

/** Cloudflare-owned nodes only — the User column above is separate. */
const FLOW_NODES: FlowNode[] = [
  {
    id: "warp",
    icon: Cloud,
    label: "Cloudflare One",
    detail: "WARP / SWG",
    x: 200,
    cf: true,
    blockable: true,
  },
  {
    id: "access",
    icon: Fingerprint,
    label: "Access",
    detail: "identity + posture",
    x: 360,
    cf: true,
    blockable: true,
  },
  {
    id: "gateway",
    icon: ShieldCheck,
    label: "Gateway",
    detail: "DLP · isolation",
    x: 520,
    cf: true,
    blockable: true,
  },
  {
    id: "aigw",
    icon: Cpu,
    label: "AI Gateway",
    detail: "cache · fallback",
    x: 680,
    cf: true,
    blockable: true,
  },
];

const RAIL_END_X = 830;

// Provider stack
interface ProviderTile {
  id: string;
  name: string;
  logo: string;
  model: string;
  color: string;
  /** LEFT edge x of the tile (where the dot lands). */
  x: number;
  /** Centre y of the tile. */
  y: number;
}

const PROVIDERS: ProviderTile[] = [
  {
    id: "openai",
    name: "OpenAI",
    logo: "/cf-zt-ai/logos/openai.svg",
    model: "gpt-4o",
    color: "#10a37f",
    x: 920,
    y: 40,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    logo: "/cf-zt-ai/logos/anthropic.svg",
    model: "claude-3.5",
    color: "#d97757",
    x: 920,
    y: 100,
  },
  {
    id: "workers-ai",
    name: "Workers AI",
    logo: "/cf-zt-ai/logos/cloudflare.svg",
    model: "llama-3.3",
    color: "#ff4801",
    x: 920,
    y: 160,
  },
];

// Sidecar (Cloudflare ships logs OUT to a customer SIEM).
//
// Layout note: with users at y=30/100/170, user-3's role label ends
// around y=212. LOG_DROP_START_Y must clear that *and* the cf-node
// labels (which end at ~160). Bumping the bus + sidecar down means
// VB_H grew to 340.
const SIDECAR_Y = 285;
const LOGPUSH = { x: 670, y: SIDECAR_Y };
const SIEM = { x: 940, y: SIDECAR_Y };
const LOG_BUS_Y = 250;
/** y from which the dashed drops emerge — below all node text. */
const LOG_DROP_START_Y = 220;
/** Disc radius for sidecar nodes (h-11 = 44px). */
const SIDECAR_DISC_RADIUS = 22;
/** Disc radius for main flow nodes (h-14 = 56px). */
const FLOW_DISC_RADIUS = 28;

// =====================================================================
// Pulse generation
// =====================================================================

interface Pulse {
  id: number;
  kind: "green" | "red";
  blockIdx: number | null;
  providerIdx: number | null;
  /** Index into USERS — which user disc the pulse emerges from. */
  userIdx: number;
  pathD: string;
  duration: number;
  /** ms from pulse start to dot arrival at each main-flow node. */
  nodeArrivals: number[];
  /** Index into FLOW_NODES per arrival. */
  arrivalNodeIdx: number[];
}

/**
 * Build a "user → CFOne" entry curve. User y values vary (USERS have
 * y=50/100/150) so each user has its own slight S-curve down/up to the
 * rail. CFOne sits at FLOW_NODES[0]=(200, 100).
 */
function entryCurve(user: UserDef): string {
  const cfx = FLOW_NODES[0].x;
  // Cubic bezier with two horizontal control points biased toward the
  // start and end x — gives a soft S-shape.
  const c1x = user.x + 60;
  const c1y = user.y;
  const c2x = cfx - 60;
  const c2y = RAIL_Y;
  return `C ${c1x} ${c1y}, ${c2x} ${c2y}, ${cfx} ${RAIL_Y}`;
}

function generatePulse(seq: number, prevUserIdx: number): Pulse {
  // Always pick a *different* user than the last pulse so the active
  // user disc visibly changes between pulses.
  let userIdx = Math.floor(Math.random() * USERS.length);
  if (userIdx === prevUserIdx) {
    userIdx = (userIdx + 1) % USERS.length;
  }
  const user = USERS[userIdx];

  // Slight bias toward green so the success path dominates the visual.
  const isRed = Math.random() < 0.4;

  if (isRed) {
    // Block at one of the Cloudflare-owned nodes (indices 0..3).
    const blockIdx = Math.floor(Math.random() * FLOW_NODES.length);
    const blockNode = FLOW_NODES[blockIdx];

    // Path: user → CFOne curve → ... → blockNode
    const segs: string[] = [`M ${user.x} ${user.y}`, entryCurve(user)];
    for (let i = 1; i <= blockIdx; i++) {
      segs.push(`L ${FLOW_NODES[i].x} ${RAIL_Y}`);
    }
    const pathD = segs.join(" ");

    const entryLen = Math.hypot(
      FLOW_NODES[0].x - user.x,
      RAIL_Y - user.y,
    ) * 1.05;
    const railLen = blockNode.x - FLOW_NODES[0].x;
    const totalLen = entryLen + railLen;
    const duration = 0.8 + (totalLen / 850) * 1.0;

    const nodeArrivals: number[] = [];
    const arrivalNodeIdx: number[] = [];
    // CFOne (i=0) arrives at the end of the entry curve; subsequent
    // nodes are linear along the rail.
    for (let i = 0; i <= blockIdx; i++) {
      const dist =
        i === 0
          ? entryLen
          : entryLen + (FLOW_NODES[i].x - FLOW_NODES[0].x);
      nodeArrivals.push((dist / totalLen) * duration * 1000);
      arrivalNodeIdx.push(i);
    }

    return {
      id: Date.now() + seq,
      kind: "red",
      blockIdx,
      providerIdx: null,
      userIdx,
      pathD,
      duration,
      nodeArrivals,
      arrivalNodeIdx,
    };
  }

  // Green: full main path → ends at provider's LEFT edge.
  const providerIdx = Math.floor(Math.random() * PROVIDERS.length);
  const provider = PROVIDERS[providerIdx];

  const segs: string[] = [`M ${user.x} ${user.y}`, entryCurve(user)];
  for (let i = 1; i < FLOW_NODES.length; i++) {
    segs.push(`L ${FLOW_NODES[i].x} ${RAIL_Y}`);
  }
  segs.push(`L ${RAIL_END_X} ${RAIL_Y}`);
  segs.push(
    `C ${RAIL_END_X + 30} ${RAIL_Y}, ${provider.x - 30} ${provider.y}, ${provider.x} ${provider.y}`,
  );
  const pathD = segs.join(" ");

  const entryLen =
    Math.hypot(FLOW_NODES[0].x - user.x, RAIL_Y - user.y) * 1.05;
  const railLen = RAIL_END_X - FLOW_NODES[0].x;
  const fanLen = 60 + Math.abs(provider.y - RAIL_Y) * 1.0;
  const totalLen = entryLen + railLen + fanLen;
  const duration = 2.2;

  const nodeArrivals: number[] = [];
  const arrivalNodeIdx: number[] = [];
  for (let i = 0; i < FLOW_NODES.length; i++) {
    const dist =
      i === 0 ? entryLen : entryLen + (FLOW_NODES[i].x - FLOW_NODES[0].x);
    nodeArrivals.push((dist / totalLen) * duration * 1000);
    arrivalNodeIdx.push(i);
  }

  return {
    id: Date.now() + seq,
    kind: "green",
    blockIdx: null,
    providerIdx,
    userIdx,
    pathD,
    duration,
    nodeArrivals,
    arrivalNodeIdx,
  };
}

// =====================================================================
// Slide
// =====================================================================

export const recapSlide: SlideDef = {
  id: "recap",
  title: "Cloudflare's holistic AI security",
  layout: "default",
  sectionLabel: "RECAP",
  render: () => (
    <div className="mx-auto flex h-full w-full max-w-[1480px] flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Tag>Recap</Tag>
          <h2 className="mt-3 text-3xl tracking-[-0.035em] sm:text-5xl">
            One platform.{" "}
            <span className="text-cf-orange">The whole AI lifecycle.</span>
          </h2>
          <p className="mt-3 max-w-2xl text-cf-text-muted">
            Five phases mapped to the products you already have on
            Cloudflare. No new vendor, no new pane of glass.
          </p>
        </div>
      </div>

      {/* 5 pillar cards */}
      <motion.div
        className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-5"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        {PILLARS.map((p) => (
          <motion.div key={p.n} variants={staggerItem}>
            <CornerBrackets className="cf-card flex h-full flex-col gap-3 p-5">
              <div className="flex items-center justify-between">
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-full"
                  style={{ background: `${p.color}1a`, color: p.color }}
                >
                  <p.icon className="h-4 w-4" />
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
                  {p.n}
                </span>
              </div>
              <h3
                className="text-2xl tracking-[-0.025em]"
                style={{ color: p.color }}
              >
                {p.label}
              </h3>
              <p className="text-sm text-cf-text-muted">{p.blurb}</p>
              <div className="mt-auto flex flex-wrap gap-1.5 border-t border-dashed border-cf-border pt-3">
                {p.products.map((prod) => (
                  <span
                    key={prod}
                    className="rounded-full border px-2 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.06em]"
                    style={{
                      color: p.color,
                      borderColor: `${p.color}33`,
                      background: `${p.color}0d`,
                    }}
                  >
                    {prod}
                  </span>
                ))}
              </div>
            </CornerBrackets>
          </motion.div>
        ))}
      </motion.div>

      <PromptFlowTimeline />

      {/* Thin closing strip */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 1.2, ease: easeEntrance }}
        className="flex flex-wrap items-center justify-between gap-3 rounded-full border border-dashed border-cf-orange/40 bg-cf-orange-light px-5 py-2.5"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 flex-shrink-0 text-cf-orange" />
          <span className="text-sm">
            <span className="font-medium text-cf-text">
              Already on Cloudflare?
            </span>{" "}
            <span className="text-cf-text-muted">
              Most of this is one toggle. The rest is one policy.
            </span>
          </span>
        </div>
      </motion.div>
    </div>
  ),
};

// =====================================================================
// PromptFlowTimeline
// ---------------------------------------------------------------------
// Layering:
//   z=0  SVG layer (paths, dots, sidecar lines)
//   z=10 HTML overlay (icon discs, provider tiles, sidecar nodes)
//
// Because HTML cards sit ABOVE the SVG, the dot visually disappears
// when crossing an icon — exactly what the brief asked for.
//
// Scheduling: ONE pulse at a time. After each pulse finishes (path
// fade-out + buffer), the next is generated. setInterval would let
// pulses overlap; this recursive setTimeout pattern guarantees they
// don't.
// =====================================================================

function PromptFlowTimeline() {
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [nodeGlow, setNodeGlow] = useState<Record<number, number>>({});
  const [nodeBlocked, setNodeBlocked] = useState<Set<number>>(new Set());
  const [activeProvider, setActiveProvider] = useState<Set<number>>(new Set());
  /** Index into USERS — the active user's disc lights up in orange.
   *  Updates each time a new pulse spawns. Default to 0 so a user is
   *  visually highlighted before the first pulse fires. */
  const [activeUserIdx, setActiveUserIdx] = useState(0);

  useEffect(() => {
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let seq = 0;
    let mounted = true;
    /** Track previous user across pulses so we never repeat the same
     *  user twice in a row. */
    let prevUserIdx = -1;

    const incNode = (idx: number) =>
      setNodeGlow((g) => ({ ...g, [idx]: (g[idx] || 0) + 1 }));
    const decNode = (idx: number) =>
      setNodeGlow((g) => {
        const v = (g[idx] || 1) - 1;
        if (v <= 0) {
          const { [idx]: _drop, ...rest } = g;
          return rest;
        }
        return { ...g, [idx]: v };
      });

    const spawn = () => {
      if (!mounted) return;
      seq += 1;
      const p = generatePulse(seq, prevUserIdx);
      prevUserIdx = p.userIdx;
      setPulse(p);
      setActiveUserIdx(p.userIdx);

      const nodeWindowMs = 220;
      p.nodeArrivals.forEach((arriveMs, i) => {
        const idx = p.arrivalNodeIdx[i];
        const isTerminalRed =
          p.kind === "red" && i === p.nodeArrivals.length - 1;

        if (isTerminalRed) {
          timeouts.push(
            setTimeout(() => {
              setNodeBlocked((s) => new Set(s).add(idx));
            }, Math.max(0, arriveMs - 80)),
          );
          timeouts.push(
            setTimeout(
              () => {
                setNodeBlocked((s) => {
                  const ns = new Set(s);
                  ns.delete(idx);
                  return ns;
                });
              },
              (p.duration + 0.5) * 1000,
            ),
          );
        } else {
          const onAt = Math.max(0, arriveMs - 80);
          const offAt = arriveMs + nodeWindowMs;
          timeouts.push(setTimeout(() => incNode(idx), onAt));
          timeouts.push(setTimeout(() => decNode(idx), offAt));
        }
      });

      if (p.kind === "green" && p.providerIdx != null) {
        const provIdx = p.providerIdx;
        const tOn = p.duration * 1000 - 200;
        timeouts.push(
          setTimeout(() => {
            setActiveProvider((s) => new Set(s).add(provIdx));
          }, tOn),
        );
        timeouts.push(
          setTimeout(
            () => {
              setActiveProvider((s) => {
                const ns = new Set(s);
                ns.delete(provIdx);
                return ns;
              });
            },
            tOn + 800,
          ),
        );
      }

      // Cleanup *this* pulse, then schedule the next one. Tighter
      // gap than the previous version (was 380ms) so the cadence
      // feels more like real traffic — a fresh user submits a prompt
      // roughly every ~3 seconds.
      timeouts.push(
        setTimeout(
          () => {
            setPulse(null);
            timeouts.push(setTimeout(spawn, 120));
          },
          (p.duration + 0.45) * 1000,
        ),
      );
    };

    timeouts.push(setTimeout(spawn, 250));

    return () => {
      mounted = false;
      timeouts.forEach(clearTimeout);
    };
  }, []);

  return (
    <CornerBrackets className="cf-card relative flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-dashed border-cf-border px-5 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
          How a single prompt flows through Cloudflare
        </span>
        <div className="flex items-center gap-3">
          <LegendDot color="var(--color-cf-success)" label="Success" />
          <LegendDot color="var(--color-cf-error)" label="Policy block" />
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
            one pulse at a time
          </span>
        </div>
      </div>

      <div className="relative flex flex-1 items-center justify-center px-4 py-3">
        <div
          className="relative w-full"
          style={{ aspectRatio: `${VB_W} / ${VB_H}`, maxHeight: "100%" }}
        >
          {/* SVG layer — paths and dots BELOW the HTML cards. */}
          <svg
            className="pointer-events-none absolute inset-0 z-0 h-full w-full"
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
          >
            {/* Static fan-IN from each user disc to CFOne — three
                dashed S-curves that show "any of these users can
                submit a prompt". */}
            {USERS.map((u) => (
              <path
                key={`fan-${u.id}`}
                d={`M ${u.x + USER_DISC_RADIUS} ${u.y} C ${u.x + 70} ${u.y}, ${FLOW_NODES[0].x - 60} ${RAIL_Y}, ${FLOW_NODES[0].x} ${RAIL_Y}`}
                fill="none"
                stroke="var(--color-cf-border)"
                strokeWidth={1.2}
                strokeDasharray="6 5"
                opacity={0.55}
              />
            ))}

            {/* Static main rail — from CFOne to the fan-out point. */}
            <line
              x1={FLOW_NODES[0].x}
              y1={RAIL_Y}
              x2={RAIL_END_X}
              y2={RAIL_Y}
              stroke="var(--color-cf-border)"
              strokeWidth={1.2}
              strokeDasharray="6 5"
              opacity={0.7}
            />

            {/* Static fan-OUT from the rail end to each provider's left edge */}
            {PROVIDERS.map((p) => (
              <path
                key={p.id}
                d={`M ${RAIL_END_X} ${RAIL_Y} C ${RAIL_END_X + 30} ${RAIL_Y}, ${p.x - 30} ${p.y}, ${p.x} ${p.y}`}
                fill="none"
                stroke="var(--color-cf-border)"
                strokeWidth={1.2}
                strokeDasharray="6 5"
                opacity={0.55}
              />
            ))}

            {/* Sidecar — dashed log-bus + drop into Logpush + solid edge into SIEM */}
            <SidecarLines />

            {/* The single in-flight pulse */}
            {pulse && <PulseSvg pulse={pulse} />}
          </svg>

          {/* HTML overlay — z=10, sits above the SVG so cards visually
              swallow the dot at their borders. */}
          <div className="pointer-events-none absolute inset-0 z-10">
            {/* User column — three small discs stacked vertically */}
            {USERS.map((u, i) => (
              <UserDisc
                key={u.id}
                user={u}
                active={activeUserIdx === i}
              />
            ))}

            {FLOW_NODES.map((node, i) => (
              <FlowNodeDisc
                key={node.id}
                node={node}
                index={i}
                glowing={(nodeGlow[i] || 0) > 0}
                blocked={nodeBlocked.has(i)}
              />
            ))}

            {PROVIDERS.map((p, i) => (
              <ProviderTileCard
                key={p.id}
                provider={p}
                active={activeProvider.has(i)}
              />
            ))}

            {/* Logpush — Cloudflare's built-in log export engine. The
                R2/S3/Splunk/Datadog list belongs under SIEM (those are
                its destinations, not a description of Logpush itself). */}
            <SidecarNode
              position={LOGPUSH}
              icon={Database}
              label="Logpush"
              detail="Cloudflare log export"
              tone="cf"
            />
            <SidecarNode
              position={SIEM}
              icon={Eye}
              label="SIEM / Repo / HTTP endpoint"
              detail="R2 · any S3 · Splunk · Datadog · …"
              tone="external"
            />

            {/* Sidecar zone label */}
            <span
              className="absolute font-mono text-[9px] uppercase tracking-[0.12em] text-cf-text-subtle"
              style={{
                left: `${(LOGPUSH.x / VB_W) * 100}%`,
                top: `${((SIDECAR_Y - 70) / VB_H) * 100}%`,
                transform: "translate(-50%, 0)",
              }}
            >
              Logs out · sidecar
            </span>
          </div>
        </div>
      </div>
    </CornerBrackets>
  );
}

// =====================================================================
// Static sidecar lines — dashed bus + drops + solid edge to SIEM
// =====================================================================

function SidecarLines() {
  const cfNodes = FLOW_NODES.filter((n) => n.cf);
  const busStartX = cfNodes[0].x;
  const busEndX = cfNodes[cfNodes.length - 1].x;
  const busMidX = (busStartX + busEndX) / 2;

  // Use a slightly tinted orange-ish colour so the log-bus reads as
  // "Cloudflare-owned plumbing" rather than chrome decoration; opacity
  // bumped to 0.85 so the lines are clearly visible.
  const dashColor = "color-mix(in srgb, var(--color-cf-orange) 55%, var(--color-cf-text-subtle))";

  return (
    <g>
      {/* Per-node dashed drops — start BELOW each node's label/detail
          text (LOG_DROP_START_Y) so the lines don't visually run
          through node descriptors. */}
      {cfNodes.map((n) => (
        <line
          key={n.id}
          x1={n.x}
          y1={LOG_DROP_START_Y}
          x2={n.x}
          y2={LOG_BUS_Y}
          stroke={dashColor}
          strokeWidth={1.4}
          strokeDasharray="3 4"
          opacity={0.85}
        />
      ))}

      {/* Horizontal dashed bus collecting the drops */}
      <line
        x1={busStartX}
        y1={LOG_BUS_Y}
        x2={busEndX}
        y2={LOG_BUS_Y}
        stroke={dashColor}
        strokeWidth={1.4}
        strokeDasharray="3 4"
        opacity={0.85}
      />

      {/* Single dashed drop from the bus midpoint into the TOP of the
          Logpush disc (centre y minus radius), so the connection is
          visually obvious. Shaped as a soft S-curve into the disc. */}
      <path
        d={[
          `M ${busMidX} ${LOG_BUS_Y}`,
          `C ${busMidX} ${LOG_BUS_Y + 22},`,
          `${LOGPUSH.x - 30} ${LOGPUSH.y - SIDECAR_DISC_RADIUS - 14},`,
          `${LOGPUSH.x} ${LOGPUSH.y - SIDECAR_DISC_RADIUS}`,
        ].join(" ")}
        fill="none"
        stroke={dashColor}
        strokeWidth={1.4}
        strokeDasharray="3 4"
        opacity={0.85}
      />

      {/* Solid green edge from Logpush → SIEM (Cloudflare push to
          customer tooling). */}
      <line
        x1={LOGPUSH.x + SIDECAR_DISC_RADIUS}
        y1={LOGPUSH.y}
        x2={SIEM.x - SIDECAR_DISC_RADIUS}
        y2={SIEM.y}
        stroke="var(--color-cf-success)"
        strokeWidth={1.6}
        opacity={0.8}
      />

      {/* Continuous ambient log-shipping dots — Logpush ships at a
          steady cadence, distinct from the single in-flight prompt
          pulse on the main rail. */}
      {[0, 0.7, 1.4].map((delay) => (
        <motion.circle
          key={delay}
          r={2.5}
          fill="var(--color-cf-success)"
          cy={LOGPUSH.y}
          initial={{ cx: LOGPUSH.x + SIDECAR_DISC_RADIUS, opacity: 0 }}
          animate={{
            cx: [
              LOGPUSH.x + SIDECAR_DISC_RADIUS,
              SIEM.x - SIDECAR_DISC_RADIUS,
            ],
            opacity: [0, 0.7, 0.7, 0],
          }}
          transition={{
            duration: 2.4,
            delay,
            ease: "linear",
            repeat: Infinity,
            repeatDelay: 0.6,
            times: [0, 0.05, 0.95, 1],
          }}
        />
      ))}
    </g>
  );
}

// =====================================================================
// Pulse SVG — trail + halo + dot
// =====================================================================

function PulseSvg({ pulse }: { pulse: Pulse }) {
  const color =
    pulse.kind === "green"
      ? "var(--color-cf-success)"
      : "var(--color-cf-error)";

  return (
    <g>
      <motion.path
        d={pulse.pathD}
        fill="none"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        initial={{ opacity: 0, pathLength: 0 }}
        animate={{
          opacity: [0, 0.55, 0.55, 0],
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
      <circle r={9} fill={color} opacity={0.22}>
        <animateMotion
          path={pulse.pathD}
          dur={`${pulse.duration}s`}
          fill="freeze"
        />
      </circle>
      <circle r={4.5} fill={color}>
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
// HTML: small user disc — three of these stack vertically on the left
// of the diagram, replacing the previous single User node with a
// rotating label. Each pulse picks one user as its source; that user's
// disc lights up in orange while the pulse is in flight.
// =====================================================================

function UserDisc({ user, active }: { user: UserDef; active: boolean }) {
  return (
    <div
      className="absolute"
      style={{
        left: `${(user.x / VB_W) * 100}%`,
        top: `calc(${(user.y / VB_H) * 100}% - ${USER_DISC_RADIUS}px)`,
        transform: "translateX(-50%)",
      }}
    >
      <motion.div
        className="flex flex-col items-center"
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, ease: easeEntrance }}
      >
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all duration-300"
          style={{
            background: active
              ? "color-mix(in srgb, var(--color-cf-orange) 18%, var(--color-cf-bg-100))"
              : "var(--color-cf-bg-200)",
            borderColor: active
              ? "var(--color-cf-orange)"
              : "var(--color-cf-border)",
            color: active
              ? "var(--color-cf-orange)"
              : "var(--color-cf-text-muted)",
            boxShadow: active
              ? "0 0 14px color-mix(in srgb, var(--color-cf-orange) 45%, transparent), 0 0 0 2px color-mix(in srgb, var(--color-cf-orange) 22%, transparent)"
              : "none",
          }}
        >
          <User className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        <span
          className="mt-1 block text-center font-mono text-[8.5px] uppercase tracking-[0.06em]"
          style={{
            color: active
              ? "var(--color-cf-orange)"
              : "var(--color-cf-text-subtle)",
          }}
        >
          {user.label}
        </span>
        <span className="block text-center font-mono text-[7.5px] uppercase tracking-[0.06em] text-cf-text-subtle">
          {user.role}
        </span>
      </motion.div>
    </div>
  );
}

// =====================================================================
// HTML: a flow-node disc
// ---------------------------------------------------------------------
// Architecture note: the disc and label are positioned using a static
// wrapper div (handles translate(-50%, ...) for horizontal centering
// AND the disc-radius offset for vertical alignment with RAIL_Y) so
// Framer Motion's animate-y on the inner motion.div can't override
// the static transform. Earlier iterations had the wrapper merged with
// the motion.div, which silently killed the horizontal centering.
// =====================================================================

function FlowNodeDisc({
  node,
  index,
  glowing,
  blocked,
}: {
  node: FlowNode;
  index: number;
  glowing: boolean;
  blocked: boolean;
}) {
  const accent = blocked
    ? "#dc2626"
    : node.cf
      ? "var(--color-cf-orange)"
      : "var(--color-cf-text-muted)";
  const isHot = glowing || blocked;

  return (
    <div
      className="absolute"
      style={{
        left: `${(node.x / VB_W) * 100}%`,
        top: `calc(${(RAIL_Y / VB_H) * 100}% - ${FLOW_DISC_RADIUS}px)`,
        transform: "translateX(-50%)",
      }}
    >
      <motion.div
        className="flex flex-col items-center"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.4,
          delay: 0.4 + index * 0.1,
          ease: easeEntrance,
        }}
      >
        {/* Icon disc — solid bg so it visually swallows the dot crossing
            behind it on the SVG layer. */}
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full border-2 transition-all duration-200"
          style={{
            background: blocked
              ? `color-mix(in srgb, ${accent} 18%, var(--color-cf-bg-100))`
              : isHot
                ? `color-mix(in srgb, ${accent} 14%, var(--color-cf-bg-100))`
                : node.cf
                  ? "color-mix(in srgb, var(--color-cf-orange) 8%, var(--color-cf-bg-100))"
                  : "var(--color-cf-bg-200)",
            borderColor: isHot
              ? accent
              : node.cf
                ? "var(--color-cf-orange)"
                : "var(--color-cf-border)",
            color: accent,
            boxShadow: blocked
              ? `0 0 24px color-mix(in srgb, ${accent} 60%, transparent), 0 0 0 3px color-mix(in srgb, ${accent} 30%, transparent)`
              : isHot
                ? `0 0 18px color-mix(in srgb, ${accent} 38%, transparent), 0 0 0 2px color-mix(in srgb, ${accent} 18%, transparent)`
                : node.cf
                  ? `0 0 0 4px color-mix(in srgb, var(--color-cf-orange) 8%, transparent)`
                  : "none",
          }}
        >
          <node.icon className="h-5 w-5" strokeWidth={2} />
        </span>

        <span
          className="mt-2 text-center text-[12px] font-medium leading-tight tracking-[-0.005em]"
          style={{
            color: blocked ? accent : "var(--color-cf-text)",
          }}
        >
          {node.label}
        </span>
        <span className="text-center font-mono text-[9px] uppercase tracking-[0.06em] text-cf-text-subtle">
          {node.detail}
        </span>

        {blocked && (
          <motion.span
            className="mt-1 rounded-full px-1.5 py-0.5 font-mono text-[8.5px] font-medium uppercase tracking-[0.08em]"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{
              color: accent,
              background: `color-mix(in srgb, ${accent} 14%, transparent)`,
              border: `1px solid ${accent}`,
            }}
          >
            blocked
          </motion.span>
        )}
      </motion.div>
    </div>
  );
}

// =====================================================================
// HTML: a provider tile (LEFT-anchored — dot lands on its left edge)
// =====================================================================

function ProviderTileCard({
  provider,
  active,
}: {
  provider: ProviderTile;
  active: boolean;
}) {
  return (
    <div
      className="absolute flex items-center gap-2 rounded-md border bg-cf-bg-200 px-2.5 py-1.5 transition-all duration-300"
      style={{
        left: `${(provider.x / VB_W) * 100}%`,
        top: `${(provider.y / VB_H) * 100}%`,
        // LEFT-anchor: provider.x = card's left edge, so the path's
        // terminal point lands at the doorstep, not the centre.
        transform: "translate(0, -50%)",
        minWidth: "13%",
        borderColor: active ? provider.color : "var(--color-cf-border)",
        boxShadow: active
          ? `0 0 16px color-mix(in srgb, ${provider.color} 32%, transparent), 0 0 0 2px color-mix(in srgb, ${provider.color} 16%, transparent)`
          : "var(--shadow-cf-card)",
      }}
    >
      <img
        src={provider.logo}
        alt=""
        className="h-3.5 w-3.5 flex-shrink-0"
        draggable={false}
      />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="text-[11px] font-medium text-cf-text">
          {provider.name}
        </span>
        <span className="truncate font-mono text-[8px] uppercase tracking-[0.06em] text-cf-text-subtle">
          {provider.model}
        </span>
      </div>
    </div>
  );
}

// =====================================================================
// HTML: a sidecar node (Logpush, SIEM)
// =====================================================================

function SidecarNode({
  position,
  icon: Icon,
  label,
  detail,
  tone,
}: {
  position: { x: number; y: number };
  icon: typeof Database;
  label: string;
  detail: string;
  tone: "cf" | "external";
}) {
  const accent =
    tone === "cf" ? "var(--color-cf-success)" : "var(--color-cf-text-muted)";
  return (
    <div
      className="absolute"
      style={{
        left: `${(position.x / VB_W) * 100}%`,
        top: `calc(${(position.y / VB_H) * 100}% - ${SIDECAR_DISC_RADIUS}px)`,
        transform: "translateX(-50%)",
      }}
    >
      <motion.div
        className="flex flex-col items-center"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 1.0, ease: easeEntrance }}
      >
        <span
          className="flex h-11 w-11 items-center justify-center rounded-full border-2 transition-colors"
          style={{
            background:
              tone === "cf"
                ? "color-mix(in srgb, var(--color-cf-success) 10%, var(--color-cf-bg-100))"
                : "var(--color-cf-bg-200)",
            borderColor:
              tone === "cf" ? accent : "var(--color-cf-border)",
            color: accent,
            // Solid perimeter for both tones — the dashed-border on the
            // external node was visually noisy and the speaker asked to
            // close it. The cf vs external distinction comes through the
            // bg + colour only.
            borderStyle: "solid",
          }}
        >
          <Icon className="h-4 w-4" strokeWidth={2} />
        </span>
        <span
          className="mt-1.5 text-center text-[11px] font-medium leading-tight"
          style={{ color: "var(--color-cf-text)" }}
        >
          {label}
        </span>
        <span className="text-center font-mono text-[9px] uppercase tracking-[0.06em] text-cf-text-subtle">
          {detail}
        </span>
      </motion.div>
    </div>
  );
}

// =====================================================================
// Tiny legend dot
// =====================================================================

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-cf-text-muted">
      <span
        className="h-2 w-2 rounded-full"
        style={{
          background: color,
          boxShadow: `0 0 6px color-mix(in srgb, ${color} 60%, transparent)`,
        }}
      />
      {label}
    </span>
  );
}
