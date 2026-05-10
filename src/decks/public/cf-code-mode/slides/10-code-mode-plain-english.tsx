import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { BookOpen, User, HelpCircle } from "lucide-react";
import type { SlideDef } from "@/framework/viewer/types";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { easeButton, easeEntrance } from "../lib/motion";
import {
  TOTAL_ROUND_TRIPS,
  PHASE_BANNER,
  PHASE_RECIPE,
  stickyNotePlacement,
  roundTripStartTime,
  totalRoundTripDuration,
} from "./_plain-english-logic";

/**
 * 10 — Code Mode, in plain English.
 *
 *   ┌──────────────────────────┐  ┌──────────────────────────┐
 *   │ Traditional MCP          │  │ Code Mode                │
 *   │ ┌──┐  notes…       ┌──┐  │  │ ┌──┐  recipe ─→  ┌──┐    │
 *   │ │A │ ──────────── │L │  │  │ │A │ ←─ binder  │L │    │
 *   │ └──┘  ?─answer   └──┘  │  │ └──┘             └──┘    │
 *   │ Round-trip 8           │  │ One round-trip            │
 *   └──────────────────────────┘  └──────────────────────────┘
 *      [phase 3 banner: "Same answer. 95% fewer tokens."]
 *
 * Polished, infographic-style illustration:
 *   - Two clean icon "stations" (lucide User + BookOpen) sit on a
 *     thin horizontal desk line. No wood-gradients, no stick figures.
 *   - The cream/orange palette is the only colour story.
 *   - All motion runs through easeEntrance / easeButton from
 *     ../lib/motion. No springs, no shimmer, no wiggle.
 *
 * Phase plan:
 *   0 — both columns idle
 *   1 — LEFT (MCP): 8 sticky notes pile up between the two stations,
 *       then a single "answer" note with a "?" flies BACK to the
 *       agent — showing the answer arrives, but only after a lot
 *       of expensive back-and-forth.
 *   2 — RIGHT (Code Mode): recipe card flies once from agent to
 *       library, library "processes" briefly (three pulse dots),
 *       then a clean orange binder flies back to the agent.
 *   3 — token-cost banner reveals.
 *
 * `prefers-reduced-motion: reduce` snaps every animation to its end
 * state — the pile is fully built, the answer note has arrived, the
 * binder is in hand, the banner is visible from phase 3.
 */

export const codeModeInPlainEnglishSlide: SlideDef = {
  id: "code-mode-plain-english",
  title: "Code Mode, in plain English.",
  layout: "default",
  sectionLabel: "Code Mode",
  sectionNumber: "04",
  phases: 3,
  render: ({ phase }) => <Body phase={phase} />,
};

function Body({ phase }: { phase: number }) {
  const reduce = useReducedMotion() ?? false;

  return (
    <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col gap-7 px-10 pb-10 pt-2">
      {/* Eyebrow lede */}
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: easeEntrance }}
        className="max-w-[68ch] text-[clamp(15px,1.25vw,19px)] leading-[1.55] text-cf-text-muted"
      >
        Imagine you're at a library. You need information about a topic.
      </motion.p>

      <div className="grid flex-1 auto-rows-fr grid-cols-1 gap-8 lg:grid-cols-2">
        <Column
          tone="problem"
          title="Traditional MCP"
          subtitle="One question at a time. Eight round-trips."
        >
          <Scene>
            <Stations />
            <FloatingParticles reduce={reduce} />
            <NotesPile phase={phase} reduce={reduce} />
            <AnswerReturnNote phase={phase} reduce={reduce} />
            <RoundTripCounter phase={phase} reduce={reduce} />
          </Scene>
          <DialogueLine
            text={'"Find me books about Y." → "Here’s one. Anything else?"'}
          />
        </Column>

        <Column
          tone="solution"
          title="Code Mode"
          subtitle="One recipe. One binder back."
        >
          <Scene>
            <Stations accent />
            <FloatingParticles reduce={reduce} accent />
            <RecipeRoundtrip phase={phase} reduce={reduce} />
            <SolutionCounter phase={phase} reduce={reduce} />
          </Scene>
          <RecipeBulletList />
        </Column>
      </div>

      <TokenBanner phase={phase} reduce={reduce} />
    </div>
  );
}

/* --------------------------------------------------------------- */
/* Column shell                                                     */
/* --------------------------------------------------------------- */

function Column({
  tone,
  title,
  subtitle,
  children,
}: {
  tone: "problem" | "solution";
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex h-full flex-col">
      <CornerBrackets className="flex h-full flex-col">
        <div className="cf-card flex h-full flex-col gap-4 p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[clamp(18px,1.5vw,22px)] font-medium tracking-[-0.025em] text-cf-text">
              {title}
            </h3>
            <span
              className={
                tone === "solution"
                  ? "font-mono text-[10px] uppercase tracking-[0.14em] text-cf-orange"
                  : "font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-subtle"
              }
            >
              {tone === "solution" ? "→ Code Mode" : "→ Traditional MCP"}
            </span>
          </div>
          <p className="text-[clamp(13px,1.05vw,16px)] leading-[1.55] text-cf-text-muted">
            {subtitle}
          </p>
          <div className="flex flex-1 flex-col gap-4">{children}</div>
        </div>
      </CornerBrackets>
    </div>
  );
}

/* --------------------------------------------------------------- */
/* Scene canvas — clean cream box, two stations, thin desk line     */
/* --------------------------------------------------------------- */

/**
 * Geometric coordinates shared by every animated element on the
 * scene so the two stations and the trajectory between them line
 * up pixel-perfect across MCP / Code Mode columns.
 *
 * Percentages are relative to the scene container (16:9 aspect).
 */
const SCENE = {
  /** Desk line vertical position (% of scene height). */
  deskY: 70,
  /** Agent station horizontal centre (% of scene width). */
  agentX: 14,
  /** Library station horizontal centre (% of scene width). */
  libraryX: 86,
} as const;

function Scene({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-md border border-cf-border-light"
      style={{
        aspectRatio: "16 / 9",
        background: "var(--color-cf-bg-200)",
      }}
    >
      {children}
    </div>
  );
}

/* --------------------------------------------------------------- */
/* Stations: two icon plinths joined by a thin horizontal desk      */
/* --------------------------------------------------------------- */

/**
 * Replaces the old stick-figure illustration with two flat icon
 * "stations" — geometric, minimal, infographic-style. The desk is a
 * single 1-px horizontal rule. The library station glows brand-orange
 * on the Code Mode column (`accent`) so the audience can pre-clock
 * which side is the "fast" path before the animation runs.
 */
function Stations({ accent = false }: { accent?: boolean }) {
  return (
    <>
      {/* Thin horizontal desk line */}
      <div
        className="pointer-events-none absolute left-[6%] right-[6%]"
        style={{
          top: `${SCENE.deskY}%`,
          height: 1,
          background: "var(--color-cf-border)",
        }}
        aria-hidden="true"
      />

      <Station x={SCENE.agentX} icon="agent" label="AGENT" />
      <Station
        x={SCENE.libraryX}
        icon="library"
        label="LIBRARY"
        accent={accent}
      />
    </>
  );
}

function Station({
  x,
  icon,
  label,
  accent = false,
}: {
  x: number;
  icon: "agent" | "library";
  label: string;
  accent?: boolean;
}) {
  const Icon = icon === "agent" ? User : BookOpen;
  const color = accent ? "var(--color-cf-orange)" : "var(--color-cf-text)";
  const tint = accent ? "rgba(255, 72, 1, 0.10)" : "rgba(82, 16, 0, 0.05)";
  return (
    <div
      className="pointer-events-none absolute flex flex-col items-center gap-1.5"
      style={{
        left: `${x}%`,
        top: `${SCENE.deskY}%`,
        transform: "translate(-50%, -100%)",
      }}
      aria-hidden="true"
    >
      <div
        className="flex items-center justify-center rounded-md border"
        style={{
          width: 56,
          height: 56,
          background: tint,
          borderColor: accent
            ? "rgba(255, 72, 1, 0.45)"
            : "var(--color-cf-border)",
        }}
      >
        <Icon size={26} strokeWidth={1.6} color={color} />
      </div>
      <span
        className="font-mono text-[8px] uppercase"
        style={{
          letterSpacing: "0.18em",
          color: accent ? "var(--color-cf-orange)" : "var(--color-cf-text-muted)",
        }}
      >
        {label}
      </span>
    </div>
  );
}

/* --------------------------------------------------------------- */
/* Floating particles — refined, very slow                          */
/* --------------------------------------------------------------- */

/**
 * Three deterministic, ultra-slow particles drifting upward in the
 * scene. Replaces the old eight-mote dust cloud with something
 * calmer — closer to "warm room light" than "messy desk".
 *
 * Fully suppressed under `prefers-reduced-motion: reduce`.
 */
function FloatingParticles({
  reduce,
  accent = false,
}: {
  reduce: boolean;
  accent?: boolean;
}) {
  if (reduce) return null;
  const motes = [
    { left: "32%", top: "55%", size: 3, delay: 0, dur: 11 },
    { left: "52%", top: "42%", size: 2.5, delay: 3.6, dur: 13 },
    { left: "68%", top: "58%", size: 3, delay: 7.2, dur: 12 },
  ];
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {motes.map((m, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full"
          style={{
            left: m.left,
            top: m.top,
            width: m.size,
            height: m.size,
            background: accent
              ? "rgba(255, 72, 1, 0.28)"
              : "rgba(82, 16, 0, 0.16)",
          }}
          initial={{ opacity: 0, y: 0 }}
          animate={{
            opacity: [0, 0.55, 0.55, 0],
            y: [0, -18, -32, -42],
          }}
          transition={{
            duration: m.dur,
            delay: m.delay,
            ease: easeEntrance,
            repeat: Infinity,
            repeatDelay: 4,
          }}
        />
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- */
/* LEFT column — sticky-note pile + counter + answer return         */
/* --------------------------------------------------------------- */

/**
 * Sticky-note pile-up — same `stickyNotePlacement` deterministic
 * coordinates as before, but each note slides in cleanly with
 * `easeEntrance` (no jitter / bounce). Notes start at the agent
 * station and fly to a centre pile at desk height.
 */
function NotesPile({ phase, reduce }: { phase: number; reduce: boolean }) {
  const visible = phase >= 1;
  // Use AnimatePresence so phase regression cleanly removes the pile.
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="notes-pile"
          className="pointer-events-none absolute"
          style={{
            // Pile sits between the two stations, just above the desk.
            left: "50%",
            top: `${SCENE.deskY - 5}%`,
            transform: "translate(-50%, -100%)",
          }}
          aria-hidden="true"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25, ease: easeButton } }}
        >
          <div className="relative h-[2px] w-[2px]">
            {Array.from({ length: TOTAL_ROUND_TRIPS }).map((_, i) => {
              const placement = stickyNotePlacement(i);
              const start = reduce ? 0 : roundTripStartTime(i, 0.4);
              // Alternate origin so the pile reads as discrete
              // back-and-forth round-trips instead of a one-sided
              // dump: even index = question from agent (left),
              // odd index = answer from library (right).
              const fromLeft = i % 2 === 0;
              const originX = fromLeft ? -160 : 160;
              const originRotate = fromLeft
                ? placement.rotate - 8
                : placement.rotate + 8;
              return (
                <motion.div
                  key={i}
                  initial={
                    reduce
                      ? {
                          opacity: 1,
                          x: placement.x,
                          y: placement.y,
                          rotate: placement.rotate,
                        }
                      : {
                          opacity: 0,
                          x: originX,
                          y: placement.y - 24,
                          rotate: originRotate,
                        }
                  }
                  animate={{
                    opacity: 1,
                    x: placement.x,
                    y: placement.y,
                    rotate: placement.rotate,
                  }}
                  transition={{
                    duration: reduce ? 0 : 0.4,
                    delay: start,
                    ease: easeEntrance,
                  }}
                  className="absolute"
                  style={{
                    width: 30,
                    height: 30,
                    marginLeft: -15,
                    marginTop: -15,
                    background: "#FFE69A",
                    border: "1px solid rgba(122, 60, 16, 0.35)",
                    boxShadow:
                      "0 1px 0 rgba(82, 16, 0, 0.10), 0 3px 6px rgba(82, 16, 0, 0.08)",
                    borderRadius: 2,
                  }}
                >
                  {/* Two thin scribble lines on the note */}
                  <div
                    style={{
                      marginTop: 9,
                      marginLeft: 5,
                      width: 18,
                      height: 1.2,
                      background: "rgba(82, 16, 0, 0.45)",
                    }}
                  />
                  <div
                    style={{
                      marginTop: 4,
                      marginLeft: 5,
                      width: 13,
                      height: 1.2,
                      background: "rgba(82, 16, 0, 0.45)",
                    }}
                  />
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * The "answer" sticky note — a single, slightly-bigger note that
 * flies BACK from the library station to the agent station after the
 * pile is fully built. Carries a `?` icon to signal the answer
 * arrived, but only after expensive back-and-forth.
 *
 * This is the missing piece the user flagged in QA: previously the
 * MCP column never closed the loop. Now it does.
 */
function AnswerReturnNote({
  phase,
  reduce,
}: {
  phase: number;
  reduce: boolean;
}) {
  if (phase < 1) return null;

  // Start flying after the last pile note has landed.
  // totalRoundTripDuration() defaults align with NotesPile timings.
  const startDelay = reduce ? 0 : totalRoundTripDuration() + 0.15;
  const flyDuration = reduce ? 0 : 0.7;

  return (
    <motion.div
      className="pointer-events-none absolute z-10"
      style={{
        // Land just to the right of the agent, at desk height.
        left: `${SCENE.agentX + 6}%`,
        top: `${SCENE.deskY - 8}%`,
        transform: "translate(-50%, -50%)",
      }}
      aria-hidden="true"
      initial={
        reduce
          ? { opacity: 1, x: 0, y: 0, rotate: -4 }
          : {
              // Begin at the library station.
              opacity: 0,
              x: `${SCENE.libraryX - (SCENE.agentX + 6)}vw`,
              y: -10,
              rotate: 6,
            }
      }
      animate={{
        opacity: 1,
        x: 0,
        y: 0,
        rotate: -4,
      }}
      transition={{
        duration: flyDuration,
        delay: startDelay,
        ease: easeEntrance,
      }}
    >
      <div
        className="relative flex items-center justify-center"
        style={{
          width: 38,
          height: 38,
          background: "#FFE69A",
          border: "1px solid rgba(122, 60, 16, 0.45)",
          boxShadow:
            "0 1.5px 0 rgba(82, 16, 0, 0.14), 0 4px 10px rgba(82, 16, 0, 0.12)",
          borderRadius: 2,
        }}
      >
        <HelpCircle
          size={18}
          strokeWidth={2}
          color="rgba(82, 16, 0, 0.7)"
        />
      </div>
      {/* Tiny caption below the note */}
      <div
        className="mt-1 font-mono text-[8px] uppercase"
        style={{
          textAlign: "center",
          letterSpacing: "0.18em",
          color: "var(--color-cf-text-muted)",
        }}
      >
        answer
      </div>
    </motion.div>
  );
}

function RoundTripCounter({
  phase,
  reduce,
}: {
  phase: number;
  reduce: boolean;
}) {
  if (phase < 1) return null;
  return (
    <BigCounterBadge
      reduce={reduce}
      total={TOTAL_ROUND_TRIPS}
      label="Round-trips"
      tone="problem"
    />
  );
}

/**
 * Top-right counter that ticks "1 / 2 / … / 8" in lockstep with the
 * pile build-up. Tabular-nums + fixed cell so the digit never resizes.
 */
function BigCounterBadge({
  reduce,
  total,
  label,
  tone,
}: {
  reduce: boolean;
  total: number;
  label: string;
  tone: "problem" | "solution";
}) {
  const isSolution = tone === "solution";
  return (
    <div
      className="absolute right-3 top-3 flex items-center gap-2.5 rounded-md border px-3 py-2 backdrop-blur-[2px]"
      style={{
        background: "rgba(255, 251, 245, 0.92)",
        borderColor: isSolution ? "rgba(255, 72, 1, 0.45)" : "var(--color-cf-border)",
      }}
    >
      <span
        className="font-mono text-[9px] uppercase leading-tight"
        style={{
          letterSpacing: "0.14em",
          color: isSolution
            ? "var(--color-cf-orange)"
            : "var(--color-cf-text-muted)",
          maxWidth: "5.5em",
        }}
      >
        {label}
      </span>
      <span
        className="relative inline-block text-[clamp(20px,2.4vw,30px)] font-medium tracking-[-0.02em]"
        style={{
          fontVariantNumeric: "tabular-nums",
          minWidth: "1.1em",
          textAlign: "center",
          color: isSolution ? "var(--color-cf-orange)" : "var(--color-cf-text)",
          lineHeight: 1,
        }}
      >
        {Array.from({ length: total }).map((_, i) => {
          const visibleStart = reduce ? 0 : roundTripStartTime(i, 0.4) + 0.05;
          const visibleEnd =
            i === total - 1 || reduce
              ? null
              : roundTripStartTime(i + 1, 0.4) + 0.05;
          return (
            <motion.span
              key={i}
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{
                opacity:
                  visibleEnd === null
                    ? [0, 1, 1]
                    : [0, 1, 1, 0],
              }}
              transition={{
                duration:
                  visibleEnd === null
                    ? reduce
                      ? 0
                      : 0.18
                    : (visibleEnd - visibleStart) + 0.18,
                delay: visibleStart,
                ease: easeButton,
                times:
                  visibleEnd === null
                    ? [0, 0.4, 1]
                    : [
                        0,
                        0.18 / Math.max(0.001, (visibleEnd - visibleStart) + 0.18),
                        (visibleEnd - visibleStart) /
                          Math.max(0.001, (visibleEnd - visibleStart) + 0.18),
                        1,
                      ],
              }}
            >
              {i + 1}
            </motion.span>
          );
        })}
        {/* Spacer keeps the absolute layer sized correctly. */}
        <span style={{ visibility: "hidden" }}>{total}</span>
      </span>
    </div>
  );
}

/* --------------------------------------------------------------- */
/* RIGHT column — single recipe round-trip                           */
/* --------------------------------------------------------------- */

/**
 * One smooth, three-act animation:
 *
 *   1. Recipe card flies from agent → library (~0.6s).
 *   2. Library "processes" — three pulse dots above the icon (~0.4s).
 *   3. Binder flies from library → agent (~0.6s) and settles.
 *
 * Replaces the old librarian-walks-off animation, which was clunky
 * and broke the icon-station style. AnimatePresence handles enter /
 * exit cleanly when the user steps phases backwards.
 */
function RecipeRoundtrip({
  phase,
  reduce,
}: {
  phase: number;
  reduce: boolean;
}) {
  if (phase < PHASE_RECIPE) return null;

  // Travel distance from agent to library, expressed as a % of
  // the scene's width so it stays correct across viewport sizes.
  const travelPct = SCENE.libraryX - SCENE.agentX; // 72%

  // Timeline (seconds, post-mount):
  const recipeStart = 0.1;
  const recipeDuration = reduce ? 0 : 0.6;
  const processStart = reduce ? 0 : recipeStart + recipeDuration;
  const processDuration = reduce ? 0 : 0.45;
  const binderStart = reduce ? 0 : processStart + processDuration;
  const binderDuration = reduce ? 0 : 0.7;

  return (
    <>
      {/* Recipe card: agent → library */}
      <motion.div
        className="pointer-events-none absolute z-10"
        style={{
          left: `${SCENE.agentX + 4}%`,
          top: `${SCENE.deskY - 8}%`,
          transform: "translate(-50%, -50%)",
        }}
        aria-hidden="true"
        initial={
          reduce
            ? { opacity: 0, x: 0 }
            : { opacity: 0, x: 0 }
        }
        animate={
          reduce
            ? { opacity: 0 }
            : {
                opacity: [0, 1, 1, 0],
                x: [0, `${travelPct * 0.95}vw`, `${travelPct * 0.95}vw`, `${travelPct * 0.95}vw`],
              }
        }
        transition={{
          duration: recipeDuration + 0.05,
          delay: recipeStart,
          ease: easeEntrance,
          times: [0, 0.85, 0.95, 1],
        }}
      >
        <RecipeCardVisual />
      </motion.div>

      {/* "Processing" pulse dots above the library icon */}
      <ProcessingDots
        startDelay={processStart}
        duration={processDuration}
        reduce={reduce}
      />

      {/* Binder: library → agent (settles in agent's hand).
          Subtle scale settle (0.94 → 1.04 → 1) on top of the
          slide-in gives the binder a "satisfying landing" without
          drifting into jelly-spring territory. */}
      <motion.div
        className="pointer-events-none absolute z-10"
        style={{
          left: `${SCENE.agentX + 6}%`,
          top: `${SCENE.deskY - 8}%`,
          transform: "translate(-50%, -50%)",
        }}
        aria-hidden="true"
        initial={
          reduce
            ? { opacity: 1, x: 0, scale: 1 }
            : { opacity: 0, x: `${travelPct * 0.92}vw`, scale: 0.94 }
        }
        animate={{
          opacity: 1,
          x: 0,
          scale: reduce ? 1 : [0.94, 1.04, 1],
        }}
        transition={{
          duration: binderDuration,
          delay: binderStart,
          ease: easeEntrance,
          times: reduce ? undefined : [0, 0.78, 1],
        }}
      >
        <BinderVisual />
      </motion.div>
    </>
  );
}

/** Tiny recipe-card visual — header rule + four bullet rows. */
function RecipeCardVisual() {
  return (
    <div
      style={{
        width: 64,
        height: 44,
        background: "var(--color-cf-bg-100)",
        border: "1.5px solid var(--color-cf-orange)",
        borderRadius: 3,
        padding: "5px 6px",
        boxShadow:
          "0 2px 0 rgba(255, 72, 1, 0.18), 0 4px 8px rgba(255, 72, 1, 0.12)",
      }}
    >
      <div
        style={{
          height: 1.4,
          width: "78%",
          background: "var(--color-cf-orange)",
          opacity: 0.85,
          borderRadius: 1,
        }}
      />
      {[0.62, 0.7, 0.55, 0.46].map((width, i) => (
        <div
          key={i}
          style={{
            marginTop: 3,
            display: "flex",
            alignItems: "center",
            gap: 3,
          }}
        >
          <span
            style={{
              width: 3,
              height: 3,
              borderRadius: "50%",
              background: "var(--color-cf-orange)",
              opacity: 0.85,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              height: 1.2,
              width: `${width * 100}%`,
              background: "rgba(82, 16, 0, 0.55)",
              borderRadius: 1,
            }}
          />
        </div>
      ))}
    </div>
  );
}

/** Small orange binder — same visual as before, slightly cleaner. */
function BinderVisual() {
  return (
    <>
      <div
        style={{
          width: 32,
          height: 42,
          background: "var(--color-cf-orange)",
          borderRadius: "2px 1px 1px 2px",
          boxShadow:
            "inset -3px 0 0 rgba(0,0,0,0.18), 0 2px 0 rgba(82,16,0,0.18), 0 4px 10px rgba(255, 72, 1, 0.20)",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 4,
            top: 4,
            width: 1,
            height: 34,
            background: "rgba(255,255,255,0.4)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 9,
            top: 14,
            width: 18,
            height: 13,
            background: "var(--color-cf-bg-100)",
            borderRadius: 1,
          }}
        >
          <div
            style={{
              marginTop: 3,
              marginLeft: 2,
              width: 14,
              height: 1,
              background: "rgba(82, 16, 0, 0.55)",
            }}
          />
          <div
            style={{
              marginTop: 2,
              marginLeft: 2,
              width: 10,
              height: 1,
              background: "rgba(82, 16, 0, 0.45)",
            }}
          />
        </div>
      </div>
      <div
        className="mt-1 font-mono text-[8px] uppercase tracking-[0.18em] text-cf-orange"
        style={{ textAlign: "center" }}
      >
        answer
      </div>
    </>
  );
}

/**
 * Three orange dots that pulse above the library icon while it's
 * "processing" the recipe — clean replacement for the old librarian
 * walk-off animation.
 */
function ProcessingDots({
  startDelay,
  duration,
  reduce,
}: {
  startDelay: number;
  duration: number;
  reduce: boolean;
}) {
  if (reduce) return null;
  return (
    <div
      className="pointer-events-none absolute flex gap-1"
      style={{
        left: `${SCENE.libraryX}%`,
        top: `${SCENE.deskY - 26}%`,
        transform: "translate(-50%, -50%)",
      }}
      aria-hidden="true"
    >
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block rounded-full"
          style={{
            width: 5,
            height: 5,
            background: "var(--color-cf-orange)",
          }}
          initial={{ opacity: 0, y: 2 }}
          animate={{
            opacity: [0, 0.9, 0.9, 0],
            y: [2, -2, -2, 2],
          }}
          transition={{
            duration,
            delay: startDelay + i * 0.08,
            ease: easeButton,
            times: [0, 0.25, 0.75, 1],
          }}
        />
      ))}
    </div>
  );
}

/** Code Mode "1 round-trip" badge — appears on phase 2. */
function SolutionCounter({
  phase,
  reduce,
}: {
  phase: number;
  reduce: boolean;
}) {
  if (phase < PHASE_RECIPE) return null;
  return (
    <motion.div
      className="absolute right-3 top-3 flex items-center gap-2.5 rounded-md border px-3 py-2 backdrop-blur-[2px]"
      style={{
        background: "rgba(255, 251, 245, 0.92)",
        borderColor: "rgba(255, 72, 1, 0.45)",
      }}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reduce ? 0 : 0.3,
        delay: reduce ? 0 : 0.05,
        ease: easeEntrance,
      }}
    >
      <span
        className="font-mono text-[9px] uppercase leading-tight text-cf-orange"
        style={{ letterSpacing: "0.14em", maxWidth: "5.5em" }}
      >
        Round-trips
      </span>
      <span
        className="text-[clamp(20px,2.4vw,30px)] font-medium tracking-[-0.02em] text-cf-orange"
        style={{
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
        }}
      >
        1
      </span>
    </motion.div>
  );
}

/* --------------------------------------------------------------- */
/* Dialogue line + recipe bullet list                                */
/* --------------------------------------------------------------- */

function DialogueLine({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-cf-border bg-cf-bg-300 px-4 py-2.5 font-mono text-[clamp(11px,1vw,13px)] leading-[1.6] text-cf-text-muted">
      {text}
    </div>
  );
}

/**
 * The literal recipe — four bullet steps that the agent's program
 * runs in a single round-trip. Anchors the recipe-card visual above.
 *
 * Each step reveals top-to-bottom on a 120ms stagger once the recipe
 * phase opens, so the audience reads the steps in order rather than
 * absorbing the whole list at once.
 */
function RecipeBulletList() {
  const reduce = useReducedMotion() ?? false;
  const steps = [
    "List zones",
    "For each zone, get records",
    "Sort by record count",
    "Return top 3",
  ];
  return (
    <div
      className="rounded-md border px-4 py-3"
      style={{
        background: "var(--color-cf-orange-light)",
        borderColor: "rgba(255, 72, 1, 0.4)",
      }}
    >
      <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-cf-orange">
        Recipe card
      </div>
      <ol className="m-0 flex flex-col gap-0.5 p-0 font-mono text-[clamp(11px,1vw,13px)] leading-[1.55] text-cf-orange">
        {steps.map((step, i) => (
          <motion.li
            key={i}
            className="flex items-baseline gap-2"
            initial={reduce ? false : { opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              duration: reduce ? 0 : 0.35,
              delay: reduce ? 0 : 0.15 + i * 0.12,
              ease: easeEntrance,
            }}
          >
            <span
              className="font-mono"
              style={{
                fontVariantNumeric: "tabular-nums",
                opacity: 0.7,
                minWidth: "1.4em",
              }}
            >
              {i + 1}.
            </span>
            <span>{step}</span>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

/* --------------------------------------------------------------- */
/* Phase-3 banner                                                    */
/* --------------------------------------------------------------- */

function TokenBanner({
  phase,
  reduce,
}: {
  phase: number;
  reduce: boolean;
}) {
  // Always rendered to keep the layout slot reserved → no jump
  // when the banner appears.
  const visible = phase >= PHASE_BANNER;
  return (
    <motion.div
      animate={{
        opacity: visible ? 1 : 0,
        y: visible ? 0 : 6,
      }}
      initial={false}
      transition={{
        duration: reduce ? 0 : 0.45,
        ease: easeEntrance,
      }}
      aria-hidden={!visible}
      className="relative w-full"
    >
      <CornerBrackets>
        <div
          className="cf-card flex w-full flex-col items-center justify-center gap-2 px-6 py-5 sm:flex-row sm:gap-x-8"
          style={{
            background: "var(--color-cf-orange-light)",
            borderColor: "rgba(255, 72, 1, 0.4)",
          }}
        >
          <span className="font-mono text-[clamp(10px,0.9vw,12px)] uppercase tracking-[0.22em] text-cf-orange">
            Same answer
          </span>
          <span
            aria-hidden="true"
            className="hidden h-5 w-px sm:block"
            style={{ background: "rgba(255, 72, 1, 0.4)" }}
          />
          <span
            className="text-center text-[clamp(20px,2.2vw,32px)] font-medium tracking-[-0.025em] text-cf-orange"
            aria-label="Code Mode used 95 percent fewer tokens"
          >
            Code Mode used{" "}
            <span
              style={{
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              95% fewer
            </span>{" "}
            tokens.
          </span>
        </div>
      </CornerBrackets>
    </motion.div>
  );
}
