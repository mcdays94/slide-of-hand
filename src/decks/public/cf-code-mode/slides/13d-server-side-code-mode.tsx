import { motion } from "framer-motion";
import { Search, Play, ArrowRight, Server } from "lucide-react";
import type { SlideDef } from "@/framework/viewer/types";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { Tag } from "../components/primitives/Tag";
import { easeEntrance } from "../lib/motion";

/**
 * 13d — Server-side Code Mode (the "looking forward" punchline).
 *
 * Recreates the headline of the Cloudflare blog post
 * (https://blog.cloudflare.com/code-mode-mcp/, Feb 2026):
 *
 *   - Code Mode worked so well, we put it in the SERVER too.
 *   - The new Cloudflare MCP exposes just two tools: `search()` and
 *     `execute()`, both taking JS code as input.
 *   - The SERVER runs the agent's code in a Dynamic Worker isolate.
 *   - Result: the entire 2,500+ endpoint Cloudflare API in ~1,000
 *     tokens of context — a 99.9% reduction.
 *
 * Layout:
 *
 *   ┌─ headline + description ────────────────────────────────────────┐
 *   │                                                                  │
 *   │  ┌─ The two-tool surface ─┐    ┌─ The dramatic numbers ───────┐ │
 *   │  │ search(code) {…}       │    │  2,500+   →   1,000          │ │
 *   │  │ execute(code) {…}      │    │  endpoints     tokens        │ │
 *   │  │ ~1,000 tokens          │    │  (1.17M w/o CM)  (with CM)  │ │
 *   │  └────────────────────────┘    └──────────────────────────────┘ │
 *   │                                                                  │
 *   │  ┌─ Flow ──────────────────────────────────────────────────────┐│
 *   │  │  Agent ─ writes JS ─→  MCP server  ─ runs in isolate ─→  …  ││
 *   │  │   ↓                       ↓                          ↓     ││
 *   │  │  "find DDoS endpoints"  search(...)         filtered list  ││
 *   │  └─────────────────────────────────────────────────────────────┘│
 *   └──────────────────────────────────────────────────────────────────┘
 */

export const serverSideCodeModeSlide: SlideDef = {
  id: "server-side-code-mode",
  title: "Server-side Code Mode.",
  layout: "default",
  sectionLabel: "The foundation",
  sectionNumber: "06",
  phases: 0,
  render: () => <Body />,
};

function Body() {
  return (
    <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col gap-5 pt-2">
      {/* Eyebrow */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: easeEntrance }}
        className="flex flex-wrap items-center gap-3"
      >
        <Tag tone="orange">Looking forward</Tag>
        <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-cf-text-subtle">
          blog.cloudflare.com/code-mode-mcp · Feb 2026
        </span>
      </motion.div>

      {/* Headline */}
      <motion.h2
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: easeEntrance, delay: 0.08 }}
        className="text-[clamp(34px,4.4vw,64px)] font-medium leading-[1.0] tracking-[-0.035em] text-cf-text"
      >
        Code Mode worked so well…
        <br />
        we put it in the{" "}
        <span className="text-cf-orange">server</span> too.
      </motion.h2>

      {/* Description — full slide width */}
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: easeEntrance, delay: 0.18 }}
        className="text-[clamp(14px,1.2vw,18px)] leading-snug text-cf-text-muted"
      >
        Cloudflare&rsquo;s new MCP server covers the{" "}
        <span className="text-cf-text">entire Cloudflare API</span> —
        DNS, Workers, Zero Trust, R2, and 2,500+ more endpoints —
        through just two tools. The agent never sees the spec; it sends
        small JavaScript snippets and the server runs them in a
        Dynamic Worker isolate, on the spot.
      </motion.p>

      {/* Main content row: code + numbers */}
      <div className="grid min-h-0 flex-1 grid-cols-[1.2fr_1fr] gap-5">
        {/* Left: the two-tool surface */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-subtle">
            <span className="block h-[1px] w-6 bg-cf-text-subtle/40" />
            two tools · the entire API
          </div>

          {/* Tool 1: search */}
          <ToolCard
            icon={<Search size={20} strokeWidth={1.8} />}
            name="search(code)"
            blurb="Hand the agent a JS function. It walks the OpenAPI spec, filters by product, path, or tag, and returns just the endpoints it needs. The full spec never enters the model context."
            example={`async () => {
  const out = [];
  for (const [p, m] of Object.entries(spec.paths)) {
    if (p.includes('rulesets'))
      out.push({ method: 'GET', path: p });
  }
  return out;
}`}
          />

          {/* Tool 2: execute */}
          <ToolCard
            icon={<Play size={20} strokeWidth={1.8} />}
            name="execute(code)"
            blurb="Run JS that calls cloudflare.request(). The agent can chain calls, paginate, branch on responses — all in one execution, sandboxed in a fresh isolate."
            example={`async () => {
  const r = await cloudflare.request({
    method: 'GET',
    path: \`/zones/\${zoneId}/rulesets\`,
  });
  return r.result.map(rs => rs.name);
}`}
          />
        </div>

        {/* Right: dramatic numbers + flow */}
        <div className="flex flex-col gap-4">
          {/* Numbers card */}
          <CornerBrackets className="block">
            <div className="rounded-2xl border border-cf-border bg-cf-bg-200 px-6 py-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-orange">
                The cost of one MCP server
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
                    Without Code Mode
                  </div>
                  <div className="mt-1 text-[clamp(28px,2.8vw,42px)] font-medium leading-none tracking-[-0.02em] text-cf-error line-through decoration-2">
                    1.17M
                  </div>
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-muted">
                    tokens · 2,500+ tools
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
                    With server-side CM
                  </div>
                  <div className="mt-1 text-[clamp(28px,2.8vw,42px)] font-medium leading-none tracking-[-0.02em] text-cf-orange">
                    ~1,000
                  </div>
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-muted">
                    tokens · 2 tools
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 rounded-lg px-3 py-2"
                style={{ background: "var(--color-cf-success-bg)" }}
              >
                <span className="text-[clamp(15px,1.4vw,22px)] font-medium tracking-[-0.02em] text-cf-success">
                  −99.9% tokens
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-muted">
                  same answers, no spec in context
                </span>
              </div>
            </div>
          </CornerBrackets>

          {/* Flow diagram */}
          <CornerBrackets className="block flex-1">
            <div className="flex h-full flex-col gap-3 rounded-2xl border border-cf-border bg-cf-bg-100 px-5 py-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-subtle">
                How it flows
              </div>

              <FlowStep
                index="01"
                from="agent"
                to="server"
                label="Sends search() with a JS filter"
              />
              <FlowStep
                index="02"
                from="server"
                to="server"
                label="Runs JS in a fresh V8 isolate against the full spec"
              />
              <FlowStep
                index="03"
                from="server"
                to="agent"
                label="Returns just the matching endpoints"
              />
              <FlowStep
                index="04"
                from="agent"
                to="server"
                label="Sends execute() with a chained API call"
              />
              <FlowStep
                index="05"
                from="server"
                to="agent"
                label="Returns the final result — pagination, retries, all server-side"
                isLast
              />
            </div>
          </CornerBrackets>
        </div>
      </div>
    </div>
  );
}

function ToolCard({
  icon,
  name,
  blurb,
  example,
}: {
  icon: React.ReactNode;
  name: string;
  blurb: string;
  example: string;
}) {
  return (
    <CornerBrackets className="block">
      <div className="flex flex-col gap-2 rounded-xl border border-cf-border bg-cf-bg-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-cf-orange bg-cf-orange-light text-cf-orange">
            {icon}
          </span>
          <div className="flex flex-col">
            <code className="font-mono text-[clamp(15px,1.3vw,20px)] font-medium tracking-[-0.01em] text-cf-text">
              {name}
            </code>
          </div>
        </div>
        <p className="text-[clamp(12px,1vw,15px)] leading-snug text-cf-text-muted">
          {blurb}
        </p>
        <pre
          className="mt-1 overflow-hidden rounded-lg border border-cf-border bg-cf-bg-200 p-3 font-mono text-[11px] leading-snug text-cf-text"
          style={{ tabSize: 2 }}
        >
          {example}
        </pre>
      </div>
    </CornerBrackets>
  );
}

function FlowStep({
  index,
  from,
  to,
  label,
  isLast = false,
}: {
  index: string;
  from: "agent" | "server";
  to: "agent" | "server";
  label: string;
  isLast?: boolean;
}) {
  const arrowDir = from === to ? "self" : from === "agent" ? "right" : "left";
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-cf-text-subtle">
        {index}
      </span>
      <Endpoint side="agent" active={from === "agent" || to === "agent"} />
      <span className="flex-1 px-1">
        {arrowDir === "right" ? (
          <ArrowRight
            size={16}
            strokeWidth={1.8}
            className="text-cf-orange"
          />
        ) : arrowDir === "left" ? (
          <ArrowRight
            size={16}
            strokeWidth={1.8}
            className="rotate-180 text-cf-success"
          />
        ) : (
          <span className="block w-full text-center font-mono text-[10px] uppercase tracking-[0.14em] text-cf-orange">
            ⤺ in-isolate
          </span>
        )}
      </span>
      <Endpoint side="server" active={from === "server" || to === "server"} />
      <span
        className={`min-w-0 flex-1 text-[clamp(11px,0.95vw,14px)] leading-snug ${
          isLast ? "text-cf-text" : "text-cf-text-muted"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

function Endpoint({
  side,
  active,
}: {
  side: "agent" | "server";
  active: boolean;
}) {
  return (
    <span
      className="flex h-7 w-[78px] shrink-0 items-center justify-center gap-1 rounded-md border font-mono text-[10px] uppercase tracking-[0.12em]"
      style={{
        background: active ? "var(--color-cf-bg-200)" : "var(--color-cf-bg-100)",
        borderColor: active ? "var(--color-cf-orange)" : "var(--color-cf-border)",
        color: active ? "var(--color-cf-text)" : "var(--color-cf-text-subtle)",
      }}
    >
      {side === "server" ? <Server size={11} strokeWidth={1.8} /> : null}
      {side}
    </span>
  );
}
