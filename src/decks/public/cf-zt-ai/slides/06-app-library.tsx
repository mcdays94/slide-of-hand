import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, MoreHorizontal, Plus, Search, SlidersHorizontal } from "lucide-react";
import type { SlideDef } from "@/framework/viewer/types";
import { Tag } from "../components/primitives/Tag";
import { CloudflareOneShell } from "../components/windows/CloudflareOneShell";
import { easeButton } from "../lib/motion";

/* =====================================================================
 * App Library — slide 06
 *
 * Mirrors the real Cloudflare One App Library page captured at
 *   dash.cloudflare.com/<account>/one/team-resources/application-library
 *
 * Real attributes per row (from DOM extraction):
 *   Name · Status · Hostnames · Supported · Type · App score · Gen-AI score
 * Real status values: APPROVED · IN REVIEW · UNAPPROVED · UNREVIEWED
 * ===================================================================== */

type Status = "APPROVED" | "IN REVIEW" | "UNAPPROVED" | "UNREVIEWED";

interface AppRow {
  id: string;
  name: string;
  /** Path to a brand SVG (in /public). Falls back to monogram if absent. */
  logoSrc?: string;
  /** Background color for the logo square. */
  logoBg?: string;
  /** Single-letter fallback when logoSrc is absent. */
  monogram: string;
  monogramColor: string;
  status: Status;
  hostnames: number;
  supported: ("ACCESS" | "GATEWAY")[];
  appScore: number; // 0–5 (matches real "App confidence score")
  genAiScore: number | null; // -- shown when null
}

const APPS: AppRow[] = [
  { id: "chatgpt", name: "ChatGPT", logoSrc: "/cf-zt-ai/logos/openai.svg", logoBg: "#FFFFFF", monogram: "C", monogramColor: "#10A37F", status: "APPROVED", hostnames: 9, supported: ["ACCESS", "GATEWAY"], appScore: 2.6, genAiScore: null },
  { id: "copilot", name: "Microsoft Copilot", logoSrc: "/cf-zt-ai/logos/microsoft-copilot.svg", logoBg: "#FFFFFF", monogram: "M", monogramColor: "#0078D4", status: "IN REVIEW", hostnames: 5, supported: ["GATEWAY"], appScore: 4.25, genAiScore: 4.0 },
  { id: "gemini", name: "Google Gemini", logoSrc: "/cf-zt-ai/logos/gemini.svg", logoBg: "#FFFFFF", monogram: "G", monogramColor: "#4285F4", status: "APPROVED", hostnames: 4, supported: ["GATEWAY"], appScore: 3.2, genAiScore: 4.0 },
  { id: "chataskai", name: "Chat & Ask AI", monogram: "C", monogramColor: "#7C3AED", status: "UNAPPROVED", hostnames: 1, supported: ["GATEWAY"], appScore: 0.2, genAiScore: 2.0 },
  { id: "databot", name: "DataBot", monogram: "D", monogramColor: "#EE0DDB", status: "UNAPPROVED", hostnames: 1, supported: ["GATEWAY"], appScore: 0.2, genAiScore: null },
  { id: "elsa", name: "Elsa Speak", monogram: "E", monogramColor: "#06B6D4", status: "UNREVIEWED", hostnames: 2, supported: ["GATEWAY"], appScore: 0.2, genAiScore: 1.0 },
  { id: "otter", name: "Otter", monogram: "O", monogramColor: "#F97316", status: "UNREVIEWED", hostnames: 2, supported: ["GATEWAY"], appScore: 1.4, genAiScore: null },
];

const TOTAL_COUNT = 215;

const STATUS_META: Record<Status, { color: string }> = {
  APPROVED: { color: "var(--color-cf-success)" },
  "IN REVIEW": { color: "var(--color-cf-warning)" },
  UNAPPROVED: { color: "var(--color-cf-error)" },
  UNREVIEWED: { color: "var(--color-cf-text-subtle)" },
};

export const appLibrarySlide: SlideDef = {
  id: "app-library",
  title: "AI App Library",
  layout: "default",
  sectionLabel: "GOVERN",
  sectionNumber: "02",
  render: () => <AppLibraryBody />,
};

function AppLibraryBody() {
  const [statusFilter, setStatusFilter] = useState<"All" | Status>("All");
  const visible =
    statusFilter === "All" ? APPS : APPS.filter((a) => a.status === statusFilter);

  return (
    <div className="mx-auto flex h-full w-full max-w-[1480px] flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Tag tone="compute">Govern · Snapshot from a Cloudflare tenant</Tag>
          <h2 className="mt-3 text-3xl tracking-[-0.035em] sm:text-4xl">
            One catalog. One status per app.
          </h2>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
          dash.cloudflare.com / one / team-resources / application-library
        </span>
      </div>

      <CloudflareOneShell
        currentId="app-library"
        breadcrumb={["Team & Resources", "Application library"]}
        className="flex-1"
      >
        <div className="flex h-full flex-col gap-4 px-6 py-5">
          {/* Page header */}
          <div className="flex items-start justify-between gap-4">
            <div className="max-w-3xl">
              <h1 className="text-2xl tracking-[-0.025em] text-cf-text">
                Application library
              </h1>
              <p className="mt-1 text-sm text-cf-text-muted">
                Monitor your application security from a centralised location.
                The App Library surfaces policies, in-line controls, security
                findings, and usage for your applications.{" "}
                <a
                  href="#"
                  data-no-advance
                  className="text-cf-orange underline-offset-2 hover:underline"
                >
                  Application library documentation
                </a>
                .
              </p>
            </div>
            <button
              type="button"
              data-interactive
              className="flex flex-shrink-0 items-center gap-2 rounded-md border border-cf-border bg-cf-bg-200 px-3 py-2 text-sm text-cf-text transition hover:border-cf-orange hover:text-cf-orange"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Set application statuses
            </button>
          </div>

          {/* Section heading + counter */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-cf-text">Applications</h2>
            <span className="font-mono text-xs text-cf-text-muted">
              Showing {visible.length} of {TOTAL_COUNT}
            </span>
          </div>

          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-cf-border bg-cf-bg-200 px-3 py-2">
            <div className="flex flex-1 items-center gap-2 rounded-md border border-cf-border bg-cf-bg-100 px-2 py-1.5 text-xs text-cf-text-subtle">
              <Search className="h-3 w-3" />
              <span className="font-mono">Search by application name</span>
            </div>
            <FilterChip label="Status" value={statusFilter} onClick={() => {/* deck overlays would handle this */}} />
            <FilterChip label="Supported" value="All" />
            <FilterChip label="Type" value="Artificial Intelligence" />
            <button
              type="button"
              data-no-advance
              className="rounded-md border border-cf-border px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-cf-text-muted transition hover:bg-cf-bg-300"
            >
              Hide filters
            </button>
            <button
              type="button"
              data-no-advance
              className="rounded-md bg-cf-orange px-3 py-1 font-mono text-[11px] font-medium uppercase tracking-wider text-white transition hover:opacity-90"
            >
              Apply filters
            </button>
            <button
              type="button"
              data-no-advance
              className="rounded-md px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-cf-text-muted transition hover:bg-cf-bg-300"
            >
              Clear filters
            </button>
          </div>

          {/* Quick status filter chips for slide interactivity */}
          <div className="flex flex-wrap gap-2" data-interactive>
            {(["All", "APPROVED", "IN REVIEW", "UNAPPROVED", "UNREVIEWED"] as const).map(
              (s) => {
                const active = statusFilter === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(s)}
                    className={[
                      "rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.06em] transition",
                      active
                        ? "border-cf-orange bg-cf-orange text-white"
                        : "border-cf-border bg-cf-bg-100 text-cf-text-muted hover:border-cf-orange/60 hover:text-cf-orange",
                    ].join(" ")}
                  >
                    {s}
                  </button>
                );
              },
            )}
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[minmax(200px,1.6fr)_120px_90px_140px_100px_100px_30px] gap-3 border-b border-cf-border px-4 pb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-cf-text-subtle">
            <span>Name</span>
            <span>Status</span>
            <span>Hostnames</span>
            <span>Supported</span>
            <span>App score</span>
            <span>Gen-AI score</span>
            <span />
          </div>

          {/* Rows */}
          <ol className="flex flex-col gap-1 overflow-auto">
            <AnimatePresence mode="popLayout">
              {visible.map((app, i) => (
                <motion.li
                  key={app.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25, delay: i * 0.04, ease: easeButton }}
                  className="grid grid-cols-[minmax(200px,1.6fr)_120px_90px_140px_100px_100px_30px] items-center gap-3 rounded-md border border-cf-border bg-cf-bg-200 px-4 py-2.5 text-sm transition hover:border-cf-orange/40"
                >
                  {/* Name */}
                  <div className="flex items-center gap-3 min-w-0">
                    {app.logoSrc ? (
                      <span
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-cf-border"
                        style={{ background: app.logoBg ?? "#FFFFFF" }}
                      >
                        <img
                          src={app.logoSrc}
                          alt={app.name}
                          className="h-5 w-5 object-contain"
                          draggable={false}
                        />
                      </span>
                    ) : (
                      <span
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md font-mono text-sm font-medium text-white"
                        style={{ background: app.monogramColor }}
                      >
                        {app.monogram}
                      </span>
                    )}
                    <span className="truncate font-medium text-cf-text">
                      {app.name}
                    </span>
                  </div>

                  {/* Status */}
                  <StatusPill status={app.status} />

                  {/* Hostnames */}
                  <span className="font-mono text-cf-text tabular-nums">
                    {app.hostnames}
                  </span>

                  {/* Supported */}
                  <div className="flex flex-wrap gap-1">
                    {app.supported.map((s) => (
                      <span
                        key={s}
                        className="rounded border border-cf-border bg-cf-bg-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-cf-text-muted"
                      >
                        {s}
                      </span>
                    ))}
                  </div>

                  {/* App score */}
                  <ScoreBar score={app.appScore} />

                  {/* Gen-AI score */}
                  {app.genAiScore !== null ? (
                    <ScoreBar score={app.genAiScore} />
                  ) : (
                    <span className="font-mono text-cf-text-subtle">·</span>
                  )}

                  {/* Context menu */}
                  <button
                    type="button"
                    data-no-advance
                    aria-label="Context menu"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-cf-text-subtle transition hover:bg-cf-bg-300 hover:text-cf-text"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        </div>
      </CloudflareOneShell>
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const meta = STATUS_META[status];
  return (
    <span
      className="inline-flex items-center justify-center rounded border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em]"
      style={{
        color: meta.color,
        borderColor: `${meta.color}55`,
        background: `${meta.color}12`,
      }}
    >
      {status}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(100, (score / 5) * 100);
  const color =
    score >= 4
      ? "var(--color-cf-error)"
      : score >= 2
        ? "var(--color-cf-warning)"
        : "var(--color-cf-success)";
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-cf-text tabular-nums">
        {score.toFixed(2)}
      </span>
      <span
        className="relative block h-1.5 flex-1 overflow-hidden rounded-full bg-cf-border/40"
        aria-hidden="true"
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </span>
    </div>
  );
}

function FilterChip({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-no-advance
      className="flex items-center gap-1.5 rounded-md border border-cf-border bg-cf-bg-100 px-2 py-1 text-xs text-cf-text-muted transition hover:border-cf-orange/60 hover:text-cf-orange"
    >
      <span className="font-mono text-[10px] uppercase tracking-wider opacity-60">
        {label}:
      </span>
      <span>{value}</span>
      <ChevronDown className="h-3 w-3 opacity-60" />
    </button>
  );
}

// suppress unused warning
void Plus;
