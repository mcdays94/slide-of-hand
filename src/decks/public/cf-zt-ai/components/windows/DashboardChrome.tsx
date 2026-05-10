import type { ReactNode } from "react";
import { ChevronRight, Search } from "lucide-react";

/**
 * Cloudflare-dashboard-style window: top bar with breadcrumbs + search,
 * left rail of sections, body for content. Used by AppLibrary, McpPortal
 * and similar "this is what the dashboard looks like" slides.
 */
export function DashboardChrome({
  breadcrumb,
  rail = [],
  active,
  onRailClick,
  searchPlaceholder = "Search applications, policies, logs…",
  children,
  className = "",
}: {
  breadcrumb: string[];
  rail?: { id: string; label: string; count?: number }[];
  active?: string;
  onRailClick?: (id: string) => void;
  searchPlaceholder?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "flex h-full w-full flex-col overflow-hidden rounded-2xl border border-cf-border bg-cf-bg-100 shadow-[0_18px_48px_rgba(82,16,0,0.08),0_4px_12px_rgba(82,16,0,0.04)]",
        className,
      ].join(" ")}
      data-no-advance
    >
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-cf-border bg-cf-bg-200 px-5 py-3">
        <CloudflareMarkSmall />
        <span className="font-mono text-xs text-cf-text-muted">
          dash.cloudflare.com
        </span>
        <span className="text-cf-text-subtle">·</span>
        <nav className="flex items-center gap-1 text-sm text-cf-text-muted">
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
        <div className="ml-auto flex items-center gap-2 rounded-full border border-cf-border bg-cf-bg-100 px-3 py-1.5 text-sm text-cf-text-subtle">
          <Search className="h-3.5 w-3.5" />
          <span className="font-mono text-xs">{searchPlaceholder}</span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left rail */}
        {rail.length > 0 && (
          <aside className="w-56 flex-shrink-0 border-r border-cf-border bg-cf-bg-200 px-3 py-4">
            <ul className="flex flex-col gap-1">
              {rail.map((item) => {
                const isActive = item.id === active;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onRailClick?.(item.id)}
                      className={[
                        "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition",
                        isActive
                          ? "bg-cf-orange-light text-cf-orange"
                          : "text-cf-text-muted hover:bg-cf-bg-300 hover:text-cf-text",
                      ].join(" ")}
                    >
                      <span>{item.label}</span>
                      {item.count !== undefined && (
                        <span
                          className={[
                            "rounded-full px-1.5 py-0.5 font-mono text-[10px]",
                            isActive
                              ? "bg-cf-orange/15 text-cf-orange"
                              : "bg-cf-bg-100 text-cf-text-subtle",
                          ].join(" ")}
                        >
                          {item.count}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto bg-cf-bg-100">{children}</div>
      </div>
    </div>
  );
}

function CloudflareMarkSmall() {
  return (
    <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="var(--color-cf-orange)" />
      <path
        d="M22.4 18.4c.16-.62.05-1.21-.31-1.65-.34-.41-.84-.66-1.46-.7l-12-.16a.24.24 0 0 1-.19-.1.27.27 0 0 1-.04-.22.34.34 0 0 1 .29-.22l12.1-.16c1.43-.07 2.99-1.23 3.55-2.65l.7-1.83a.43.43 0 0 0 .03-.25 7.7 7.7 0 0 0-14.85-.81 3.46 3.46 0 0 0-2.42-.66c-1.61.16-2.91 1.46-3.07 3.07-.04.41-.01.81.08 1.19A4.9 4.9 0 0 0 0 18.36c0 .14.01.27.02.41a.15.15 0 0 0 .14.13l21.96.01h.05a.34.34 0 0 0 .31-.24l-.08-.27Z"
        fill="#fff"
      />
    </svg>
  );
}
