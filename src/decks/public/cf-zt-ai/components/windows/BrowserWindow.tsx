import type { ReactNode } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Lock,
  RotateCw,
  ShieldCheck,
} from "lucide-react";

/**
 * macOS-style browser chrome with URL bar. Use as a wrapper around any
 * "rendered website" content (real iframe or simulated dashboard).
 *
 * The `isolated` flag layers two visual signals on top of the rendered
 * body to communicate Cloudflare RBI's *actual* mechanism:
 *
 *  1. A continuous top-to-bottom scan line, symbolic of the remote
 *     browser executing in Cloudflare's network and streaming back to
 *     this device frame-by-frame.
 *  2. A corner badge that names the technology accurately: serialised
 *     SKIA draw commands streamed via Network Vector Rendering (NVR),
 *     NOT a pixel video feed (and NOT WebRTC, despite what older
 *     copies of this comment used to claim).
 *
 * The static repeating-stripe texture below is a subtle "screen door"
 * effect that reads as "this surface is being remotely rendered".
 */
export function BrowserWindow({
  url = "https://chat.openai.com",
  title,
  isolated = false,
  className = "",
  children,
  onBack,
  onForward,
  onReload,
}: {
  url?: string;
  title?: string;
  isolated?: boolean;
  className?: string;
  children: ReactNode;
  onBack?: () => void;
  onForward?: () => void;
  onReload?: () => void;
}) {
  return (
    <div
      className={[
        "relative flex flex-col overflow-hidden rounded-2xl border-2 bg-cf-bg-200 shadow-[0_18px_48px_rgba(82,16,0,0.08),0_4px_12px_rgba(82,16,0,0.04)] transition-[border-color,box-shadow] duration-300",
        className,
      ].join(" ")}
      style={{
        borderColor: isolated
          ? "var(--color-cf-orange)"
          : "var(--color-cf-border)",
        boxShadow: isolated
          ? "0 0 0 6px color-mix(in srgb, var(--color-cf-orange) 14%, transparent), 0 18px 48px rgba(82,16,0,0.08), 0 4px 12px rgba(82,16,0,0.04)"
          : "0 18px 48px rgba(82,16,0,0.08), 0 4px 12px rgba(82,16,0,0.04)",
      }}
      data-no-advance
    >
      {/* Chrome */}
      <div className="border-b border-cf-border bg-cf-bg-100 px-3 py-2.5">
        <div className="flex items-center gap-3">
          {/* Traffic lights */}
          <div className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
            <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
            <span className="h-3 w-3 rounded-full bg-[#28C840]" />
          </div>

          {/* Nav buttons */}
          <div className="flex gap-1 text-cf-text-subtle">
            <button
              type="button"
              onClick={onBack}
              className="rounded-md p-1 transition hover:bg-cf-bg-300 hover:text-cf-text-muted"
              aria-label="Back"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onForward}
              className="rounded-md p-1 transition hover:bg-cf-bg-300 hover:text-cf-text-muted"
              aria-label="Forward"
            >
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onReload}
              className="rounded-md p-1 transition hover:bg-cf-bg-300 hover:text-cf-text-muted"
              aria-label="Reload"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* URL bar */}
          <div className="flex flex-1 items-center gap-2 rounded-full border border-cf-border bg-cf-bg-200 px-3 py-1 font-mono text-xs text-cf-text-muted">
            <Lock className="h-3 w-3 text-cf-success" strokeWidth={2.5} />
            <span className="truncate">{url}</span>
            {isolated && (
              <span className="ml-auto flex items-center gap-1 rounded-full bg-[color:var(--color-cf-compute)]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[color:var(--color-cf-compute)]">
                <ShieldCheck className="h-2.5 w-2.5" />
                Isolated
              </span>
            )}
          </div>

          {title && (
            <span className="hidden font-mono text-xs text-cf-text-subtle md:inline">
              {title}
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="relative flex-1 overflow-hidden bg-cf-bg-200">
        {children}
        {isolated && (
          <>
            {/* Static "screen-door" stripes — subtle texture that reads
                as "this surface is being remotely rendered". */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "repeating-linear-gradient(0deg, transparent 0, transparent 3px, rgba(10,149,255,0.05) 3px, rgba(10,149,255,0.05) 4px)",
              }}
              aria-hidden="true"
            />

            {/* Continuous scan line — a bright thin band travelling
                top-to-bottom on a loop. We animate the `top` CSS
                property (which IS parent-relative) rather than `y`
                (which Framer treats as element-relative — that gave
                only 1px of travel for a 1px line on the previous
                attempt). */}
            <div
              className="pointer-events-none absolute inset-0 overflow-hidden"
              aria-hidden="true"
            >
              {/* Soft trailing halo */}
              <motion.div
                className="absolute right-0 left-0 h-24"
                style={{
                  background:
                    "linear-gradient(180deg, transparent 0%, rgba(10,149,255,0.18) 60%, rgba(10,149,255,0) 100%)",
                }}
                initial={{ top: "-25%" }}
                animate={{ top: "108%" }}
                transition={{
                  duration: 3.6,
                  repeat: Infinity,
                  ease: "linear",
                  repeatType: "loop",
                }}
              />
              {/* Bright leading edge — 1px line + glow */}
              <motion.div
                className="absolute right-0 left-0 h-px"
                style={{
                  background: "rgba(10,149,255,0.6)",
                  boxShadow:
                    "0 0 14px 2px rgba(10,149,255,0.6), 0 0 28px 4px rgba(10,149,255,0.2)",
                }}
                initial={{ top: "-1%" }}
                animate={{ top: "101%" }}
                transition={{
                  duration: 3.6,
                  repeat: Infinity,
                  ease: "linear",
                  repeatType: "loop",
                }}
              />
            </div>

            {/* Corner badge — accurate description of the underlying
                mechanism (serialized draw commands, not pixel video). */}
            <div className="pointer-events-none absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-full border border-[color:var(--color-cf-compute)]/40 bg-cf-bg-100/95 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-[color:var(--color-cf-compute)]">
              <span
                className="cf-live-dot"
                style={{ background: "var(--color-cf-compute)" }}
              />
              <span>Cloudflare RBI · NVR · draw commands</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
