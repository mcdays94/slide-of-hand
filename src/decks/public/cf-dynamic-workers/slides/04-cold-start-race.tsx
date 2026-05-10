import { motion } from "framer-motion";
import type { SlideDef } from "@/framework/viewer/types";
import { easeEntrance } from "../lib/motion";
import { Tag } from "../components/primitives/Tag";
import { Cite } from "../components/primitives/Cite";
import { SourceFooter } from "../components/primitives/SourceFooter";

/**
 * Slide 04 — Cold-start race.
 *
 * Comparative timeline rather than three independent fill-bars: every bar
 * shares one x-axis (0 → 280 ms), so the audience reads bar LENGTH as
 * cold-start time. Shorter is better. The Isolate bar finishes about
 * 50× sooner than the VM, which finishes 5× sooner than the Container.
 *
 * Animation pacing: every bar fills at the same rate (1 ms of measured
 * time per 4 ms of wall-clock animation). So the Isolate fills in ~20 ms
 * (looks instant), the VM in ~200 ms (a beat), and the Container in
 * ~1000 ms (uncomfortably slow). Same rate of fill, very different
 * durations — that's what makes the visceral point.
 *
 * The Isolate row is wrapped in an OUTER glow container so the brand-
 * orange halo extends around the bar (the previous version put the
 * shadow inside the clipping mask, so the glow was being cropped). The
 * row also carries a small "Cloudflare Workers run on V8 isolates" cue
 * connecting the row to the Cloudflare brand explicitly.
 */

const RUNNERS = [
  {
    label: "Container",
    sublabel: "Docker / OCI image",
    coldStartMs: 250,
    barClass: "bg-cf-text-muted/30",
  },
  {
    label: "Virtual Machine",
    sublabel: "Cloud VM, microVM",
    coldStartMs: 50,
    barClass: "bg-cf-text-muted/40",
  },
  {
    label: "V8 Isolate",
    sublabel: "Worker · Dynamic Worker",
    coldStartMs: 5,
    barClass: "bg-cf-orange",
    isolate: true,
  },
] as const;

const AXIS_MAX_MS = 280;
const AXIS_TICKS = [0, 50, 100, 150, 200, 250];

const MS_PER_MS_OF_TIME = 4;

export const coldStartRaceSlide: SlideDef = {
  id: "cold-start-race",
  title: "Three ways to run code",
  layout: "default",
  sectionLabel: "THE SHAPE OF COMPUTE",
  sectionNumber: "01",
  phases: 1,
  render: ({ phase }) => <ColdStartRaceBody phase={phase} />,
};

function ColdStartRaceBody({ phase }: { phase: number }) {
  const racing = phase >= 1;

  return (
    <div className="mx-auto flex h-full w-full max-w-[1280px] flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Tag tone="muted">Cold start · same job, different runtimes</Tag>
        <h2 className="text-4xl tracking-[-0.04em] sm:text-5xl">
          Three ways to run code.
        </h2>
        <p className="max-w-3xl text-lg text-cf-text-muted">
          Same workload. Wildly different startup costs. The shorter the bar,
          the faster you can spin a fresh, isolated environment up and tear
          it down.
        </p>
      </header>

      {/* Race */}
      <div className="relative flex flex-col gap-7 rounded-md border border-cf-border bg-cf-bg-100 px-8 py-8 sm:px-10">
        <RaceAxis />

        <div className="flex flex-col gap-6">
          {RUNNERS.map((r) => (
            <RaceRow key={r.label} runner={r} racing={racing} />
          ))}
        </div>

        <p className="text-base text-cf-text-muted">
          The V8 Isolate
          <Cite n={1} /> finishes in roughly the time it takes for a single
          TCP round-trip
          <Cite n={2} />.{" "}
          <span className="text-cf-text">
            That's why a Cloudflare Worker can spin one up
            <span className="text-cf-orange"> per request</span> — and why a
            Dynamic Worker can spawn a new one mid-request, on demand.
          </span>
        </p>
      </div>

      <SourceFooter
        sources={[
          {
            n: 1,
            label: "Google · V8 JavaScript engine",
            href: "https://v8.dev/",
          },
          {
            n: 2,
            label: "Cloudflare · Cloud Computing without Containers (2018)",
            href: "https://blog.cloudflare.com/cloud-computing-without-containers/",
          },
        ]}
      />
    </div>
  );
}

/** Top tick-mark axis for the timeline. */
function RaceAxis() {
  return (
    <div className="relative h-6 w-full">
      <div className="absolute inset-x-0 top-2 h-px bg-cf-border" />
      {AXIS_TICKS.map((ms) => {
        const pct = (ms / AXIS_MAX_MS) * 100;
        return (
          <div
            key={ms}
            className="absolute top-0 flex flex-col items-center"
            style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
          >
            <span className="h-2 w-px bg-cf-text-subtle/60" />
            <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
              {ms} ms
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface Runner {
  label: string;
  sublabel: string;
  coldStartMs: number;
  barClass: string;
  isolate?: boolean;
}

function RaceRow({ runner, racing }: { runner: Runner; racing: boolean }) {
  const widthPct = (runner.coldStartMs / AXIS_MAX_MS) * 100;
  const fillDurationSec = (runner.coldStartMs * MS_PER_MS_OF_TIME) / 1000;

  return (
    <div className="grid grid-cols-[220px_minmax(0,1fr)_120px] items-center gap-5">
      {/* Label */}
      <div className="flex flex-col gap-0.5">
        <span
          className={`text-base tracking-[-0.01em] ${
            runner.isolate ? "text-cf-orange" : "text-cf-text"
          }`}
        >
          {runner.label}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
          {runner.sublabel}
        </span>
        {runner.isolate && (
          <motion.span
            className="mt-1.5 inline-flex w-fit items-center gap-1.5 rounded-full border border-cf-orange/30 bg-cf-orange-light px-2 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-cf-orange"
            initial={{ opacity: 0, x: -4 }}
            animate={{
              opacity: racing ? 1 : 0,
              x: racing ? 0 : -4,
            }}
            transition={{
              duration: 0.4,
              delay: racing ? 0.15 + fillDurationSec : 0,
              ease: easeEntrance,
            }}
          >
            <span className="h-1 w-1 rounded-full bg-cf-orange" />
            Cloudflare Workers run here
          </motion.span>
        )}
      </div>

      {/* Track + bar. The bar fill is a single transformed element with
          its glow as a box-shadow ON the same element — no separate
          "halo shell". This keeps the isolate row reading as one
          coloured rectangle with a soft outer cloud, instead of a
          crisp rim against a translucent halo (which used to look
          like two stacked orange shapes). */}
      <div className="relative h-9">
        {/* Background track */}
        <div className="absolute inset-y-0 left-0 right-0 rounded-md bg-cf-bg-200" />

        {/* The bar fill — transform: scaleX 0→1 grows the bar from
            zero. For the Isolate row we apply the glow via box-shadow
            on this same element so there's no inner edge mismatch. */}
        <motion.div
          className={`absolute inset-y-0 left-0 origin-left rounded-md ${runner.barClass}`}
          style={{
            width: `${widthPct}%`,
            transformOrigin: "left center",
            boxShadow: runner.isolate
              ? "0 0 32px 0 rgba(255,72,1,0.65), 0 0 64px 8px rgba(255,72,1,0.25)"
              : undefined,
          }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: racing ? 1 : 0 }}
          transition={{
            duration: fillDurationSec,
            ease: "linear",
            delay: 0.1,
          }}
        />

        {/* Leading-edge shimmer for the Isolate row only — a small
            white pulse riding the bar's right edge as it finishes. */}
        {runner.isolate && (
          <motion.div
            className="pointer-events-none absolute inset-y-0 rounded-r-md bg-white/55 mix-blend-overlay"
            style={{
              left: `calc(${widthPct}% - 6px)`,
              width: 6,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: racing ? [0, 1, 0] : 0 }}
            transition={{
              duration: 0.5,
              delay: racing ? 0.1 + fillDurationSec * 0.6 : 0,
            }}
          />
        )}
      </div>

      {/* Time label */}
      <motion.span
        className={`text-right font-mono text-base tabular-nums ${
          runner.isolate ? "text-cf-orange" : "text-cf-text"
        }`}
        initial={{ opacity: 0, x: -6 }}
        animate={{
          opacity: racing ? 1 : 0,
          x: racing ? 0 : -6,
        }}
        transition={{
          duration: 0.3,
          delay: 0.1 + fillDurationSec,
          ease: easeEntrance,
        }}
      >
        {runner.coldStartMs} ms
      </motion.span>
    </div>
  );
}
