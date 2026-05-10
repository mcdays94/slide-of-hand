import { motion } from "framer-motion";
import type { ReactNode } from "react";
import type { SlideDef } from "@/framework/viewer/types";
import { easeEntrance, staggerContainer, staggerItem } from "../lib/motion";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { Tag } from "../components/primitives/Tag";
import { Bot, Wand2, Building2, ExternalLink } from "lucide-react";

/**
 * Slide 10 — Three Use Cases (the "why this matters" pay-off).
 *
 * Cards now use the cf-code-mode-slides accent-per-card pattern: each
 * card has its own brand-extension colour driving the border tint, the
 * box-shadow halo, the icon plate, the icon, and the kicker label. The
 * three colours together give the slide its punchier identity without
 * leaving the design system (all three colours are existing tokens).
 *
 * Phase 0: headline only.
 * Phase 1: three cards stagger in. Each carries an animated motif in
 *          the upper-right and 1–2 Cloudflare source links the audience
 *          can follow up on.
 */

export const useCasesSlide: SlideDef = {
  id: "use-cases",
  title: "Why this matters",
  layout: "default",
  sectionLabel: "WHY THIS MATTERS",
  sectionNumber: "04",
  phases: 1,
  render: ({ phase }) => <UseCasesBody phase={phase} />,
};

interface SourceLink {
  label: string;
  href: string;
}

interface UseCase {
  kicker: string;
  /** CSS colour string — typically a `var(--color-cf-…)` token. */
  accent: string;
  /** Lower-opacity background for the icon plate / motif. */
  accentTint: string;
  icon: ReactNode;
  motif: ReactNode;
  headline: string;
  description: string;
  nameDrop: string;
  sources: SourceLink[];
}

const CASES: UseCase[] = [
  {
    kicker: "01 · AI",
    accent: "var(--color-cf-info)", // brand blue
    accentTint: "color-mix(in srgb, var(--color-cf-info) 12%, transparent)",
    icon: <Bot strokeWidth={1.5} className="h-7 w-7" />,
    motif: <ThinkingDots color="var(--color-cf-info)" />,
    headline: "AI agents that run code.",
    description:
      "When an LLM writes a function, it needs somewhere safe to execute it. Dynamic Workers spin up a fresh, locked-down isolate for each invocation — and tear it down when done.",
    nameDrop: "Cursor · Claude Code · Devin",
    sources: [
      {
        label: "Sandboxing AI agents, 100× faster",
        href: "https://blog.cloudflare.com/dynamic-workers/",
      },
      {
        label: "Sandbox SDK reference",
        href: "https://developers.cloudflare.com/sandbox/",
      },
    ],
  },
  {
    kicker: "02 · BUILDERS",
    accent: "var(--color-cf-media)", // brand purple
    accentTint: "color-mix(in srgb, var(--color-cf-media) 12%, transparent)",
    icon: <Wand2 strokeWidth={1.5} className="h-7 w-7" />,
    motif: <SparkleGrid color="var(--color-cf-media)" />,
    headline: "Vibe-coding platforms.",
    description:
      "Generate an app in chat. Deploy it before the user finishes their sentence. Each generation is its own Worker — instant URL, no infra to babysit.",
    nameDrop: "Bolt · v0 · Lovable",
    sources: [
      {
        label: "Dynamic Workers docs",
        href: "https://developers.cloudflare.com/dynamic-workers/",
      },
      {
        label: "AI vibe-coding platform reference",
        href: "https://developers.cloudflare.com/reference-architecture/diagrams/ai/ai-vibe-coding-platform/",
      },
    ],
  },
  {
    kicker: "03 · SAAS",
    accent: "var(--color-cf-orange)", // brand orange
    accentTint: "color-mix(in srgb, var(--color-cf-orange) 12%, transparent)",
    icon: <Building2 strokeWidth={1.5} className="h-7 w-7" />,
    motif: <TenantGrid color="var(--color-cf-orange)" />,
    headline: "Multi-tenant SaaS.",
    description:
      "Every customer ships their own logic, their own webhooks, their own automations. One Worker per tenant, isolated by default. No per-tenant infrastructure to provision.",
    nameDrop: "Per-tenant code without per-tenant servers",
    sources: [
      {
        label: "Workers for Platforms",
        href: "https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/",
      },
      {
        label: "Dynamic Workflows · per-tenant",
        href: "https://developers.cloudflare.com/dynamic-workers/usage/dynamic-workflows/",
      },
    ],
  },
];

function UseCasesBody({ phase }: { phase: number }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-[1320px] flex-col">
      {/* Headline (phase 0+) */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: easeEntrance }}
      >
        <Tag tone="orange">04 · Why this matters</Tag>
        <h2 className="mt-4 max-w-4xl text-4xl leading-[1.05] tracking-[-0.035em] text-cf-text sm:text-5xl">
          Three places this changes{" "}
          <span className="text-cf-orange">everything</span>.
        </h2>
        <p className="mt-3 max-w-2xl text-base text-cf-text-muted sm:text-lg">
          Spawn-on-demand isolation isn&rsquo;t a niche capability — it&rsquo;s
          the foundation under three of the fastest-moving categories in
          software right now.
        </p>
      </motion.div>

      {/* Cards (phase 1) */}
      <motion.div
        className="mt-7 grid grid-cols-1 gap-5 lg:grid-cols-3"
        variants={staggerContainer}
        initial="initial"
        animate={phase >= 1 ? "animate" : "initial"}
      >
        {CASES.map((c, i) => (
          <motion.div key={i} variants={staggerItem} className="flex">
            <CornerBrackets
              className="cf-card relative flex w-full flex-col overflow-hidden p-0 transition-[border-style] duration-200 hover:border-dashed"
              inset={-3}
              style={{
                borderColor: `color-mix(in srgb, ${c.accent} 35%, var(--color-cf-border))`,
                boxShadow: `0 0 0 1px color-mix(in srgb, ${c.accent} 18%, transparent), 0 14px 38px -28px ${c.accent}`,
              }}
            >
              {/* Top accent stripe in the card's accent colour */}
              <div
                className="h-1 w-full"
                style={{
                  background: `linear-gradient(to right, ${c.accent}, color-mix(in srgb, ${c.accent} 40%, transparent))`,
                }}
                aria-hidden
              />

              {/* Decorative motif in the upper-right of the card */}
              <div className="pointer-events-none absolute right-5 top-5 opacity-60">
                {c.motif}
              </div>

              <div className="flex flex-1 flex-col p-6">
                {/* Kicker label + icon */}
                <div className="flex items-center justify-between">
                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.18em]"
                    style={{ color: c.accent }}
                  >
                    {c.kicker}
                  </span>
                  <span
                    className="inline-flex h-12 w-12 items-center justify-center rounded-xl border"
                    style={{
                      background: c.accentTint,
                      borderColor: `color-mix(in srgb, ${c.accent} 35%, transparent)`,
                      color: c.accent,
                    }}
                  >
                    {c.icon}
                  </span>
                </div>

                {/* Headline */}
                <h3 className="mt-5 text-2xl leading-tight tracking-[-0.025em] text-cf-text">
                  {c.headline}
                </h3>

                {/* Description */}
                <p className="mt-2.5 text-[15px] leading-relaxed text-cf-text-muted">
                  {c.description}
                </p>

                {/* Spacer pushes name-drop + sources to bottom */}
                <div className="flex-1" aria-hidden />

                {/* Name-drop */}
                <div
                  className="mt-5 border-t border-dashed pt-3"
                  style={{
                    borderColor: `color-mix(in srgb, ${c.accent} 25%, var(--color-cf-border))`,
                  }}
                >
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-cf-text-subtle">
                    {c.nameDrop}
                  </span>
                </div>

                {/* Sources */}
                <ul className="mt-2.5 flex flex-col gap-1.5">
                  {c.sources.map((s) => (
                    <li key={s.href}>
                      <a
                        href={s.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="group inline-flex items-center gap-1.5 text-[12px] text-cf-text-muted underline-offset-4 hover:underline"
                        style={
                          {
                            "--hover-color": c.accent,
                          } as React.CSSProperties
                        }
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = c.accent;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = "";
                        }}
                        data-interactive
                      >
                        <ExternalLink
                          strokeWidth={1.5}
                          className="h-3 w-3 opacity-60 group-hover:opacity-100"
                        />
                        <span>{s.label}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </CornerBrackets>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}

/* ─── Decorative motifs ─── */

function ThinkingDots({ color }: { color: string }) {
  return (
    <svg width="60" height="60" viewBox="0 0 60 60" fill="none" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.circle
          key={i}
          cx={12 + i * 18}
          cy={30}
          r={3}
          fill={color}
          initial={{ opacity: 0.15 }}
          animate={{ opacity: [0.15, 0.85, 0.15] }}
          transition={{
            duration: 1.6,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.25,
          }}
        />
      ))}
    </svg>
  );
}

function SparkleGrid({ color }: { color: string }) {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden>
      {[
        { x: 16, y: 16, d: 0 },
        { x: 48, y: 20, d: 0.4 },
        { x: 28, y: 44, d: 0.7 },
        { x: 50, y: 50, d: 1.1 },
      ].map((s, i) => (
        <motion.path
          key={i}
          d={`M ${s.x} ${s.y - 5} L ${s.x + 1} ${s.y - 1} L ${s.x + 5} ${s.y} L ${s.x + 1} ${s.y + 1} L ${s.x} ${s.y + 5} L ${s.x - 1} ${s.y + 1} L ${s.x - 5} ${s.y} L ${s.x - 1} ${s.y - 1} Z`}
          fill={color}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{
            opacity: [0, 0.9, 0],
            scale: [0.5, 1.1, 0.5],
          }}
          transition={{
            duration: 2.2,
            repeat: Infinity,
            ease: "easeInOut",
            delay: s.d,
          }}
          style={{ transformOrigin: `${s.x}px ${s.y}px` }}
        />
      ))}
    </svg>
  );
}

function TenantGrid({ color }: { color: string }) {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden>
      {Array.from({ length: 9 }).map((_, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        return (
          <motion.rect
            key={i}
            x={8 + col * 18}
            y={8 + row * 18}
            width={12}
            height={12}
            rx={2}
            fill={color}
            initial={{ opacity: 0.15 }}
            animate={{ opacity: [0.15, 0.7, 0.15] }}
            transition={{
              duration: 2.4,
              repeat: Infinity,
              ease: "easeInOut",
              delay: ((col + row) % 3) * 0.4,
            }}
          />
        );
      })}
    </svg>
  );
}
