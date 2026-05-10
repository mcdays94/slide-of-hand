/**
 * Pure helpers for the "How Code Mode works" diagram (slide 11).
 *
 * The slide animates two stacked rows — Traditional MCP (4 steps) and
 * Code Mode (6 steps) — across 6 phase reveals. To keep the rendering
 * code declarative we describe each step as data and derive everything
 * else (visibility, animation timing) from pure functions that are
 * trivial to unit-test.
 *
 * Phase plan (0..6):
 *   0 — only the nodes are drawn; no arrows yet
 *   1 — TOP step 1
 *   2 — TOP step 2
 *   3 — TOP steps 3 + 4 (top row complete)
 *   4 — BOTTOM steps 1 + 2
 *   5 — BOTTOM steps 3 + 4
 *   6 — BOTTOM steps 5 + 6 (bottom row complete)
 */

export type DiagramRow = "top" | "bottom";

export interface DiagramStep {
  /** Which row this step belongs to. */
  row: DiagramRow;
  /** 1-indexed step number shown in the badge. */
  step: number;
  /** The phase at which this step's arrow + badge should reveal. */
  revealAtPhase: number;
  /** Caption shown next to the badge. */
  label: string;
}

/**
 * Authoritative ordered list of every step in the diagram. Order
 * matters because steps that reveal at the same phase are staggered
 * inside that phase by their position in this list.
 */
export const DIAGRAM_STEPS: readonly DiagramStep[] = [
  // Top row — Traditional MCP
  { row: "top", step: 1, revealAtPhase: 1, label: "Provides tool schemas" },
  { row: "top", step: 2, revealAtPhase: 2, label: "Forwards schemas to LLM" },
  { row: "top", step: 3, revealAtPhase: 3, label: "Outputs JSON tool calls" },
  { row: "top", step: 4, revealAtPhase: 3, label: "Calls MCP tools" },
  // Bottom row — Code Mode. Labels are deliberately short so they don't
  // collide with the inner arcs of the dual-arc Code Mode topology.
  // "RPC" replaced with plain English ("calls back into the agent") so
  // a non-developer audience can follow without a vocabulary primer.
  { row: "bottom", step: 1, revealAtPhase: 4, label: "Provides tool schemas" },
  { row: "bottom", step: 2, revealAtPhase: 4, label: "Provides TypeScript API" },
  { row: "bottom", step: 3, revealAtPhase: 5, label: "Writes code against API" },
  { row: "bottom", step: 4, revealAtPhase: 5, label: "Runs code in sandbox" },
  { row: "bottom", step: 5, revealAtPhase: 6, label: "Calls back into agent" },
  { row: "bottom", step: 6, revealAtPhase: 6, label: "Calls MCP tools" },
];

/** Total number of phase reveals required by the slide. */
export const DIAGRAM_PHASES = 6;

/**
 * Whether a step is visible at the given phase. Visibility is monotonic
 * — once a step appears it stays on screen for every later phase.
 */
export function isStepVisible(step: DiagramStep, phase: number): boolean {
  return phase >= step.revealAtPhase;
}

/**
 * Returns the steps that reveal exactly AT the given phase (in source
 * order). When a phase reveals multiple steps we stagger them by their
 * index in this list to avoid synchronously drawing several overlapping
 * paths.
 */
export function stepsRevealedAt(phase: number, steps: readonly DiagramStep[] = DIAGRAM_STEPS): DiagramStep[] {
  return steps.filter((s) => s.revealAtPhase === phase);
}

export interface StepTimingOptions {
  /** How long a single arrow's path-draw animation runs (seconds). */
  pathDuration?: number;
  /** How long the numbered badge pop-in runs (seconds). */
  badgeDuration?: number;
  /** Stagger between sibling steps revealed in the same phase (seconds). */
  stagger?: number;
}

export interface StepTiming {
  pathDelay: number;
  pathDuration: number;
  badgeDelay: number;
  badgeDuration: number;
}

const DEFAULT_TIMING: Required<StepTimingOptions> = {
  pathDuration: 0.6,
  badgeDuration: 0.25,
  stagger: 0.15,
};

/**
 * Compute the entrance timing for a single step. The path starts
 * after `stagger * indexInPhase` seconds, then the badge pops in
 * immediately after the path finishes.
 *
 * `indexInPhase` is 0 for the first step revealed in this phase, 1
 * for the second, and so on. (Use `stepsRevealedAt(...).indexOf(step)`.)
 */
export function computeStepTiming(
  indexInPhase: number,
  options: StepTimingOptions = {},
): StepTiming {
  const { pathDuration, badgeDuration, stagger } = { ...DEFAULT_TIMING, ...options };
  if (indexInPhase < 0) {
    throw new RangeError(`indexInPhase must be >= 0 (got ${indexInPhase})`);
  }
  const pathDelay = indexInPhase * stagger;
  return {
    pathDelay,
    pathDuration,
    badgeDelay: pathDelay + pathDuration,
    badgeDuration,
  };
}

/**
 * Reduced-motion variant: zero-out delays and durations so the
 * end-state is rendered immediately. Returns the same shape as
 * `computeStepTiming` for ergonomic substitution at the call site.
 */
export function reducedMotionTiming(): StepTiming {
  return { pathDelay: 0, pathDuration: 0, badgeDelay: 0, badgeDuration: 0 };
}
