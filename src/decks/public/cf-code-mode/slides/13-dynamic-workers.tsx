import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
} from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import type { SlideDef } from "@/framework/viewer/types";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { Tag } from "../components/primitives/Tag";
import { easeEntrance, easeButton, easeActive } from "../lib/motion";
import {
  CONTAINER_MS,
  ISOLATE_MS,
  RACE_PHASE_TIMES_MS,
  VM_MS,
  formatMillis,
  ghostTrailOffsets,
  racesCompletedAt,
  wallDurationForRunner,
} from "./_race-logic";

/**
 * Slide 13 — "Dynamic Workers — the secret sauce."
 *
 * The "why is this only possible on Cloudflare?" slide. Three runners
 * race a horizontal track:
 *
 *   ▣ Container — 5,000 ms
 *   ▭ VM        — 1,500 ms
 *   ⚡ V8 Isolate — 5–15 ms
 *
 * Phases:
 *   0 — Layout visible. Everyone at start. (Initial state.)
 *   1 — Race plays out. V8 finishes ~0.7 s in, VM ~3.4 s in, container at 5 s.
 *       Each runner pulses its own finish flag as it crosses.
 *   2 — V8 ghost trails appear with the "300+ races completed" counter.
 *   3 — Cost stat + wrangler.jsonc snippet share the bottom row.
 *
 * Each runner advances independently with its own framer-motion
 * transition derived from {@link wallDurationForRunner} — so the
 * audience literally sees V8 win the race, not just an end-state
 * label.
 *
 * We respect `prefers-reduced-motion`: snap each runner to its end
 * position, no looping ghosts, no pulse.
 */

// ─── Track geometry ───────────────────────────────────────────────────
// All percentages so the SVG-free flexbox layout scales without math.
//
// Track is pulled in from the right edge (88% instead of 94%) so a
// dedicated time-label gutter has room to live AFTER the finish line
// without overlapping the card border. The original 94% finish caused
// the lane time labels ("5,000 ms" etc.) to render directly on top of
// the vertical FINISH line — pre-fix QA flagged this as illegible.
const TRACK_LEFT_PCT = 6; // start line
const TRACK_RIGHT_PCT = 88; // finish line
const TRACK_SPAN_PCT = TRACK_RIGHT_PCT - TRACK_LEFT_PCT;
const FINISH_PCT = TRACK_RIGHT_PCT;
/**
 * Horizontal gap (px) between the finish line and the lane time
 * labels. Anchoring with `calc(FINISH_PCT% + GAP)` guarantees the
 * label can never overlap the orange finish-line stroke regardless of
 * card width.
 */
const LABEL_GUTTER_PX = 14;

// ─── Custom monogram-style runner glyphs ──────────────────────────────
// Inline SVGs (16px) chosen over emoji so the visual reads cleanly at
// every render scale and matches the warm-brown design palette. Stroke
// inherits via currentColor.

function ContainerGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="6" width="18" height="12" rx="1" />
      <path d="M7 6v12M11 6v12M15 6v12M19 6v12" />
    </svg>
  );
}

function VmGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="13" rx="1.5" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function IsolateGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M13 3 4 14h6l-1 7 9-11h-6l1-7Z" />
    </svg>
  );
}

// ─── Runner palette ───────────────────────────────────────────────────
type RunnerKind = "container" | "vm" | "isolate";

interface RunnerSpec {
  kind: RunnerKind;
  label: string;
  durationMs: number;
  /** Display string under the runner ("5,000 ms" / "5–15 ms" etc). */
  display: string;
  /** Subtitle in mono (just under the runner label). */
  subtitle: string;
  /** Whether the runner glow uses brand orange. */
  highlight?: boolean;
  /** Glyph to render inside the runner badge. */
  glyph: ReactNode;
}

const RUNNERS: RunnerSpec[] = [
  {
    kind: "container",
    label: "Container",
    durationMs: CONTAINER_MS,
    display: formatMillis(CONTAINER_MS),
    subtitle: "Cold start",
    glyph: <ContainerGlyph />,
  },
  {
    kind: "vm",
    label: "Virtual Machine",
    durationMs: VM_MS,
    display: formatMillis(VM_MS),
    subtitle: "Cold start",
    glyph: <VmGlyph />,
  },
  {
    kind: "isolate",
    label: "V8 Isolate",
    durationMs: ISOLATE_MS,
    display: "5–15 ms",
    subtitle: "Worker cold start",
    highlight: true,
    glyph: <IsolateGlyph />,
  },
];

// ─── Body ─────────────────────────────────────────────────────────────

function RaceTrackBody({ phase }: { phase: number }) {
  const reduced = !!useReducedMotion();
  // When reduced-motion is requested we land directly at the final
  // frame regardless of phase so nothing in motion ever competes with
  // the audience's attention.
  const effectivePhase = reduced ? Math.max(phase, 1) : phase;
  const elapsedMs =
    RACE_PHASE_TIMES_MS[effectivePhase] ?? RACE_PHASE_TIMES_MS.at(-1)!;

  const races = racesCompletedAt(elapsedMs, ISOLATE_MS);
  // Cap at 10 ghost trails (was 14) so the trail never extends past
  // the V8 lane edge or visually crowds the runner glyph.
  const ghostOffsets = ghostTrailOffsets(races, 10);

  const showRaceCounter = phase >= 2;
  const showCostStat = phase >= 3;
  const showSnippet = phase >= 3;
  const racing = phase >= 1;

  return (
    <motion.div
      className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 pt-2"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: easeEntrance }}
    >
      {/* Title block — title/copy on the left, race counter docks
          here on the right at phase 2+ so it never overlaps the lane
          duration labels inside the race-track card. */}
      <div className="flex items-start justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="flex items-center gap-3">
            <Tag tone="orange">The foundation</Tag>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cf-text-subtle">
              cold-start race
            </span>
          </div>
          <h2 className="text-[clamp(26px,3.4vw,48px)] font-medium leading-[1.05] tracking-[-0.035em] text-cf-text">
            Dynamic Workers — the secret sauce.
          </h2>
          <p className="max-w-[64ch] text-[clamp(13px,1.1vw,17px)] leading-[1.5] text-cf-text-muted">
            Code Mode needs a fresh sandbox for every snippet. On
            Cloudflare, that&rsquo;s a <strong className="font-medium text-cf-text">V8 isolate</strong>:
            5&ndash;15 ms to spin up, hundreds of times per second, on every
            edge. Containers and VMs simply can&rsquo;t keep up.
          </p>
        </div>

        {/* Race counter — slides in at phase 2 in its own column so it
            cannot overlap the Container lane's duration display. */}
        <motion.div
          className="pointer-events-none flex shrink-0 flex-col items-end gap-1"
          initial={false}
          animate={{ opacity: showRaceCounter ? 1 : 0, y: showRaceCounter ? 0 : -8 }}
          transition={reduced ? { duration: 0 } : { duration: 0.5, ease: easeButton }}
          aria-hidden={!showRaceCounter}
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-cf-orange">
            V8 isolate
          </div>
          <div className="text-[clamp(28px,3vw,44px)] font-medium leading-none tracking-[-0.04em] text-cf-orange tabular-nums">
            {races.toLocaleString("en-US")}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-muted">
            races completed
          </div>
        </motion.div>
      </div>

      {/* The race track */}
      <div className="relative flex flex-col gap-4 rounded-2xl border border-cf-border bg-cf-bg-200 px-5 pb-6 pt-5 sm:px-7">
        {/* Start / finish header — finish label is anchored over the
            finish line, not floating mid-track. */}
        <div className="relative h-4 font-mono text-[10px] uppercase tracking-[0.18em] text-cf-text-subtle">
          <span className="absolute left-0">Start · cold</span>
          <span
            className="absolute -translate-x-1/2 text-cf-orange"
            style={{ left: `${FINISH_PCT}%` }}
          >
            Finish
          </span>
        </div>

        {RUNNERS.map((runner, idx) => (
          <RunnerLane
            key={runner.kind}
            runner={runner}
            racing={racing}
            phase={phase}
            ghostOffsets={runner.kind === "isolate" ? ghostOffsets : []}
            showGhosts={runner.kind === "isolate" && showRaceCounter}
            staggerIndex={idx}
            reduced={reduced}
          />
        ))}

        {/* Continuous orange finish line (vertical) — overlay across all
            three lanes so the audience reads the goal at a glance. */}
        <div
          className="pointer-events-none absolute bottom-4 top-12 w-[2px] -translate-x-1/2"
          style={{ left: `${FINISH_PCT}%`, background: "var(--color-cf-orange)", opacity: 0.35 }}
          aria-hidden
        />
      </div>

      {/* Bottom row — only revealed in phase 3 so it never overlaps the
          chrome footer in earlier phases. Snippet sits on the left
          (compact, mono) and the cost callout on the right gets equal
          breathing room — neither crowds the other. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BindingSnippet visible={showSnippet} reduced={reduced} />
        <CostStat visible={showCostStat} reduced={reduced} />
      </div>

      {/* Takeaway band — fills the dead space below the snippet +
          economics row with a single quotable line the audience can
          carry out of the room. Reveals last (phase 3) so it lands
          after the cost stat. */}
      <Takeaway visible={showCostStat} reduced={reduced} />
    </motion.div>
  );
}

// ─── Takeaway band (phase 3) ──────────────────────────────────────────

function Takeaway({
  visible,
  reduced,
}: {
  visible: boolean;
  reduced: boolean;
}) {
  return (
    <motion.div
      className="relative flex items-center justify-center rounded-2xl border border-cf-border bg-cf-bg-200 px-6 py-4"
      initial={false}
      animate={{
        opacity: visible ? 1 : 0,
        y: visible ? 0 : 8,
      }}
      transition={
        reduced ? { duration: 0 } : { duration: 0.55, ease: easeEntrance, delay: 0.15 }
      }
      aria-hidden={!visible}
    >
      <p className="text-center text-[clamp(15px,1.4vw,20px)] font-medium leading-[1.3] tracking-[-0.015em] text-cf-text">
        A new isolate per snippet —{" "}
        <span className="text-cf-orange">every time, everywhere.</span>
      </p>
    </motion.div>
  );
}

// ─── Per-runner ticker (0 → final ms) ─────────────────────────────────

/**
 * Displays a millisecond counter that ticks up from 0 to `final` over
 * `durationS` seconds when `racing` becomes true. Uses framer-motion's
 * imperative `animate()` so the counter's pacing matches the runner's
 * own movement. Reduced-motion snaps directly to the final value.
 *
 * The displayed string respects the runner's preferred format: V8
 * isolate's "5–15 ms" range needs a special path (it's never a
 * single integer), so we fall back to the runner's static `display`
 * once the count reaches its final value.
 */
function TickingMs({
  final,
  durationS,
  racing,
  reduced,
  finalLabel,
  highlight,
}: {
  final: number;
  durationS: number;
  racing: boolean;
  reduced: boolean;
  finalLabel: string;
  highlight: boolean;
}) {
  const mv = useMotionValue(0);
  const [display, setDisplay] = useState<string>("0 ms");
  // Track whether we've reached the final frame, so we can swap to
  // the static `finalLabel` (e.g. "5–15 ms" for V8) instead of a
  // single integer.
  const [done, setDone] = useState(false);

  useMotionValueEvent(mv, "change", (latest) => {
    setDisplay(`${Math.round(latest).toLocaleString("en-US")} ms`);
  });

  useEffect(() => {
    if (!racing) {
      mv.set(0);
      setDone(false);
      setDisplay("0 ms");
      return;
    }
    if (reduced) {
      mv.set(final);
      setDone(true);
      return;
    }
    const controls = animate(mv, final, {
      duration: durationS,
      // V8 is the near-instant runner — use the soft entrance curve
      // so a 0.7 s tick still feels deliberate. The slower runners
      // get the harder accelerate/decelerate to read as "labouring".
      ease: highlight ? easeEntrance : easeActive,
      onComplete: () => setDone(true),
    });
    return () => controls.stop();
  }, [racing, reduced, final, durationS, highlight, mv]);

  return (
    <span
      className={`font-mono text-[12px] tracking-[0.05em] tabular-nums ${
        highlight ? "text-cf-orange" : "text-cf-text-muted"
      }`}
    >
      {done ? finalLabel : display}
    </span>
  );
}

// ─── Motion-trail dots (container + VM) ───────────────────────────────

/**
 * Renders a fading row of small dots BEHIND a runner during phase 1
 * so each track shows a kinetic history rather than a single icon
 * sliding silently. We don't try to animate them — the lane already
 * has plenty of motion via the runner itself; the dots are a static
 * "afterimage" gradient that materialises with the lane.
 *
 * The dot row only appears once the runner has cleared its own width
 * from the start line; before that it would visually swallow the
 * runner badge.
 */
function MotionTrail({
  visible,
  reduced,
  color,
  count = 6,
}: {
  visible: boolean;
  reduced: boolean;
  color: "muted" | "orange";
  count?: number;
}) {
  const stroke =
    color === "orange"
      ? "var(--color-cf-orange)"
      : "var(--color-cf-text-subtle)";
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2"
      aria-hidden
    >
      {Array.from({ length: count }, (_, i) => {
        // Distribute dots between start (~10%) and ~78%, behind where
        // the runner currently sits. Closer-to-runner dots are larger
        // and more opaque, fading toward the start.
        const t = (i + 1) / (count + 1);
        const leftPct = TRACK_LEFT_PCT + t * (TRACK_SPAN_PCT - 4);
        const opacity = 0.08 + (i / (count - 1)) * 0.32;
        const size = 3 + (i / (count - 1)) * 3;
        return (
          <motion.span
            key={i}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${leftPct}%`,
              width: size,
              height: size,
              background: stroke,
            }}
            initial={reduced ? false : { opacity: 0, scale: 0.6 }}
            animate={{
              opacity: visible ? opacity : 0,
              scale: 1,
            }}
            transition={
              reduced
                ? { duration: 0 }
                : { duration: 0.45, delay: 0.05 * i, ease: easeEntrance }
            }
          />
        );
      })}
    </div>
  );
}

// ─── Single runner lane ───────────────────────────────────────────────

function RunnerLane({
  runner,
  racing,
  phase,
  ghostOffsets,
  showGhosts,
  staggerIndex,
  reduced,
}: {
  runner: RunnerSpec;
  racing: boolean;
  phase: number;
  ghostOffsets: number[];
  showGhosts: boolean;
  staggerIndex: number;
  reduced: boolean;
}) {
  // Each runner has its own wall-clock duration computed from its
  // cold-start time. V8 finishes near-instantly (~0.7 s of stage
  // time), VM at ~3.4 s, container at 5 s. The visual ordering of
  // crossings is the whole point of the slide.
  const wallSeconds = wallDurationForRunner(runner.durationMs);
  const targetLeftPct = racing ? FINISH_PCT : TRACK_LEFT_PCT;

  // Pulse is anchored to phase 1 wall-clock — schedule it relative to
  // when this runner crosses so the burst lines up with the finish.
  // After phase 1 the runner is already at the line, so the pulse for
  // non-highlight runners should not re-fire on phase advance.
  const pulseDelay = phase === 1 && !reduced ? wallSeconds : 0;
  const showPulse = racing && !reduced && (runner.highlight || phase === 1);

  return (
    <motion.div
      className="relative flex flex-col gap-1.5"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        duration: 0.45,
        ease: easeEntrance,
        delay: 0.1 + staggerIndex * 0.1,
      }}
    >
      {/* Lane header — name + subtitle on the left ONLY. The duration
          label has moved into the gutter to the RIGHT of the finish
          line (see below) so it can never overlap the orange FINISH
          stroke. */}
      <div className="flex items-baseline gap-2">
        <span
          className={`text-[14px] font-medium tracking-[-0.01em] ${
            runner.highlight ? "text-cf-orange" : "text-cf-text"
          }`}
        >
          {runner.label}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-subtle">
          {runner.subtitle}
        </span>
      </div>

      {/* The track itself */}
      <div className="relative h-11">
        {/* Lane background: dashed groove */}
        <div
          className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2"
          style={{
            backgroundImage: `repeating-linear-gradient(
              to right,
              var(--color-cf-text-subtle) 0,
              var(--color-cf-text-subtle) 6px,
              transparent 6px,
              transparent 12px
            )`,
            opacity: 0.45,
          }}
          aria-hidden
        />
        {/* Start tick */}
        <div
          className="absolute top-1/2 h-6 w-px -translate-y-1/2"
          style={{ left: `${TRACK_LEFT_PCT}%`, background: "var(--color-cf-border)" }}
          aria-hidden
        />

        {/* Motion-trail dots — visible during/after the race so each
            lane reads as kinetic, not just a sliding icon. The V8
            lane has its own ghost-trail loop (below) so we suppress
            this dot row there. */}
        {!runner.highlight && (
          <MotionTrail
            visible={racing}
            reduced={reduced}
            color="muted"
          />
        )}

        {/* Lane time label — anchored in a gutter that sits AFTER the
            finish line. The `calc(FINISH_PCT% + Npx)` expression is
            the structural guarantee against future regressions of the
            label-overlapping-FINISH bug. We pin the label to the
            track's vertical centre so it reads as the runner's
            "arrival time" the moment the icon crosses. */}
        <div
          className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap"
          style={{ left: `calc(${FINISH_PCT}% + ${LABEL_GUTTER_PX}px)` }}
        >
          <TickingMs
            final={runner.durationMs}
            durationS={wallSeconds}
            racing={racing}
            reduced={reduced}
            finalLabel={runner.display}
            highlight={!!runner.highlight}
          />
        </div>

        {/* Per-runner finish pulse — fires once when this runner
            crosses the line. Schedule it to start *exactly* at the
            crossing moment. The V8 (highlight) lane keeps pulsing in
            phases 2/3 to underscore "still going". Reduced-motion
            suppresses the burst entirely. */}
        {showPulse && (
          <motion.div
            key={`pulse-${runner.kind}-${phase}`}
            className="pointer-events-none absolute top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${FINISH_PCT}%`,
              background: runner.highlight
                ? "var(--color-cf-orange)"
                : "var(--color-cf-text-subtle)",
            }}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: [0.4, 2.0], opacity: [0.55, 0] }}
            transition={{
              duration: 0.9,
              ease: easeButton,
              delay: pulseDelay,
              repeat: runner.highlight && phase >= 2 ? Infinity : 0,
              repeatDelay: 0.6,
            }}
            aria-hidden
          />
        )}

        {/* Ghost trails — only the V8 lane uses these. They appear at
            phase 2, after V8 has finished its first lap. */}
        {showGhosts && (
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            {ghostOffsets.map((g, i) => (
              <motion.span
                key={i}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 select-none text-cf-orange"
                style={{
                  left: `${TRACK_LEFT_PCT + g * TRACK_SPAN_PCT}%`,
                  filter: "blur(0.4px)",
                }}
                initial={reduced ? false : { opacity: 0, scale: 0.6 }}
                animate={{
                  opacity: 0.15 + (i / ghostOffsets.length) * 0.45,
                  scale: 0.65 + (i / ghostOffsets.length) * 0.3,
                }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : { duration: 0.4, delay: 0.04 * i, ease: easeEntrance }
                }
              >
                <IsolateGlyph />
              </motion.span>
            ))}
          </div>
        )}

        {/* The runner itself — independent per-runner wall-clock
            duration drives the visible "V8 wins" effect. */}
        <motion.div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 select-none"
          initial={false}
          animate={{ left: `${targetLeftPct}%` }}
          transition={
            reduced
              ? { duration: 0 }
              : { duration: racing ? wallSeconds : 0.3, ease: easeEntrance }
          }
          aria-label={`${runner.label} runner`}
        >
          <div
            className={`flex items-center justify-center rounded-full ${
              runner.highlight
                ? "bg-cf-orange-light text-cf-orange"
                : "bg-cf-bg-100 text-cf-text"
            }`}
            style={{
              width: 38,
              height: 38,
              border: `1.5px solid ${runner.highlight ? "var(--color-cf-orange)" : "var(--color-cf-border)"}`,
            }}
          >
            {runner.glyph}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

// ─── Code snippet card ────────────────────────────────────────────────

function BindingSnippet({
  visible,
  reduced,
}: {
  visible: boolean;
  reduced: boolean;
}) {
  return (
    <motion.div
      initial={false}
      animate={{ opacity: visible ? 1 : 0, x: visible ? 0 : -16 }}
      transition={
        reduced
          ? { duration: 0 }
          : { duration: 0.55, ease: easeEntrance }
      }
      aria-hidden={!visible}
    >
      <CornerBrackets className="relative">
        <div className="rounded-xl border border-cf-border bg-cf-bg-100 p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cf-text-subtle">
              wrangler.jsonc
            </span>
            <Tag tone="muted">Worker Loader</Tag>
          </div>
          <pre className="overflow-x-auto font-mono text-[11px] leading-[1.55] text-cf-text">
            <code>
              <span className="text-cf-text-subtle">
                {"// Spin up a fresh isolate per AI-authored snippet."}
              </span>
              {"\n"}
              <span className="text-cf-text-muted">{"const"}</span>
              {" worker = env."}
              <span className="text-cf-orange">{"LOADER"}</span>
              {".load({\n  "}
              <span className="text-cf-text">{"mainModule"}</span>
              {": "}
              <span className="text-cf-text">{"\"snippet.js\""}</span>
              {",\n  "}
              <span className="text-cf-text">{"modules"}</span>
              {": { "}
              <span className="text-cf-text-subtle">{"/* … */"}</span>
              {" },\n});"}
            </code>
          </pre>
        </div>
      </CornerBrackets>
    </motion.div>
  );
}

// ─── Cost-stat reveal (phase 3) ───────────────────────────────────────

function CostStat({
  visible,
  reduced,
}: {
  visible: boolean;
  reduced: boolean;
}) {
  return (
    <motion.div
      className="relative"
      initial={false}
      animate={{
        opacity: visible ? 1 : 0,
        x: visible ? 0 : 16,
      }}
      transition={
        reduced
          ? { duration: 0 }
          : { duration: 0.55, ease: easeEntrance }
      }
      aria-hidden={!visible}
    >
      <div className="flex h-full flex-col justify-between gap-3 rounded-xl border border-cf-orange bg-cf-orange-light p-4">
        <div className="flex flex-col gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-cf-orange">
            The economics
          </div>
          <p className="text-[clamp(14px,1.3vw,19px)] font-medium leading-[1.35] tracking-[-0.015em] text-cf-text">
            Worker Loader can cost{" "}
            <span className="text-cf-orange">orders of magnitude less</span>{" "}
            than container-based solutions per execution.
          </p>
        </div>
        <div className="flex flex-col gap-0.5 font-mono text-[10px] leading-[1.5] text-cf-text-muted">
          <span>blog.cloudflare.com/code-mode</span>
          <span>developers.cloudflare.com/dynamic-workers/</span>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Slide registry entry ─────────────────────────────────────────────

export const dynamicWorkersSlide: SlideDef = {
  id: "dynamic-workers",
  title: "Dynamic Workers — the secret sauce.",
  layout: "default",
  sectionLabel: "The foundation",
  sectionNumber: "06",
  phases: 3,
  render: ({ phase }) => <RaceTrackBody phase={phase} />,
};
