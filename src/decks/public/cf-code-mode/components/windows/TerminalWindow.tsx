import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { easeButton } from "../../lib/motion";

/**
 * Reusable macOS-style terminal window.
 *
 * Two modes:
 *   - `lines`: pre-classified array → renders all lines, optionally typed
 *   - `staticLines`: just shows lines as plain text, no animation
 *
 * Supported line kinds (auto-detected by prefix when using `markdownLines`):
 *   `$ cmd`     → user input (orange caret)
 *   `> info`    → indented info (blue)
 *   `✓ ok`      → success (green)
 *   `! warn`    → warning (amber)
 *   `✗ err`     → error (red)
 *   anything    → output (light grey)
 */
export type TerminalLineKind =
  | "input"
  | "output"
  | "info"
  | "success"
  | "warning"
  | "error";

export interface TerminalLine {
  kind: TerminalLineKind;
  text: string;
  /** Highlight emphasis (renders text in white). */
  emphasis?: boolean;
}

export interface TerminalWindowProps {
  /** Title shown in the chrome bar. */
  title?: string;
  /** Pre-classified lines. */
  lines: TerminalLine[];
  /** When true, lines reveal one-by-one (typewriter cadence). */
  animate?: boolean;
  /** Time between lines in seconds. */
  perLineDelay?: number;
  /** Max height of the body. Default 480px. */
  height?: string | number;
  className?: string;
  /** Show a blinking caret on the last line. */
  caret?: boolean;
  /** Restart key — bumps to replay the animation. */
  replayKey?: number | string;
}

const KIND_COLOR: Record<TerminalLineKind, string> = {
  input: "var(--color-cf-orange)",
  output: "rgba(207, 207, 207, 0.95)",
  info: "#7AA7E5",
  success: "var(--color-cf-success)",
  warning: "var(--color-cf-warning)",
  error: "#FF7A7A",
};

const KIND_PREFIX: Record<TerminalLineKind, string | null> = {
  input: "$",
  output: null,
  info: "›",
  success: "✓",
  warning: "!",
  error: "✗",
};

export function TerminalWindow({
  title = "~/cloudflare-zero-trust",
  lines,
  animate = true,
  perLineDelay = 0.4,
  height = 480,
  className = "",
  caret = true,
  replayKey,
}: TerminalWindowProps) {
  const [shown, setShown] = useState(animate ? 0 : lines.length);

  useEffect(() => {
    if (!animate) {
      setShown(lines.length);
      return;
    }
    setShown(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < lines.length; i++) {
      timers.push(
        setTimeout(() => setShown((s) => Math.max(s, i + 1)), i * perLineDelay * 1000),
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [animate, lines, perLineDelay, replayKey]);

  return (
    <div
      className={[
        "overflow-hidden rounded-2xl border border-[#2a2a2a] bg-[#0E0E0F] shadow-[0_18px_48px_rgba(0,0,0,0.18),0_4px_12px_rgba(0,0,0,0.12)]",
        className,
      ].join(" ")}
      data-no-advance
    >
      {/* Chrome bar */}
      <div className="flex items-center gap-2 border-b border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2.5">
        <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
        <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
        <span className="h-3 w-3 rounded-full bg-[#28C840]" />
        <span className="flex-1 text-center font-mono text-xs tracking-[0.04em] text-[#888]">
          {title}
        </span>
        <span className="w-12" />
      </div>

      {/* Body */}
      <div
        className="cf-no-scrollbar overflow-auto px-6 py-5 font-mono"
        style={{ height: typeof height === "number" ? `${height}px` : height }}
      >
        {lines.slice(0, shown).map((line, i) => {
          const color = KIND_COLOR[line.kind];
          const prefix = KIND_PREFIX[line.kind];
          const isLastVisible = i === shown - 1;
          return (
            <motion.div
              key={`l-${i}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: easeButton }}
              className="flex items-baseline gap-2 leading-relaxed"
              style={{
                fontSize: "clamp(13px, 1.05vw, 16px)",
                paddingLeft: line.kind === "info" ? 16 : 0,
              }}
            >
              {prefix && (
                <span style={{ color, flexShrink: 0 }}>{prefix}</span>
              )}
              <span
                style={{
                  color: line.emphasis ? "#fff" : color,
                  whiteSpace: "pre-wrap",
                  flex: 1,
                }}
              >
                {line.text}
              </span>
              {caret && isLastVisible && shown === lines.length && (
                <span
                  className="cf-caret inline-block"
                  style={{
                    width: "0.55em",
                    height: "1em",
                    background: "var(--color-cf-orange)",
                    marginLeft: 4,
                  }}
                />
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Helper: convert markdown-style prefixed strings to TerminalLine[].
 * E.g. ["$ npm test", "✓ all green", "> compiled in 1.2s"]
 */
export function parseTerminalLines(raw: string[]): TerminalLine[] {
  return raw.map((s) => {
    const t = s.trimStart();
    if (t.startsWith("$ ")) return { kind: "input", text: t.slice(2) };
    if (t.startsWith("> ")) return { kind: "info", text: t.slice(2) };
    if (t.startsWith("✓ ") || t.startsWith("\u2713 "))
      return { kind: "success", text: t.replace(/^[\u2713✓]\s*/, "") };
    if (t.startsWith("! ")) return { kind: "warning", text: t.slice(2) };
    if (t.startsWith("✗ ") || t.startsWith("\u2717 "))
      return { kind: "error", text: t.replace(/^[\u2717✗]\s*/, "") };
    return { kind: "output", text: s };
  });
}
