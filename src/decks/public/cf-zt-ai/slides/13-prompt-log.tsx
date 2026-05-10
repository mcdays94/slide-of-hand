import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Database, Filter, ShieldAlert, ShieldCheck } from "lucide-react";
import type { SlideDef } from "@/framework/viewer/types";
import { Tag } from "../components/primitives/Tag";
import { GiantNumber } from "../components/primitives/GiantNumber";
import { Cite } from "../components/primitives/Cite";
import { SourceFooter } from "../components/primitives/SourceFooter";
import { easeButton } from "../lib/motion";

interface LogRow {
  ts: string;
  user: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  verdict: "allow" | "block" | "redact";
  preview: string;
}

const SAMPLE_LOG: LogRow[] = [
  {
    ts: "10:42:18",
    user: "sarah@acme.io",
    model: "openai/gpt-4o",
    promptTokens: 1284,
    completionTokens: 632,
    costUsd: 0.018,
    verdict: "allow",
    preview: "Summarise customer feedback…",
  },
  {
    ts: "10:42:23",
    user: "ramesh@acme.io",
    model: "anthropic/claude-3.5-sonnet",
    promptTokens: 4280,
    completionTokens: 1820,
    costUsd: 0.061,
    verdict: "allow",
    preview: "Refactor this React component…",
  },
  {
    ts: "10:42:31",
    user: "luiza@acme.io",
    model: "openai/gpt-4o",
    promptTokens: 932,
    completionTokens: 0,
    costUsd: 0,
    verdict: "block",
    preview: "Review our auth.ts: SECRET_KEY=…",
  },
  {
    ts: "10:42:39",
    user: "tom@acme.io",
    model: "@cf/meta/llama-3.3-70b",
    promptTokens: 612,
    completionTokens: 412,
    costUsd: 0.004,
    verdict: "redact",
    preview: "Translate this support ticket [PII redacted]…",
  },
  {
    ts: "10:42:44",
    user: "engineering-bot",
    model: "anthropic/claude-3-haiku",
    promptTokens: 220,
    completionTokens: 88,
    costUsd: 0.001,
    verdict: "allow",
    preview: "PR title for branch dx-mcp-portal…",
  },
  {
    ts: "10:42:47",
    user: "marketing-bot",
    model: "openai/gpt-4o-mini",
    promptTokens: 4100,
    completionTokens: 2600,
    costUsd: 0.024,
    verdict: "allow",
    preview: "Draft 5 LinkedIn captions for launch day…",
  },
  {
    ts: "10:42:51",
    user: "alex@acme.io",
    model: "openai/gpt-4o",
    promptTokens: 8400,
    completionTokens: 0,
    costUsd: 0,
    verdict: "block",
    preview: "Whole quarterly accounts CSV → analyse…",
  },
  {
    ts: "10:42:55",
    user: "maria@acme.io",
    model: "anthropic/claude-3.5-sonnet",
    promptTokens: 1820,
    completionTokens: 950,
    costUsd: 0.022,
    verdict: "allow",
    preview: "Convert this legal clause to plain English…",
  },
  {
    ts: "10:43:02",
    user: "engineering-bot",
    model: "@cf/meta/llama-3.3-70b",
    promptTokens: 200,
    completionTokens: 60,
    costUsd: 0.001,
    verdict: "allow",
    preview: "Generate test fixtures…",
  },
];

export const promptLogSlide: SlideDef = {
  id: "prompt-log",
  title: "Audit · DLP & guardrail events",
  layout: "default",
  sectionLabel: "OBSERVE",
  sectionNumber: "04",
  render: () => <PromptLogBody />,
};

function PromptLogBody() {
  // Stream rows one-by-one (450ms cadence), then expand the BLOCK row
  // (index 2) once all five are in view. No infinite loop — the
  // animation plays exactly once on mount.
  const [visible, setVisible] = useState(0);
  const [expandReady, setExpandReady] = useState(false);
  const ROW_CADENCE_MS = 450;
  const ROWS_TO_STREAM = 5;

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < ROWS_TO_STREAM; i++) {
      timers.push(
        setTimeout(
          () => setVisible((v) => Math.max(v, i + 1)),
          ROW_CADENCE_MS * (i + 1),
        ),
      );
    }
    timers.push(
      setTimeout(
        () => setExpandReady(true),
        ROW_CADENCE_MS * (ROWS_TO_STREAM + 1) + 200,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  const stats = useMemo(() => {
    const slice = SAMPLE_LOG.slice(0, visible);
    return {
      totalPrompts: visible,
      blocked: slice.filter((r) => r.verdict === "block").length,
      tokens: slice.reduce(
        (acc, r) => acc + r.promptTokens + r.completionTokens,
        0,
      ),
      cost: slice.reduce((acc, r) => acc + r.costUsd, 0),
    };
  }, [visible]);

  return (
    <div className="mx-auto flex h-full w-full max-w-[1480px] flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Tag tone="info">Observe</Tag>
          <h2 className="mt-3 text-3xl tracking-[-0.035em] sm:text-5xl">
            Every prompt audit-logged. Guardrail events get the full
            forensic.
          </h2>
          <p className="mt-2 max-w-2xl text-cf-text-muted">
            AI Gateway stores the full request and response for every
            call by default
            <Cite
              n={1}
              href="https://developers.cloudflare.com/ai-gateway/observability/logging/"
            />, alongside tokens, latency, cost and verdict. When DLP or
            a guardrail fires, the entry gains structured fields
            (action, matched profile, detection entries). Logpush
            <Cite
              n={2}
              href="https://developers.cloudflare.com/logs/logpush/"
            />{" "}
            ships everything to R2, Splunk, Datadog or any
            S3-compatible sink in your tenant.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="rounded-full border border-cf-border bg-cf-bg-200 px-3 py-1.5 text-cf-text-muted">
            gateway: <span className="text-cf-text">acme-prod</span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Prompts"
          value={stats.totalPrompts}
          icon={Database}
          accent="var(--color-cf-info)"
        />
        <StatCard
          label="Blocked"
          value={stats.blocked}
          icon={ShieldAlert}
          accent="var(--color-cf-error)"
        />
        <StatCard
          label="Tokens"
          value={stats.tokens}
          icon={Filter}
          accent="var(--color-cf-orange)"
          format="compact"
        />
        <StatCard
          label="Cost (USD)"
          value={stats.cost}
          icon={ShieldCheck}
          accent="var(--color-cf-success)"
          decimals={3}
          prefix="$"
        />
      </div>

      {/* Audit log table — full width now that the (mocked) terminal +
          sinks side-rail is gone. Internal scroll + a fade gradient at
          the bottom signal "logs continue beyond". */}
      <div className="cf-corner-brackets cf-card relative flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <span className="cf-corner-bracket -left-[4px] -top-[4px]" />
          <span className="cf-corner-bracket -right-[4px] -top-[4px]" />
          <span className="cf-corner-bracket -bottom-[4px] -left-[4px]" />
          <span className="cf-corner-bracket -bottom-[4px] -right-[4px]" />
          <div className="flex flex-shrink-0 items-center justify-between border-b border-cf-border bg-cf-bg-100 px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
                Logpush · prompt-events
              </span>
            </div>
            <span className="font-mono text-[10px] text-cf-text-subtle">
              ts · user · model · in/out · cost · verdict
            </span>
          </div>
          <div className="cf-no-scrollbar relative min-h-0 flex-1 overflow-auto bg-cf-bg-200 px-5 py-3">
            <table className="w-full text-left font-mono text-xs">
              <tbody>
                {(() => {
                  const visibleRows = SAMPLE_LOG.slice(0, visible);
                  const firstBlockIdx = visibleRows.findIndex(
                    (r) => r.verdict === "block",
                  );
                  return visibleRows.flatMap((row, i) => {
                    // Only show the expansion AFTER all 5 rows have
                    // streamed in — keeps the demo cadence clean.
                    const isExpanded =
                      expandReady && i === firstBlockIdx;
                    const baseRow = (
                      <motion.tr
                        key={`${row.ts}-${row.user}-${i}`}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, ease: easeButton }}
                        className={[
                          "border-b border-dashed border-cf-border last:border-0",
                          isExpanded
                            ? "bg-[color:var(--color-cf-error)]/5"
                            : "",
                        ].join(" ")}
                      >
                        <td className="py-2 pr-3 text-cf-text-subtle">
                          {row.ts}
                        </td>
                        <td className="py-2 pr-3 text-cf-text">{row.user}</td>
                        <td className="py-2 pr-3 text-cf-text-muted">
                          {row.model}
                        </td>
                        <td className="py-2 pr-3 tabular-nums text-cf-text-muted">
                          {row.promptTokens.toLocaleString()}/
                          {row.completionTokens.toLocaleString()}
                        </td>
                        <td className="py-2 pr-3 tabular-nums text-cf-text-muted">
                          ${row.costUsd.toFixed(3)}
                        </td>
                        <td className="py-2 pr-3">
                          <VerdictPill verdict={row.verdict} />
                        </td>
                        <td className="max-w-[260px] truncate py-2 text-cf-text-subtle">
                          {row.preview}
                        </td>
                      </motion.tr>
                    );
                    if (!isExpanded) return [baseRow];
                    return [
                      baseRow,
                      <BlockDetailRow key={`${row.ts}-detail`} row={row} />,
                    ];
                  });
                })()}
              </tbody>
            </table>
          </div>
        {/* Bottom fade — signals "logs keep going" without bleeding into
            the slide background. Sits over the scroll viewport. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16"
          style={{
            background:
              "linear-gradient(to bottom, transparent 0%, var(--color-cf-bg-200) 90%)",
          }}
          aria-hidden="true"
        />
      </div>

      <SourceFooter
        sources={[
          {
            n: 1,
            label: "Cloudflare AI Gateway · observability & logging",
            href: "https://developers.cloudflare.com/ai-gateway/observability/logging/",
          },
          {
            n: 2,
            label: "Cloudflare Logpush · sinks (R2, S3, Splunk, Datadog, …)",
            href: "https://developers.cloudflare.com/logs/logpush/",
          },
        ]}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
  decimals = 0,
  prefix,
  format = "default",
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  accent: string;
  decimals?: number;
  prefix?: string;
  format?: "default" | "compact";
}) {
  const display = (() => {
    if (format === "compact") {
      if (value >= 1_000_000)
        return `${(value / 1_000_000).toFixed(1)}M`;
      if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
      return value.toFixed(decimals);
    }
    return value.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  })();
  return (
    <div className="cf-card flex flex-col gap-2 p-5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
          {label}
        </span>
        <Icon className="h-4 w-4" style={{ color: accent }} />
      </div>
      <span
        className="text-3xl font-medium tracking-[-0.03em] tabular-nums"
        style={{ color: accent }}
      >
        {prefix}
        {display}
      </span>
    </div>
  );
}

/* ====================================================================== */
/*  BlockDetailRow — auto-expanded panel for a BLOCK row, showing the     */
/*  sanitised prompt body, which DLP rule fired, and what action was      */
/*  taken. Renders inside the table as a full-width inset row.            */
/* ====================================================================== */

function BlockDetailRow({ row }: { row: LogRow }) {
  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, delay: 0.15, ease: easeButton }}
      className="border-b border-dashed border-cf-border last:border-0"
    >
      <td colSpan={7} className="px-0 py-0">
        <motion.div
          initial={{ height: 0 }}
          animate={{ height: "auto" }}
          transition={{ duration: 0.45, delay: 0.1, ease: easeButton }}
          className="overflow-hidden bg-[color:var(--color-cf-error)]/8"
        >
          <div className="border-l-2 border-[color:var(--color-cf-error)]/60 px-5 py-4">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 rounded border border-[color:var(--color-cf-error)]/40 bg-[color:var(--color-cf-error)]/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.06em] text-cf-error">
                <ShieldAlert className="h-2.5 w-2.5" />
                DLP block
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-cf-text-subtle">
                expanded · auto-displayed for first BLOCK in view
              </span>
              <span className="ml-auto font-mono text-[10px] text-cf-text-subtle">
                event_id · {row.ts.replace(/:/g, "")}-{row.user.split("@")[0]}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
              {/* Prompt body (sanitised) */}
              <div>
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-cf-text-subtle">
                  Prompt body · sanitised before retention
                </span>
                <pre className="mt-1.5 overflow-x-auto rounded-md border border-cf-border bg-cf-bg-100 p-2.5 font-mono text-[11px] leading-relaxed text-cf-text">
{`Review our auth.ts. This needs to ship today:

const SECRET_KEY = "`}<span className="rounded-sm bg-[color:var(--color-cf-error)]/15 px-1 text-cf-error">[REDACTED · sk_live_*]</span>{`";

export function signToken(userId: string) {
  const payload = { userId, exp: Date.now() + 3600_000 };
  return base64(JSON.stringify(payload)) + "." + SECRET_KEY;
}

Find vulnerabilities + suggest fixes.`}
                </pre>
              </div>

              {/* DLP rule + action */}
              <div className="flex flex-col gap-2">
                <div className="rounded-md border border-cf-border bg-cf-bg-100 p-2.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-cf-text-subtle">
                    DLP rule fired
                  </span>
                  <p className="mt-1 text-[12px] font-medium text-cf-text">
                    Hardcoded API key · Stripe live secret
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-cf-text-muted">
                    pattern · <span className="text-cf-text">sk_live_[A-Za-z0-9]{`{24}`}</span>
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-cf-text-muted">
                    profile · <span className="text-cf-text">acme-secrets-strict</span>
                  </p>
                </div>
                <div className="rounded-md border border-cf-border bg-cf-bg-100 p-2.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-cf-text-subtle">
                    Action taken
                  </span>
                  <ul className="mt-1 flex flex-col gap-0.5 text-[11px] text-cf-text">
                    <li>· Request <span className="font-medium text-cf-error">blocked</span> at the Gateway</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </td>
    </motion.tr>
  );
}

function VerdictPill({ verdict }: { verdict: LogRow["verdict"] }) {
  const map: Record<LogRow["verdict"], { color: string; label: string }> = {
    allow: { color: "var(--color-cf-success)", label: "ALLOW" },
    block: { color: "var(--color-cf-error)", label: "BLOCK" },
    redact: { color: "var(--color-cf-info)", label: "REDACT" },
  };
  const m = map[verdict];
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em]"
      style={{
        color: m.color,
        borderColor: m.color + "55",
        background: m.color + "15",
      }}
    >
      {m.label}
    </span>
  );
}

// Used elsewhere - keep export
export { GiantNumber };
