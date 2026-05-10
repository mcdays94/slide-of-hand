import type { ReactNode } from "react";
import {
  BarChart3,
  Box,
  ChevronDown,
  ChevronRight,
  Cloud,
  Eye,
  Globe,
  HelpCircle,
  Home,
  Lock,
  Mail,
  MessageCircle,
  Plug,
  Search,
  Shield,
  ShieldCheck,
  TrafficCone,
  User,
  Users,
} from "lucide-react";

/* =====================================================================
 * CloudflareOneShell
 *
 * Faithful approximation of the Cloudflare One dashboard chrome (top bar
 * + left sidebar + main content slot), reverse-engineered via DOM
 * extraction from the real `dash.cloudflare.com/.../one/...` pages.
 *
 * Sidebar nav follows the real section order:
 *   Overview · Insights · Team & Resources · Networks · Access controls
 *   · Traffic policies · Cloud & SaaS findings · Email security · DLP
 *   · Browser isolation · Reusable components · Integrations
 *
 * Pass `currentId` to highlight + auto-expand the relevant section.
 *
 * Real account ID prefix `1bcef46cbe9172d2569dcf7039048842` retained in
 * URL so the dashboard reads as "from Miguel's actual tenant".
 * ===================================================================== */

const ACCOUNT_ID = "1bcef46cbe9172d2569dcf7039048842";
const ACCOUNT_PATH = `/${ACCOUNT_ID}/one`;

type NavSubItem = {
  id: string;
  label: string;
  beta?: boolean;
  href?: string;
};

type NavSection = {
  id: string;
  label: string;
  icon: typeof Home;
  items?: NavSubItem[];
  /** Single-link section (no subitems). */
  href?: string;
};

const NAV: NavSection[] = [
  { id: "overview", label: "Overview", icon: Home, href: `${ACCOUNT_PATH}/overview` },
  {
    id: "insights",
    label: "Insights",
    icon: BarChart3,
    items: [
      { id: "insights-overview", label: "Overview" },
      { id: "insights-dashboards", label: "Dashboards" },
      { id: "insights-dex", label: "Digital experience" },
      { id: "insights-logs", label: "Logs" },
    ],
  },
  {
    id: "team-resources",
    label: "Team & Resources",
    icon: Users,
    items: [
      { id: "app-library", label: "Application library" },
      { id: "devices", label: "Devices" },
      { id: "users", label: "Users" },
    ],
  },
  {
    id: "networks",
    label: "Networks",
    icon: Globe,
    items: [
      { id: "networks-overview", label: "Overview" },
      { id: "networks-connectors", label: "Connectors" },
      { id: "networks-routes", label: "Routes" },
      { id: "networks-resolvers", label: "Resolvers & Proxies" },
    ],
  },
  {
    id: "access-controls",
    label: "Access controls",
    icon: ShieldCheck,
    items: [
      { id: "access-overview", label: "Overview" },
      { id: "access-applications", label: "Applications" },
      { id: "access-policies", label: "Policies" },
      { id: "ai-controls", label: "AI controls", beta: true },
      { id: "access-targets", label: "Targets" },
      { id: "access-credentials", label: "Service credentials" },
      { id: "access-settings", label: "Access settings" },
    ],
  },
  {
    id: "traffic-policies",
    label: "Traffic policies",
    icon: TrafficCone,
    items: [
      { id: "traffic-overview", label: "Overview" },
      { id: "traffic-firewall", label: "Firewall policies" },
      { id: "traffic-resolver", label: "Resolver policies", beta: true },
      { id: "traffic-egress", label: "Egress policies" },
      { id: "traffic-settings", label: "Traffic settings" },
    ],
  },
  {
    id: "cloud-saas",
    label: "Cloud & SaaS findings",
    icon: Cloud,
    items: [
      { id: "cloud-overview", label: "Overview" },
      { id: "cloud-posture", label: "Posture Findings" },
      { id: "cloud-content", label: "Content Findings" },
    ],
  },
  { id: "email", label: "Email security", icon: Mail, href: `${ACCOUNT_PATH}/email-security/overview` },
  {
    id: "dlp",
    label: "Data loss prevention",
    icon: Lock,
    items: [
      { id: "dlp-overview", label: "Overview" },
      { id: "dlp-profiles", label: "Profiles" },
    ],
  },
  { id: "browser-isolation", label: "Browser isolation", icon: Shield },
  { id: "reusable", label: "Reusable components", icon: Box },
  { id: "integrations", label: "Integrations", icon: Plug },
];

export function CloudflareOneShell({
  currentId,
  breadcrumb,
  children,
  className = "",
}: {
  /** ID of the current page (matches a NavSubItem.id or NavSection.id). */
  currentId: string;
  /** Breadcrumb trail shown in the page header — e.g. ["Team & Resources", "Application library"]. */
  breadcrumb: string[];
  children: ReactNode;
  className?: string;
}) {
  // Find the section that contains currentId so we can auto-expand it.
  const currentSectionId = NAV.find(
    (s) => s.id === currentId || s.items?.some((i) => i.id === currentId),
  )?.id;

  return (
    <div
      className={[
        "flex h-full w-full flex-col overflow-hidden rounded-2xl border border-cf-border bg-cf-bg-100 shadow-[0_18px_48px_rgba(82,16,0,0.08),0_4px_12px_rgba(82,16,0,0.04)]",
        className,
      ].join(" ")}
      data-no-advance
    >
      {/* Top bar */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-cf-border bg-cf-bg-200 px-4 py-2.5">
        <img
          src="/cf-code-mode/cloudflare-logo.png"
          alt="Cloudflare"
          className="block h-4 w-auto select-none"
          draggable={false}
        />
        <span className="text-cf-border">|</span>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-cf-text hover:bg-cf-bg-300"
          data-no-advance
        >
          <span className="flex h-5 w-5 items-center justify-center rounded bg-cf-orange-light font-mono text-[10px] font-medium text-cf-orange">
            L
          </span>
          Lusostreams Organization
          <ChevronDown className="h-3 w-3 text-cf-text-subtle" />
        </button>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-cf-border bg-cf-bg-100 px-3 py-1 text-xs text-cf-text-subtle">
            <Search className="h-3 w-3" />
            <span className="font-mono">Quick search…</span>
            <kbd className="rounded border border-cf-border px-1 font-mono text-[10px]">
              ⌘K
            </kbd>
          </div>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cf-orange text-white">
            <User className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>

      {/* Body: sidebar + main */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-[220px] flex-shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-cf-border bg-cf-bg-200 px-2 py-3 cf-no-scrollbar">
          {NAV.map((section) => {
            const isCurrentSection = section.id === currentSectionId;
            const SectionIcon = section.icon;
            // Section without items — render as a single link
            if (!section.items) {
              const isCurrent = section.id === currentId;
              return (
                <a
                  key={section.id}
                  href={section.href}
                  className={[
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition",
                    isCurrent
                      ? "bg-cf-orange-light font-medium text-cf-orange"
                      : "text-cf-text-muted hover:bg-cf-bg-300",
                  ].join(" ")}
                  data-no-advance
                >
                  <SectionIcon className="h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{section.label}</span>
                </a>
              );
            }
            // Section with items — show header + items if expanded
            return (
              <div key={section.id} className="mt-0.5">
                <div
                  className={[
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition",
                    "text-cf-text-muted",
                  ].join(" ")}
                >
                  <SectionIcon className="h-4 w-4 flex-shrink-0" />
                  <span className="flex-1 truncate font-medium">
                    {section.label}
                  </span>
                  {isCurrentSection ? (
                    <ChevronDown className="h-3 w-3 text-cf-text-subtle" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-cf-text-subtle" />
                  )}
                </div>
                {isCurrentSection && (
                  <ul className="ml-2 mt-0.5 flex flex-col gap-0.5 border-l border-cf-border pl-2">
                    {section.items.map((item) => {
                      const isCurrent = item.id === currentId;
                      return (
                        <li key={item.id}>
                          <a
                            className={[
                              "flex items-center gap-2 rounded-md px-2 py-1 text-[13px] transition",
                              isCurrent
                                ? "bg-cf-orange-light font-medium text-cf-orange"
                                : "text-cf-text-muted hover:bg-cf-bg-300",
                            ].join(" ")}
                            data-no-advance
                            href="#"
                          >
                            <span className="flex-1 truncate">{item.label}</span>
                            {item.beta && (
                              <span className="rounded-full border border-[color:var(--color-cf-info)]/40 bg-[color:var(--color-cf-info)]/10 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-[color:var(--color-cf-info)]">
                                Beta
                              </span>
                            )}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}

          {/* Bottom links */}
          <div className="mt-auto border-t border-cf-border pt-2 text-cf-text-muted">
            <a
              href="#"
              data-no-advance
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-cf-bg-300"
            >
              <MessageCircle className="h-4 w-4" />
              Give feedback
            </a>
            <a
              href="#"
              data-no-advance
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-cf-bg-300"
            >
              <HelpCircle className="h-4 w-4" />
              Support
            </a>
          </div>
        </aside>

        {/* Main content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Breadcrumb bar */}
          <div className="flex-shrink-0 border-b border-cf-border bg-cf-bg-100 px-6 py-2">
            <nav className="flex items-center gap-1 text-xs">
              {breadcrumb.map((seg, i) => (
                <span key={`${seg}-${i}`} className="flex items-center gap-1">
                  {i > 0 && (
                    <ChevronRight className="h-3 w-3 text-cf-text-subtle" />
                  )}
                  <span
                    className={
                      i === breadcrumb.length - 1
                        ? "font-medium text-cf-text"
                        : "text-cf-text-muted"
                    }
                  >
                    {seg}
                  </span>
                </span>
              ))}
            </nav>
          </div>
          {/* Content slot */}
          <div className="flex-1 overflow-auto bg-cf-bg-100">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Re-export a useful icon set for slides built on top of the shell. */
export { Eye };
