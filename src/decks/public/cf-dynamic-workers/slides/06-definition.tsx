import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Highlight } from "prism-react-renderer";
import { Sparkles, Zap } from "lucide-react";
import type { SlideDef } from "@/framework/viewer/types";
import { easeEntrance } from "../lib/motion";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { Tag } from "../components/primitives/Tag";
import { DECK_DARK_THEME } from "../lib/code-theme";

/**
 * Slide 06 — What's a Dynamic Worker?
 *
 * Two-act slide. Top: parent → child diagram with a pulsing aura, a
 * traveling particle, and a ripple-on-spawn effect on the child box.
 * Bottom: a black, syntax-highlighted code callout with four annotation
 * badges. Each badge appears as its own phase, slides in from the
 * right with a slight glow, and is connected to its target code line
 * by an SVG arrow.
 *
 * Phases:
 *   0  Headline
 *   1  Diagram: parent box appears + arrow + child box ripples in
 *   2  Code box appears (black, syntax highlighted)
 *   3  Badge 1 — Permission to spawn
 *   4  Badge 2 — Spawn the Worker
 *   5  Badge 3 — The code to run
 *   6  Badge 4 — Send it work
 *
 * Layout-stable: the code-box + badge column has reserved space from
 * phase 2 onwards, so each badge fading in does NOT shift the code.
 */

export const definitionSlide: SlideDef = {
  id: "what-is-a-dynamic-worker",
  title: "What's a Dynamic Worker?",
  layout: "default",
  sectionLabel: "WHAT'S A DYNAMIC WORKER?",
  sectionNumber: "02",
  phases: 6,
  render: ({ phase }) => <DefinitionBody phase={phase} />,
};

/* ─── Diagram ─── */

function DefinitionBody({ phase }: { phase: number }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-[1280px] flex-col gap-5 overflow-hidden">
      <header className="flex flex-col gap-2">
        <Tag tone="muted">Definition</Tag>
        <h2 className="text-3xl leading-[1.1] tracking-[-0.035em] sm:text-4xl md:text-[42px]">
          A <span className="text-cf-orange">Dynamic Worker</span> is a server
          that another server can{" "}
          <span className="text-cf-orange">spawn on demand</span>.
        </h2>
      </header>

      {/* Diagram row */}
      <ParentChildDiagram phase={phase} />

      {/* Code + badges row */}
      <CodeWithBadges phase={phase} />
    </div>
  );
}

const DIAGRAM_VIEWBOX = { w: 1100, h: 200 } as const;
const ARROW = { x1: 320, x2: 780, y: 100 } as const;

function ParentChildDiagram({ phase }: { phase: number }) {
  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${DIAGRAM_VIEWBOX.w} ${DIAGRAM_VIEWBOX.h}`}
        className="block h-[200px] w-full"
        aria-hidden
      >
        <defs>
          <radialGradient id="parent-aura" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--color-cf-orange)" stopOpacity="0.20" />
            <stop offset="60%" stopColor="var(--color-cf-orange)" stopOpacity="0.05" />
            <stop offset="100%" stopColor="var(--color-cf-orange)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Parent aura — pulses gently to give the slide breath */}
        <motion.ellipse
          cx={170}
          cy={ARROW.y}
          rx={150}
          ry={70}
          fill="url(#parent-aura)"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0.65, 1, 0.65] }}
          transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Arrow shaft */}
        <motion.path
          d={`M ${ARROW.x1} ${ARROW.y} L ${ARROW.x2 - 14} ${ARROW.y}`}
          stroke="var(--color-cf-orange)"
          strokeWidth={2.5}
          strokeLinecap="round"
          fill="none"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{
            pathLength: phase >= 1 ? 1 : 0,
            opacity: phase >= 1 ? 1 : 0,
          }}
          transition={{ duration: 0.7, ease: easeEntrance }}
        />

        {/* Arrowhead */}
        <motion.polygon
          points={`${ARROW.x2 - 14},${ARROW.y - 9} ${ARROW.x2},${ARROW.y} ${ARROW.x2 - 14},${ARROW.y + 9}`}
          fill="var(--color-cf-orange)"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 1 ? 1 : 0 }}
          transition={{
            duration: 0.25,
            delay: phase >= 1 ? 0.55 : 0,
            ease: easeEntrance,
          }}
        />

        {/* Traveling particle along the shaft — runs forever after phase 1
            to communicate "this is a live communication channel". */}
        {phase >= 1 && (
          <motion.circle
            r={5}
            fill="var(--color-cf-orange)"
            initial={{ cx: ARROW.x1, cy: ARROW.y, opacity: 0 }}
            animate={{
              cx: [ARROW.x1, ARROW.x2 - 12, ARROW.x2 - 12],
              opacity: [0, 1, 0],
            }}
            transition={{
              duration: 2.0,
              repeat: Infinity,
              ease: "easeInOut",
              repeatDelay: 0.4,
              delay: 1.0,
            }}
          />
        )}

        {/* Mono label centred under the arrow */}
        <motion.text
          x={(ARROW.x1 + ARROW.x2) / 2}
          y={ARROW.y + 32}
          textAnchor="middle"
          className="font-mono"
          fill="var(--color-cf-text-muted)"
          fontSize={15}
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 1 ? 1 : 0 }}
          transition={{
            duration: 0.35,
            delay: phase >= 1 ? 0.4 : 0,
            ease: easeEntrance,
          }}
        >
          env.LOADER.load(…)
        </motion.text>

        {/*
         * The Dynamic Worker box's "I just spawned" pulse used to live
         * here — two SVG circles centred on the badge's midpoint. Two
         * problems with that: (1) a circular halo around a rectangular
         * badge looked off-shape and visually off-centre because the
         * SVG viewBox doesn't track the DOM-positioned badge, and (2)
         * the halo extended ~120 px above and below a ~70 px badge,
         * dwarfing the thing it was meant to highlight. The pulse now
         * lives as a CSS-driven sibling of the badge itself (see
         * <PerimeterPulse> below), where it can match the badge's
         * actual rectangle perfectly.
         */}
      </svg>

      {/* Parent Worker box */}
      <div
        className="absolute"
        style={{
          left: "5%",
          top: "50%",
          width: "22%",
          transform: "translateY(-50%)",
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: easeEntrance }}
        >
          <CornerBrackets
            className="cf-card relative px-4 py-4"
            inset={-3}
            style={{
              boxShadow:
                "0 0 0 1px color-mix(in srgb, var(--color-cf-orange) 18%, transparent), 0 14px 38px -28px var(--color-cf-orange)",
            }}
          >
            <div className="flex items-center gap-3">
              <span
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg"
                style={{
                  background:
                    "color-mix(in srgb, var(--color-cf-orange) 14%, transparent)",
                  color: "var(--color-cf-orange)",
                }}
              >
                <Sparkles size={18} strokeWidth={1.6} />
              </span>
              <div className="flex flex-col">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-cf-text-muted">
                  Your
                </span>
                <span className="text-base tracking-[-0.01em] text-cf-text">
                  Worker
                </span>
              </div>
            </div>
          </CornerBrackets>
        </motion.div>
      </div>

      {/* Child Worker box. The badge itself is the same as before; the
         pulsing aura is now a stack of <PerimeterPulse> siblings layered
         BEHIND it (z-0) that share the badge's exact rectangle, so the
         "I just spawned" beat reads as the badge broadcasting outward
         in its own shape rather than a circle around it. */}
      <div
        className="absolute"
        style={{
          left: "73%",
          top: "50%",
          width: "23%",
          transform: "translateY(-50%)",
        }}
      >
        <motion.div
          className="relative"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{
            opacity: phase >= 1 ? 1 : 0,
            scale: phase >= 1 ? 1 : 0.8,
          }}
          transition={{
            duration: 0.5,
            ease: easeEntrance,
            delay: phase >= 1 ? 0.55 : 0,
          }}
          style={{ transformOrigin: "left center" }}
        >
          {/* Perimeter pulses — three offset rings so the badge always
             has at least one mid-flight, giving a continuous rolling
             outward beat rather than a single periodic blip. */}
          {phase >= 1 && (
            <>
              <PerimeterPulse delay={0.6} />
              <PerimeterPulse delay={1.4} />
              <PerimeterPulse delay={2.2} />
            </>
          )}
          <CornerBrackets
            className="cf-card relative z-10 px-4 py-4"
            inset={-3}
            style={{
              boxShadow:
                "0 0 0 1px color-mix(in srgb, var(--color-cf-orange) 30%, transparent), 0 0 28px 0 rgba(255,72,1,0.3), 0 14px 38px -20px rgba(255,72,1,0.5)",
              borderColor:
                "color-mix(in srgb, var(--color-cf-orange) 35%, var(--color-cf-border))",
            }}
          >
            <div className="flex items-center gap-3">
              <span
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg"
                style={{
                  background:
                    "color-mix(in srgb, var(--color-cf-orange) 18%, transparent)",
                  color: "var(--color-cf-orange)",
                }}
              >
                <Zap size={18} strokeWidth={1.6} />
              </span>
              <div className="flex flex-col">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-cf-orange">
                  Dynamic Worker
                </span>
                <span className="font-mono text-[12px] tracking-[-0.01em] text-cf-text">
                  iso_4f3a91c8
                </span>
              </div>
            </div>
          </CornerBrackets>
        </motion.div>
      </div>

      {/* "5 ms" badge above the arrow.
       *
       * Two-element structure is load-bearing: the OUTER static div
       * owns the centring (`left: 50%` + `translate(-50%, -50%)`),
       * the INNER motion.div owns the framer entrance animation.
       *
       * Why split: framer-motion's `animate={{ y: ... }}` writes its
       * own `transform` to the element, which OVERRIDES any static
       * `transform` we set on the same element. With a single
       * `<motion.div style={{ left: "50%", transform: translate(-50%, -50%) }}>`
       * the centring transform got clobbered the moment the animation
       * mounted, leaving the pill's LEFT edge anchored at 50% of the
       * container instead of its CENTRE — visibly off to the right of
       * the arrow tip. Splitting the responsibilities keeps both
       * working.
       */}
      <div
        className="absolute"
        style={{
          left: "50%",
          top: "20%",
          transform: "translate(-50%, -50%)",
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{
            opacity: phase >= 1 ? 1 : 0,
            y: phase >= 1 ? 0 : 6,
          }}
          transition={{
            duration: 0.35,
            delay: phase >= 1 ? 0.7 : 0,
            ease: easeEntrance,
          }}
        >
          <span
            className="inline-flex items-center rounded-full border bg-cf-orange-light px-3 py-1 font-mono text-xs font-medium tracking-[0.04em] text-cf-orange"
            style={{
              borderColor:
                "color-mix(in srgb, var(--color-cf-orange) 30%, transparent)",
              boxShadow: "0 0 16px 0 rgba(255,72,1,0.35)",
            }}
          >
            ~5&nbsp;ms
          </span>
        </motion.div>
      </div>
    </div>
  );
}

/* ─── Perimeter pulse ─── */

/**
 * A single rolling rectangle pulse that grows from the badge's exact
 * rectangle outward. The element shares the badge's bounding box via
 * `inset: 0` and a matching `border-radius`, then animates `scale` +
 * `opacity` to look like a ring shedding outward.
 *
 * `transformOrigin: center center` is critical so the scale doesn't
 * drift the ring off-axis — the badge's shape stays centred on itself
 * as it expands.
 */
function PerimeterPulse({ delay }: { delay: number }) {
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 rounded-md"
      style={{
        border: "1.5px solid var(--color-cf-orange)",
        transformOrigin: "center center",
      }}
      initial={{ scale: 1, opacity: 0 }}
      animate={{
        scale: [1, 1.18, 1.32],
        opacity: [0, 0.55, 0],
      }}
      transition={{
        duration: 2.4,
        repeat: Infinity,
        ease: "easeOut",
        delay,
      }}
      aria-hidden
    />
  );
}

/* ─── Code + Badges ─── */

interface BadgeSpec {
  /** Index into the visible code lines. */
  line: number;
  title: string;
  body: string;
  /** Phase at which this badge reveals. */
  revealPhase: number;
}

const CODE_TEXT = `// wrangler.jsonc
"worker_loaders": [{ "binding": "LOADER" }]

// worker entry
const worker = env.LOADER.load({
  mainModule: "code.js",
  modules: { "code.js": userCode },
});
return worker.getEntrypoint().fetch(request);`;

const BADGES: BadgeSpec[] = [
  {
    line: 1, // "worker_loaders": [{ "binding": "LOADER" }]
    title: "Permission to spawn",
    body: "Tells Cloudflare this Worker is allowed to load other Workers at runtime — exposes a tool we name LOADER.",
    revealPhase: 3,
  },
  {
    line: 4, // const worker = env.LOADER.load({
    title: "Spawn the Worker",
    body: "One call. A brand-new V8 isolate is created and ready to run code in ~5 ms.",
    revealPhase: 4,
  },
  {
    line: 6, // modules: { "code.js": userCode },
    title: "The code to run",
    body: "userCode is just a string. It can come from a database, a chat input, an LLM — anything.",
    revealPhase: 5,
  },
  {
    line: 8, // return worker.getEntrypoint().fetch(request);
    title: "Send it work",
    body: "Forward the inbound HTTP request into the spawned Worker. It runs, returns a response, then disposes.",
    revealPhase: 6,
  },
];

/**
 * Layout: 2-column flex layout. Code box on the left at a fixed width,
 * cards stacked in a flex column on the right with their natural
 * heights. Connector arrows are SVG bezier paths drawn between
 * measured DOM coordinates — no fixed-position guesswork.
 *
 * Why measured coordinates rather than computed offsets: cards have
 * variable content heights, so their top edges are determined by the
 * flex stack, not by their target line index. Drawing arrows from
 * "code-line right edge" to "card left edge" therefore needs real
 * DOM positions, refreshed on resize and on phase changes.
 */
/**
 * Geometry constants for the code box. LINE_HEIGHT was 22 px; bumped to
 * 30 px so the four annotated lines sit further apart vertically. That
 * spreads the arrow exits along the right edge of the code box so they
 * read as a fan rather than a bunched cluster on the left side.
 */
const LINE_HEIGHT = 30;
const CODE_PAD_TOP = 16;
/** Right padding of the code box (its `p-4` Tailwind class = 16 px). */
const CODE_PAD_RIGHT = 16;

interface ConnectorPath {
  d: string;
  visible: boolean;
}

function CodeWithBadges({ phase }: { phase: number }) {
  const codeShown = phase >= 2;
  const containerRef = useRef<HTMLDivElement>(null);
  const codeBoxRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [paths, setPaths] = useState<ConnectorPath[]>(
    BADGES.map(() => ({ d: "", visible: false })),
  );
  const [overlayBox, setOverlayBox] = useState({ width: 0, height: 0 });

  const recompute = useCallback(() => {
    const container = containerRef.current;
    const codeBox = codeBoxRef.current;
    if (!container || !codeBox) return;

    const containerRect = container.getBoundingClientRect();
    const codeBoxRect = codeBoxRef.current!.getBoundingClientRect();

    setOverlayBox({
      width: containerRect.width,
      height: containerRect.height,
    });

    const next: ConnectorPath[] = BADGES.map((b, i) => {
      const card = cardRefs.current[i];
      if (!card) return { d: "", visible: false };
      const cardRect = card.getBoundingClientRect();

      // Anchor the start of the arrow to the RIGHT EDGE OF THE HIGHLIGHTED
      // LINE BOX (i.e. inside the code box's padding), not to the code
      // box's outer right edge. The user reported the arrow appeared to
      // emerge from "behind" the code box — that's because the previous
      // implementation started the path at the box's outer border, which
      // is 16 px past where the visible highlight stops. With this
      // adjustment the arrow exits cleanly from the orange-bordered
      // line.
      const codeY =
        codeBoxRect.top +
        CODE_PAD_TOP +
        b.line * LINE_HEIGHT +
        LINE_HEIGHT / 2 -
        containerRect.top;
      const codeX =
        codeBoxRect.right - containerRect.left - CODE_PAD_RIGHT + 4;
      // The +4 lifts the start a hair to the right of the highlight
      // border so the arrow doesn't overlap the orange perimeter — it
      // looks like the line has reached out toward the card.

      const cardX = cardRect.left - containerRect.left;
      const cardY = cardRect.top + cardRect.height / 2 - containerRect.top;

      // Smooth cubic bezier with horizontal tangents at both ends so
      // the line leaves the code box and enters the card horizontally.
      const dx = cardX - codeX;
      const cx1 = codeX + Math.max(40, dx * 0.5);
      const cx2 = cardX - Math.max(40, dx * 0.5);
      const headSize = 7;
      const tipX = cardX - 2;
      const shaftEndX = tipX - headSize;
      const visible = phase >= b.revealPhase;

      return {
        d: `M ${codeX.toFixed(1)} ${codeY.toFixed(1)} C ${cx1.toFixed(1)} ${codeY.toFixed(
          1,
        )}, ${cx2.toFixed(1)} ${cardY.toFixed(1)}, ${shaftEndX.toFixed(1)} ${cardY.toFixed(1)}`,
        visible,
      };
    });

    setPaths(next);
  }, [phase]);

  // Recompute synchronously on phase change, then poll every animation
  // frame for ~700 ms so the arrows track each card's entrance animation
  // (Framer-motion transitions are 0.45 s; we cover a hair past that).
  useLayoutEffect(() => {
    recompute();
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      recompute();
      if (performance.now() - start < 700) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [recompute]);

  useEffect(() => {
    const ro = new ResizeObserver(() => recompute());
    if (containerRef.current) ro.observe(containerRef.current);
    if (codeBoxRef.current) ro.observe(codeBoxRef.current);
    cardRefs.current.forEach((c) => c && ro.observe(c));
    window.addEventListener("resize", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [recompute]);

  return (
    <motion.div
      ref={containerRef}
      className="relative grid min-h-0 w-full flex-1 grid-cols-[minmax(0,520px)_minmax(0,1fr)] gap-16"
      initial={{ opacity: 0, y: 12 }}
      animate={{
        opacity: codeShown ? 1 : 0,
        y: codeShown ? 0 : 12,
      }}
      transition={{ duration: 0.4, ease: easeEntrance }}
    >
      {/* Code column */}
      <BlackCodeBox phase={phase} codeBoxRef={codeBoxRef} />

      {/* Badge column — flex stack pushed slightly toward the right edge
          of the column (items-end + capped width) so the cards sit a bit
          further right of the code box. justify-between spreads the
          cards vertically across the column so the arrow exits fan out
          on the code-box side too.
          
          The pr-3 / pb-3 / pt-1 padding is load-bearing: every badge
          carries a 14 px outer glow, and the slide root has
          overflow-hidden to prevent vertical run-off into the footer.
          Without this padding the glow on the right side and the
          bottom card's glow at the bottom both hit the clipping edge
          and look like the ring is being chopped off. */}
      <div className="flex flex-col items-end justify-between gap-3 pt-1 pr-3 pb-3">
        {BADGES.map((b, i) => (
          <Badge
            key={b.line}
            spec={b}
            phase={phase}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
          />
        ))}
      </div>

      {/* Connector arrows — absolutely positioned overlay sized to the
          full container so SVG and DOM share coordinates 1:1. z-20 so
          the arrows render ABOVE the code box (rendering order alone
          isn't enough when the user expects them to "emerge from" the
          highlighted line). */}
      <svg
        className="pointer-events-none absolute inset-0 z-20"
        width={overlayBox.width || undefined}
        height={overlayBox.height || undefined}
        viewBox={
          overlayBox.width && overlayBox.height
            ? `0 0 ${overlayBox.width} ${overlayBox.height}`
            : undefined
        }
        preserveAspectRatio="none"
        aria-hidden
      >
        {paths.map((p, i) => (
          <Connector key={i} d={p.d} visible={p.visible} />
        ))}
      </svg>
    </motion.div>
  );
}

function BlackCodeBox({
  phase,
  codeBoxRef,
}: {
  phase: number;
  codeBoxRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={codeBoxRef}
      // Self-start so the box's height tracks its content rather than
      // stretching to fill the parent grid cell. The border carries a
      // visible orange tint and the outer box-shadow gives a subtle
      // warm halo so the code box reads as "this is the centerpiece"
      // even on the warm-cream slide background. Explicit text color
      // is critical: without it, plain identifiers inherit the
      // surrounding `text-cf-text` (warm dark brown), which is nearly
      // unreadable on the near-black code surface — that bug ate a
      // session of polish before this comment existed.
      className="self-start rounded-md p-4 font-mono text-[13px] leading-relaxed text-[#fffbf5]"
      style={{
        backgroundColor: "#1c1b19",
        border: "1px solid color-mix(in srgb, var(--color-cf-orange) 22%, #2a2825)",
        boxShadow:
          "0 0 0 1px rgba(255, 72, 1, 0.06), 0 18px 48px -28px rgba(255, 72, 1, 0.45), inset 0 1px 0 0 rgba(255, 251, 245, 0.04)",
        lineHeight: `${LINE_HEIGHT}px`,
      }}
    >
      <Highlight code={CODE_TEXT} language="tsx" theme={DECK_DARK_THEME}>
        {({ style, tokens, getLineProps, getTokenProps }) => (
          // `style` from the render prop carries the theme's `plain`
          // color/backgroundColor. We MUST apply it — without it,
          // tokens that fall through to "plain" inherit the parent's
          // `color`, which on the deck is warm dark brown.
          <pre className="m-0 p-0" style={{ ...style, background: "transparent" }}>
            {tokens.map((line, i) => {
              const { key: _lineKey, ...lineProps } = getLineProps({ line });
              const isAnnotated = BADGES.some(
                (b) => b.line === i && phase >= b.revealPhase,
              );
              return (
                <div
                  key={i}
                  {...lineProps}
                  className={`px-2 transition-all duration-300 ${
                    isAnnotated ? "rounded-md" : ""
                  }`}
                  style={{
                    height: LINE_HEIGHT,
                    lineHeight: `${LINE_HEIGHT}px`,
                    boxSizing: "border-box",
                    // Annotated lines get an orange perimeter box plus a
                    // slight outer glow. The bg fill is intentionally
                    // very subtle — the user wanted a "box around the
                    // line" rather than a coloured rectangle on top.
                    border: isAnnotated
                      ? "1px solid rgba(255, 72, 1, 0.55)"
                      : "1px solid transparent",
                    background: isAnnotated
                      ? "rgba(255, 72, 1, 0.06)"
                      : undefined,
                    boxShadow: isAnnotated
                      ? "0 0 14px 0 rgba(255, 72, 1, 0.35), inset 0 0 8px 0 rgba(255, 72, 1, 0.08)"
                      : undefined,
                  }}
                >
                  {line.length === 0 ? (
                    <span>&nbsp;</span>
                  ) : (
                    line.map((token, k) => {
                      const { key: _tokenKey, ...tokenProps } = getTokenProps({
                        token,
                      });
                      return <span key={k} {...tokenProps} />;
                    })
                  )}
                </div>
              );
            })}
          </pre>
        )}
      </Highlight>
    </div>
  );
}

const Badge = function Badge({
  spec,
  phase,
  ref,
}: {
  spec: BadgeSpec;
  phase: number;
  ref: (el: HTMLDivElement | null) => void;
}) {
  const visible = phase >= spec.revealPhase;
  return (
    <motion.div
      ref={ref}
      data-testid="slide-06-badge"
      className="w-full max-w-[420px] rounded-lg border border-cf-border bg-cf-bg-100 px-4 py-3"
      style={{
        // Glow tightened from 24 → 14 so the ring stays inside the
        // column's pr-3/pb-3 buffer (see comment on the column above).
        boxShadow: visible
          ? "0 0 0 1px rgba(255,72,1,0.3), 0 0 14px 0 rgba(255,72,1,0.22)"
          : "none",
      }}
      initial={{ opacity: 0, x: 24, scale: 0.96 }}
      animate={{
        opacity: visible ? 1 : 0,
        x: visible ? 0 : 24,
        scale: visible ? 1 : 0.96,
      }}
      transition={{ duration: 0.45, ease: easeEntrance }}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-cf-orange">
          {spec.title}
        </span>
      </div>
      <p className="mt-1 text-[13px] leading-snug text-cf-text-muted">
        {spec.body}
      </p>
    </motion.div>
  );
};

function Connector({ d, visible }: { d: string; visible: boolean }) {
  if (!d) return null;
  return (
    <g>
      <motion.path
        d={d}
        stroke="var(--color-cf-orange)"
        strokeWidth={1.6}
        strokeLinecap="round"
        fill="none"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{
          pathLength: visible ? 1 : 0,
          opacity: visible ? 0.9 : 0,
        }}
        transition={{ duration: 0.45, ease: easeEntrance }}
      />
      {/* Tiny arrowhead at the path's end. We re-derive the tip + tail
          from the d-string's last 'C' segment endpoint. */}
      <ArrowHead d={d} visible={visible} />
    </g>
  );
}

function ArrowHead({ d, visible }: { d: string; visible: boolean }) {
  // Parse the d-string for the path's last point — that's where the
  // shaft ends and the arrowhead's BASE sits. The arrowhead extends
  // HEAD_LEN further toward the card.
  const match = d.match(/,\s*([0-9.\-]+)\s+([0-9.\-]+)$/);
  if (!match) return null;
  const baseX = parseFloat(match[1]);
  const baseY = parseFloat(match[2]);
  const HEAD_LEN = 7;
  const HEAD_HALF = 4.5;
  const tipX = baseX + HEAD_LEN;
  return (
    <motion.polygon
      points={`${baseX},${baseY - HEAD_HALF} ${tipX},${baseY} ${baseX},${baseY + HEAD_HALF}`}
      fill="var(--color-cf-orange)"
      initial={{ opacity: 0 }}
      animate={{ opacity: visible ? 0.95 : 0 }}
      transition={{
        duration: 0.2,
        delay: visible ? 0.32 : 0,
        ease: easeEntrance,
      }}
    />
  );
}


