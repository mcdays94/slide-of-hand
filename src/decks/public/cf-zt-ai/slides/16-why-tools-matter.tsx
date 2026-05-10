import { motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  Boxes,
  Cog,
  MessageSquare,
} from "lucide-react";
import type { SlideDef } from "@/framework/viewer/types";
import { Tag } from "../components/primitives/Tag";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { Cite } from "../components/primitives/Cite";
import { SourceFooter } from "../components/primitives/SourceFooter";
import { easeEntrance, staggerContainer, staggerItem } from "../lib/motion";

/* =====================================================================
 * Slide 16 · Why agents need tools
 *
 * Concept primer that lands AFTER the MCP Server Portal slide. The
 * portal answers "what does Cloudflare ship?" — this slide answers
 * "why does a portal of MCP servers matter at all?". A bare LLM is a
 * frozen text predictor; tools are what turn it into something that
 * can read and change your real systems. MCP is increasingly how
 * those tools get standardised, and the portal you just saw is one
 * place to govern them.
 *
 * Replaces the earlier `mcpInActionSlide` ("Watch an agent use your
 * tools"), whose headline read like a Cloudflare-specific product
 * capability — agent-runtime observability — that Cloudflare does not
 * actually ship.
 * ===================================================================== */

interface ColumnPoint {
  text: string;
  hint?: string;
}

// "Without tools" is NOT "guessing". A modern LLM with web access will
// scrape the docs and reason its way to a working answer — but it pays
// real costs (tokens, latency, variance) on every single call, and it
// interprets your conventions differently each run. Tools don't make
// the LLM smarter; they put it on rails.
const LLM_ALONE: ColumnPoint[] = [
  {
    text: "Re-scrapes your docs / API surface on every call",
    hint: "tokens spent on rediscovery",
  },
  {
    text: "Each call interprets your conventions its own way",
    hint: "shape varies between runs",
  },
  {
    text: "Eventually arrives at a plausible answer",
    hint: "high variance, harder to test",
  },
];

const LLM_WITH_TOOLS: ColumnPoint[] = [
  {
    text: "Typed functions baked with your house style",
    hint: "tools encode best-practice once",
  },
  {
    text: "Same input, same output shape, every time",
    hint: "predictable, testable, ship-ready",
  },
  {
    text: "No rediscovery of stable knowledge",
    hint: "tokens spent on the actual task",
  },
];

export const whyToolsMatterSlide: SlideDef = {
  id: "why-tools-matter",
  title: "Why agents need tools",
  layout: "default",
  sectionLabel: "EMPOWER",
  sectionNumber: "05",
  render: () => <WhyToolsMatterBody />,
};

function WhyToolsMatterBody() {
  return (
    <div className="mx-auto flex h-full w-full max-w-[1480px] flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Tag tone="ai">Empower · Concept</Tag>
          <h2 className="mt-3 text-3xl tracking-[-0.035em] sm:text-5xl">
            Without tools, an LLM gets there{" "}
            <span className="text-cf-text-subtle">eventually</span>. With
            tools, it's <span className="text-cf-orange">on rails</span>.
          </h2>
          <p className="mt-2 max-w-3xl text-cf-text-muted">
            A modern LLM with web access can scrape your docs and reason its
            way to a working answer. The problem is the path: every call
            pays the cost in tokens for rediscovery, and interprets your
            conventions differently each time. Typed tools encode the right
            approach once, so the model just calls them. Same input shape,
            same output shape, every time.
          </p>
        </div>
      </div>

      {/* Two-column comparison */}
      <motion.div
        className="grid grid-cols-1 gap-5 lg:grid-cols-2"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        {/* LEFT: LLM alone — gets there, but the path is non-deterministic */}
        <motion.div variants={staggerItem}>
          <CornerBrackets className="cf-card flex h-full flex-col gap-4 p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cf-bg-300 text-cf-text-muted">
                <MessageSquare className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
                  No tools
                </span>
                <h3 className="text-xl tracking-[-0.02em] text-cf-text">
                  Will figure it out
                </h3>
              </div>
              <span className="ml-auto rounded-full border border-cf-border bg-cf-bg-200 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-cf-text-subtle">
                Variable, expensive
              </span>
            </div>
            <p className="text-sm text-cf-text-muted">
              The model still gets the job done. It will scrape, reason and
              compose its way to an answer that works. But the path is
              non-deterministic, the cost compounds, and you can't test for
              behaviour you can't predict.
            </p>
            <ul className="mt-1 flex flex-col gap-3">
              {LLM_ALONE.map((p) => (
                <li
                  key={p.text}
                  className="flex items-start gap-3 border-b border-dashed border-cf-border pb-3 last:border-0 last:pb-0"
                >
                  <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-cf-bg-200 text-cf-text-subtle">
                    <BookOpen className="h-3 w-3" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="block text-sm text-cf-text">{p.text}</span>
                    {p.hint && (
                      <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-wider text-cf-text-subtle">
                        {p.hint}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <span className="mt-auto rounded-md bg-cf-bg-200 px-3 py-2 font-mono text-[11px] text-cf-text-muted">
              Best at: ad-hoc exploration, one-shot tasks, rephrasing.
            </span>
          </CornerBrackets>
        </motion.div>

        {/* RIGHT: LLM + tools — opinionated, predictable, on-rails */}
        <motion.div variants={staggerItem}>
          <CornerBrackets
            className="cf-card flex h-full flex-col gap-4 rounded-xl border-2 border-cf-orange/40 p-6"
            inset={-3}
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cf-orange-light text-cf-orange">
                <Cog className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-orange">
                  With tools
                </span>
                <h3 className="text-xl tracking-[-0.02em] text-cf-text">
                  On rails
                </h3>
              </div>
              <span className="ml-auto rounded-full border border-cf-orange/40 bg-cf-orange-light px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-cf-orange">
                Opinionated · Predictable
              </span>
            </div>
            <p className="text-sm text-cf-text-muted">
              Tools are typed functions you author. They bake your house
              style (names, validation, edge-cases) into something the
              model calls instead of re-deriving. Same call, same shape,
              same behaviour, every time.
            </p>
            <ul className="mt-1 flex flex-col gap-3">
              {LLM_WITH_TOOLS.map((p) => (
                <li
                  key={p.text}
                  className="flex items-start gap-3 border-b border-dashed border-cf-border pb-3 last:border-0 last:pb-0"
                >
                  <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-cf-orange-light text-cf-orange">
                    <Cog className="h-3 w-3" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="block text-sm text-cf-text">{p.text}</span>
                    {p.hint && (
                      <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-wider text-cf-orange/80">
                        {p.hint}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <span className="mt-auto rounded-md bg-cf-orange-light px-3 py-2 font-mono text-[11px] text-cf-orange">
              Best at: production work where shape and behaviour must be repeatable.
            </span>
          </CornerBrackets>
        </motion.div>
      </motion.div>

      {/* MCP explainer strip */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.4, ease: easeEntrance }}
        className="rounded-2xl border border-dashed border-cf-orange/40 bg-cf-orange-light/60 p-5"
      >
        <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-center">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-cf-orange text-white">
              <Boxes className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-orange">
                Standard
              </span>
              <h4 className="text-base font-medium tracking-[-0.015em] text-cf-text">
                Model Context Protocol (MCP)
                <Cite n={1} href="https://modelcontextprotocol.io/" />
              </h4>
            </div>
          </div>
          <p className="flex-1 text-sm text-cf-text-muted">
            An open protocol from Anthropic
            <Cite
              n={2}
              href="https://www.anthropic.com/news/model-context-protocol"
            />, released in November 2024 for exposing tools to agents.
            One client plus N servers replaces N × M custom
            integrations. The portal on the previous slide is one
            place to govern, audit, and gate them.
          </p>

          {/* Compact diagram: agent → mcp client → mcp servers → tools */}
          <div className="flex flex-shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-cf-text-muted">
            <DiagramPill label="Agent" />
            <ArrowRight className="h-3 w-3 text-cf-orange/70" />
            <DiagramPill label="MCP client" />
            <ArrowRight className="h-3 w-3 text-cf-orange/70" />
            <DiagramPill label="MCP server" emphasised />
            <ArrowRight className="h-3 w-3 text-cf-orange/70" />
            <DiagramPill label="Your tools" />
          </div>
        </div>
      </motion.div>

      <SourceFooter
        sources={[
          {
            n: 1,
            label: "Model Context Protocol · modelcontextprotocol.io",
            href: "https://modelcontextprotocol.io/",
          },
          {
            n: 2,
            label: "Anthropic · Introducing MCP (Nov 2024)",
            href: "https://www.anthropic.com/news/model-context-protocol",
          },
        ]}
      />
    </div>
  );
}

function DiagramPill({
  label,
  emphasised,
}: {
  label: string;
  emphasised?: boolean;
}) {
  return (
    <span
      className={[
        "rounded-md border px-2 py-1 font-mono text-[10px] tracking-[0.06em]",
        emphasised
          ? "border-cf-orange/60 bg-white text-cf-orange shadow-cf-card"
          : "border-cf-border bg-white text-cf-text",
      ].join(" ")}
    >
      {label}
    </span>
  );
}
