import { motion } from "framer-motion";
import {
  Cloud,
  Copy,
  Github,
  MoreHorizontal,
  Plus,
  Search,
  Slack,
  Sparkles,
  Trello,
  Wrench,
} from "lucide-react";
import type { SlideDef } from "@/framework/viewer/types";
import { Tag } from "../components/primitives/Tag";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { CloudflareOneShell } from "../components/windows/CloudflareOneShell";
import { easeEntrance, staggerContainer, staggerItem } from "../lib/motion";

/* =====================================================================
 * MCP Portal — slide 15
 *
 * Mirrors the real Cloudflare One AI controls page captured at
 *   dash.cloudflare.com/<account>/one/access-controls/ai-controls/mcp-server
 *
 * Layout: dashboard takes the left ~74% of the stage, two annotation
 * cards stack on the right with horizontal SVG arrows pointing left
 * into the dashboard at the row/cell they describe — so the badges
 * are clearly anchored, not floating randomly.
 * ===================================================================== */

type ServerStatus = "SYNC REQUIRED" | "READY";

interface McpServer {
  id: string;
  name: string;
  endpoint: string;
  tools: number;
  prompts: number;
  status: ServerStatus;
}

const SERVERS: McpServer[] = [
  { id: "workers-bindings-server", name: "Workers Bindings server", endpoint: "https://bindings.mcp.cloudflare.com/sse", tools: 25, prompts: 1, status: "SYNC REQUIRED" },
  { id: "workers-ai-gateway-server", name: "Workers AI Gateway server", endpoint: "https://ai-gateway.mcp.cloudflare.com/sse", tools: 7, prompts: 0, status: "SYNC REQUIRED" },
  { id: "observability", name: "Observability", endpoint: "https://observability.mcp.cloudflare.com/sse", tools: 10, prompts: 1, status: "SYNC REQUIRED" },
  { id: "logpush", name: "Logpush", endpoint: "https://logs.mcp.cloudflare.com/mcp", tools: 3, prompts: 0, status: "READY" },
  { id: "cloudflare-radar", name: "Cloudflare Radar", endpoint: "https://radar.mcp.cloudflare.com/mcp", tools: 68, prompts: 0, status: "READY" },
];

export const mcpPortalSlide: SlideDef = {
  id: "mcp-portal",
  title: "MCP Server Portal",
  layout: "default",
  sectionLabel: "EMPOWER",
  sectionNumber: "05",
  render: () => <McpPortalBody />,
};

function McpPortalBody() {
  return (
    <div className="mx-auto flex h-full w-full max-w-[1480px] flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Tag tone="ai">Empower · Snapshot from a Cloudflare tenant</Tag>
          <h2 className="mt-3 text-3xl tracking-[-0.035em] sm:text-4xl">
            A curated portal of{" "}
            <span className="text-[color:var(--color-cf-ai)]">MCP servers</span>{" "}
            for your agents.
          </h2>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
          dash.cloudflare.com / one / access-controls / ai-controls
        </span>
      </div>

      {/* Stage: dashboard (left) + annotations rail (right) */}
      <div className="grid flex-1 min-h-0 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[minmax(0,1fr)_280px]">
        <CloudflareOneShell
          currentId="ai-controls"
          breadcrumb={["Access controls", "AI controls"]}
          className="h-full min-h-0"
        >
          <McpPortalPage />
        </CloudflareOneShell>

        {/* Annotations rail. Both annotations are stand-alone cards now
            — the previous "Bring your own → Add MCP server" arrow was
            landing on the table row instead of the button as the
            dashboard column re-flows at different viewport widths, so
            we dropped the arrow rather than chase a brittle pixel
            alignment. */}
        <div className="relative flex flex-col gap-6 py-4">
          <div className="mt-[148px]">
            <Annotation
              n={1}
              showArrow={false}
              icon={Plus}
              title="Bring your own"
              body="Slack, GitHub, Jira, internal RAG: anything that speaks MCP, behind Cloudflare Access. Click 'Add MCP server'."
              delay={1.0}
              logos={[Slack, Github, Trello]}
            />
          </div>
          <div className="mt-auto">
            <Annotation
              n={2}
              showArrow={false}
              icon={Wrench}
              title="Auto-discovered tools"
              body="Tools sync from the MCP endpoint on connect. Your agents see them instantly. No manual registration."
              delay={1.4}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function McpPortalPage() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-5 py-4">
      {/* Page header */}
      <div className="flex items-start gap-3">
        <h1 className="text-xl tracking-[-0.025em] text-cf-text">AI controls</h1>
        <span className="rounded-md bg-[color:var(--color-cf-info)]/15 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-[color:var(--color-cf-info)]">
          Beta
        </span>
      </div>
      <p className="text-xs text-cf-text-muted">
        Consolidate and control access to your Model Context Protocol (MCP)
        servers and tools. Create MCP server portals and add them as Access
        applications to manage who can reach them.
      </p>

      {/* Tabs */}
      <div className="flex border-b border-cf-border" data-interactive>
        <button
          type="button"
          data-no-advance
          className="border-b-2 border-transparent px-4 py-2 text-sm font-medium text-cf-text-muted transition hover:text-cf-text"
        >
          MCP server portals
        </button>
        <button
          type="button"
          data-no-advance
          className="-mb-px border-b-2 border-cf-orange px-4 py-2 text-sm font-medium text-cf-text"
        >
          MCP servers
        </button>
      </div>

      {/* Section heading + Add */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-medium text-cf-text">
          Your Model Context Protocol (MCP) servers
        </h2>
        <button
          type="button"
          data-interactive
          className="flex flex-shrink-0 items-center gap-1.5 rounded-md bg-cf-orange px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
          // marker target for annotation #1 ("Bring your own" → Add button)
          data-anchor="add-mcp-server"
        >
          <Plus className="h-3.5 w-3.5" />
          Add MCP server
        </button>
      </div>

      <span className="font-mono text-[10px] text-cf-text-muted">
        Showing 1-{SERVERS.length} of {SERVERS.length}
      </span>

      {/* Search */}
      <div className="flex items-center gap-2 rounded-md border border-cf-border bg-cf-bg-200 px-3 py-1.5 text-xs text-cf-text-subtle">
        <Search className="h-3 w-3" />
        <span className="font-mono">Search by ID, name or description</span>
      </div>

      {/* Table — internal scroll if it overflows */}
      <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-cf-border">
        <div className="grid grid-cols-[minmax(160px,1.4fr)_minmax(120px,0.9fr)_minmax(200px,1.4fr)_60px_70px_120px_30px] flex-shrink-0 gap-2 border-b border-cf-border bg-cf-bg-200 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-cf-text-subtle">
          <span>Name</span>
          <span>ID</span>
          <span>HTTP endpoint</span>
          <span>Tools</span>
          <span>Prompts</span>
          <span>Status</span>
          <span />
        </div>

        <motion.ol
          className="flex flex-1 flex-col overflow-y-auto cf-no-scrollbar"
          variants={staggerContainer}
          initial="initial"
          animate="animate"
        >
          {SERVERS.map((s) => (
            <motion.li
              key={s.id}
              variants={staggerItem}
              className="grid grid-cols-[minmax(160px,1.4fr)_minmax(120px,0.9fr)_minmax(200px,1.4fr)_60px_70px_120px_30px] flex-shrink-0 items-center gap-2 border-b border-cf-border bg-cf-bg-100 px-3 py-2 text-xs last:border-0 hover:bg-cf-bg-200"
            >
              {/* Name */}
              <span className="flex items-center gap-1.5 truncate font-medium text-cf-text">
                <Cloud className="h-3 w-3 flex-shrink-0 text-cf-orange" />
                {s.name}
              </span>
              {/* ID */}
              <span className="flex items-center gap-1 truncate">
                <code className="truncate font-mono text-cf-text-muted">
                  {s.id}
                </code>
                <CopyButton />
              </span>
              {/* Endpoint */}
              <span className="flex items-center gap-1 truncate">
                <code className="truncate font-mono text-cf-text-muted">
                  {s.endpoint}
                </code>
                <CopyButton />
              </span>
              {/* Tools — anchor target for annotation #2 */}
              <span
                className="font-mono tabular-nums text-cf-text"
                data-anchor="tools-count"
              >
                {s.tools}
              </span>
              {/* Prompts */}
              <span className="font-mono tabular-nums text-cf-text-muted">
                {s.prompts}
              </span>
              {/* Status */}
              <ServerStatusPill status={s.status} />
              {/* Context menu */}
              <button
                type="button"
                aria-label="Context menu"
                data-no-advance
                className="flex h-6 w-6 items-center justify-center rounded-md text-cf-text-subtle transition hover:bg-cf-bg-300 hover:text-cf-text"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </motion.li>
          ))}
        </motion.ol>
      </div>
    </div>
  );
}

function CopyButton() {
  return (
    <button
      type="button"
      aria-label="Copy"
      data-no-advance
      className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-cf-text-subtle transition hover:bg-cf-bg-300 hover:text-cf-text"
    >
      <Copy className="h-3 w-3" />
    </button>
  );
}

function ServerStatusPill({ status }: { status: ServerStatus }) {
  const isReady = status === "READY";
  const color = isReady ? "var(--color-cf-success)" : "var(--color-cf-warning)";
  return (
    <span
      className="inline-flex items-center justify-center rounded border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em]"
      style={{
        color,
        borderColor: `${color}55`,
        background: `${color}12`,
      }}
    >
      {status}
    </span>
  );
}

/* ====================================================================== */
/*  Annotation rail item — sits in the right column with a left-pointing  */
/*  dashed arrow that visually anchors it to the dashboard row alongside. */
/* ====================================================================== */

interface AnnotationProps {
  n: number;
  /** When true, render a left-pointing dashed arrow into the dashboard. */
  showArrow: boolean;
  icon: typeof Wrench;
  title: string;
  body: string;
  delay?: number;
  logos?: Array<typeof Wrench>;
}

function Annotation({
  n,
  showArrow,
  icon: Icon,
  title,
  body,
  delay = 0,
  logos,
}: AnnotationProps) {
  return (
    <motion.div
      className="relative"
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay, ease: easeEntrance }}
    >
      {/* Left-pointing dashed arrow into the dashboard (optional). Wider
          than the column gap so the arrowhead extends well into the
          dashboard area and visually lands ON the Add MCP server button.
          Tip is at x=4 (inside the SVG); positioning is `-left-20`
          (80px). With the gap of 16px between dashboard and rail, the
          tip lands at (annotation.left - 80 + 4) = ~64px inside the
          dashboard's right edge — which is well into the button. */}
      {showArrow && (
        <svg
          className="pointer-events-none absolute -left-20 top-1/2 h-4 -translate-y-1/2"
          width="80"
          height="16"
          viewBox="0 0 80 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M 78 8 L 8 8"
            stroke="var(--color-cf-orange)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="3 4"
          />
          <path
            d="M 8 8 L 14 4 M 8 8 L 14 12"
            stroke="var(--color-cf-orange)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )}

      <CornerBrackets className="cf-card relative rounded-xl border-2 border-cf-orange p-4 shadow-[0_18px_48px_rgba(255,72,1,0.18),0_4px_12px_rgba(0,0,0,0.06)]">
        <div className="flex items-center gap-2">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full bg-cf-orange font-mono text-xs font-medium text-white"
            aria-hidden="true"
          >
            {n}
          </span>
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-cf-orange-light text-cf-orange">
            <Icon className="h-3.5 w-3.5" />
          </span>
          <h4 className="font-medium leading-tight text-cf-text">{title}</h4>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-cf-text-muted">{body}</p>
        {logos && (
          <div className="mt-3 flex items-center gap-2 border-t border-dashed border-cf-border pt-2">
            <span className="font-mono text-[9px] uppercase tracking-wider text-cf-text-subtle">
              e.g.
            </span>
            {logos.map((LogoIcon, i) => (
              <span
                key={i}
                className="flex h-6 w-6 items-center justify-center rounded-md bg-cf-bg-200 text-cf-text-muted"
              >
                <LogoIcon className="h-3.5 w-3.5" />
              </span>
            ))}
            <Sparkles className="h-3 w-3 text-cf-text-subtle" />
            <span className="font-mono text-[10px] text-cf-text-subtle">
              and more
            </span>
          </div>
        )}
      </CornerBrackets>
    </motion.div>
  );
}
