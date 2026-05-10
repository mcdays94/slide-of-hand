import type { ReactNode } from "react";

/** Small uppercase-mono badge / pill. */
export function Tag({
  children,
  tone = "orange",
  className = "",
}: {
  children: ReactNode;
  tone?: "orange" | "muted" | "success" | "warning" | "error" | "info" | "ai" | "compute";
  className?: string;
}) {
  const tones: Record<string, string> = {
    orange: "bg-cf-orange-light text-cf-orange border-cf-orange-light",
    muted:
      "bg-cf-bg-100 text-cf-text-muted border-cf-border",
    success: "bg-cf-success-bg text-cf-success border-[color:var(--color-cf-success)]/20",
    warning: "bg-[color:var(--color-cf-warning)]/10 text-[color:var(--color-cf-warning)] border-[color:var(--color-cf-warning)]/20",
    error: "bg-[color:var(--color-cf-error)]/10 text-[color:var(--color-cf-error)] border-[color:var(--color-cf-error)]/20",
    info: "bg-[color:var(--color-cf-info)]/10 text-[color:var(--color-cf-info)] border-[color:var(--color-cf-info)]/20",
    ai: "bg-[color:var(--color-cf-ai)]/10 text-[color:var(--color-cf-ai)] border-[color:var(--color-cf-ai)]/20",
    compute: "bg-[color:var(--color-cf-compute)]/10 text-[color:var(--color-cf-compute)] border-[color:var(--color-cf-compute)]/20",
  };
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.06em]",
        tones[tone],
        className,
      ].join(" ")}
    >
      {children}
    </span>
  );
}
