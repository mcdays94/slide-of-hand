import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clipboard,
  Download,
  Eye,
  EyeOff,
  ShieldCheck,
  Upload,
} from "lucide-react";
import type { SlideDef } from "@/framework/viewer/types";
import { Tag } from "../components/primitives/Tag";
import { BrowserWindow } from "../components/windows/BrowserWindow";
import { Reveal } from "../lib/Reveal";
import { Cite } from "../components/primitives/Cite";
import { SourceFooter } from "../components/primitives/SourceFooter";
import { usePhase } from "@/framework/viewer/PhaseContext";
import { easeButton, easeEntrance } from "../lib/motion";

const CONTROLS = [
  { icon: Clipboard, label: "Copy / paste", on: "Bidirectional", off: "Display-only" },
  { icon: Upload, label: "Upload", on: "Allowed", off: "Blocked" },
  { icon: Download, label: "Download", on: "Allowed", off: "Blocked" },
  { icon: Eye, label: "Print / screenshot", on: "Allowed", off: "Watermark + audit" },
];

const USER_PROMPT =
  "Pull last quarter's customer feedback on SSO and summarise the three loudest themes.";
const AGENT_RESPONSE =
  "Top three themes: onboarding speed (11 customers), SSO depth (8), and billing transparency (5). I've drafted a one-page memo + FAQ, ready to share.";

export const browserIsolationSlide: SlideDef = {
  id: "browser-isolation",
  title: "Browser Isolation for AI",
  layout: "default",
  sectionLabel: "PROTECT",
  sectionNumber: "03",
  /**
   * Phase 0: isolation OFF — exposed direct origin, exfil possible
   * Phase 1: press → isolation flips ON, scan-line wash, controls re-light
   * (Pressing → again advances to the next slide.)
   */
  phases: 1,
  render: () => <BrowserIsolationBody />,
};

function BrowserIsolationBody() {
  const phase = usePhase();
  const isolated = phase >= 1;

  // Replay key bumps every time we re-enter phase 0 (so a second pass animates)
  const [replayKey, setReplayKey] = useState(0);
  useEffect(() => {
    setReplayKey((k) => k + 1);
  }, [phase]);

  return (
    <div className="mx-auto flex h-full w-full max-w-[1480px] flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Tag>Protect</Tag>
          <h2 className="mt-3 text-3xl tracking-[-0.035em] sm:text-5xl">
            Render risky AI in a remote browser.
          </h2>
          <p className="mt-2 max-w-2xl text-cf-text-muted">
            <span className="font-medium text-cf-text">
              Cloudflare Remote Browser Isolation (RBI)
            </span>
            <Cite
              n={2}
              href="https://developers.cloudflare.com/cloudflare-one/remote-browser-isolation/"
            />{" "}
            executes the page on a sandboxed Chromium running on the
            Cloudflare data centre closest to the user. Patented{" "}
            <span className="font-medium text-cf-text">
              Network Vector Rendering (NVR)
            </span>
            <Cite
              n={1}
              href="https://developers.cloudflare.com/reference-architecture/diagrams/security/securing-data-in-use/"
            />{" "}
            intercepts the page's SKIA draw commands, tokenises,
            compresses and encrypts them, and ships them to the local
            browser. Never a video feed, never raw pixels. The laptop
            only ever renders safe vector instructions.
          </p>
        </div>

        {/* Phase toggle (visual only — driven by deck phase) */}
        <PhaseToggle isolated={isolated} />
      </div>

      {/* Body */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <BrowserWindow
          url="https://atlas.acme.io/c/forecast-research"
          title="Atlas · agentic platform"
          isolated={isolated}
          className="aspect-[16/10] min-h-[440px]"
        >
          <FakeAtlasBody isolated={isolated} replayKey={replayKey} />
        </BrowserWindow>

        {/* Controls panel */}
        <div className="flex flex-col gap-4">
          <div className="cf-card flex flex-col gap-2 p-5">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
              Posture · enforced
            </span>
            <h3 className="text-lg leading-tight">Data exfil controls</h3>
            <ul className="mt-2 flex flex-col divide-y divide-cf-border">
              {CONTROLS.map((c) => (
                <li
                  key={c.label}
                  className="flex items-center justify-between gap-3 py-3 text-sm"
                >
                  <span className="flex items-center gap-2 text-cf-text">
                    <c.icon className="h-4 w-4 text-cf-text-muted" />
                    {c.label}
                  </span>
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={isolated ? "off" : "on"}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.25, ease: easeButton }}
                      className={[
                        "rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em]",
                        isolated
                          ? "border-[color:var(--color-cf-success)]/40 bg-cf-success-bg text-cf-success"
                          : "border-[color:var(--color-cf-error)]/40 bg-[color:var(--color-cf-error)]/10 text-cf-error",
                      ].join(" ")}
                    >
                      {isolated ? c.off : c.on}
                    </motion.span>
                  </AnimatePresence>
                </li>
              ))}
            </ul>
          </div>

          <motion.div
            key={`callout-${isolated}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: easeEntrance }}
            className={[
              "rounded-2xl border p-5",
              isolated
                ? "border-[color:var(--color-cf-compute)]/30 bg-[color:var(--color-cf-compute)]/8"
                : "border-[color:var(--color-cf-error)]/30 bg-[color:var(--color-cf-error)]/8",
            ].join(" ")}
          >
            <span
              className="font-mono text-[10px] uppercase tracking-[0.12em]"
              style={{
                color: isolated
                  ? "var(--color-cf-compute)"
                  : "var(--color-cf-error)",
              }}
            >
              {isolated ? "Outcome" : "Risk"}
            </span>
            <p className="mt-1 text-sm text-cf-text">
              {isolated
                ? "The page executes on a sandboxed Chromium running on the closest Cloudflare PoP to the user. We stream tokenised, compressed, encrypted SKIA draw commands via Network Vector Rendering (NVR). No code, no PII, no IP, and no live screen reaches the laptop. Only safe rendering instructions."
                : "User can paste anything into the prompt and exfil any response. There's no audit trail. Your DLP layer sees encrypted traffic only."}
            </p>
          </motion.div>
        </div>
      </div>

      <SourceFooter
        sources={[
          {
            n: 1,
            label:
              "Cloudflare reference architecture · Securing data in use (NVR)",
            href: "https://developers.cloudflare.com/reference-architecture/diagrams/security/securing-data-in-use/",
          },
          {
            n: 2,
            label: "Cloudflare Browser Isolation · product docs",
            href: "https://developers.cloudflare.com/cloudflare-one/remote-browser-isolation/",
          },
        ]}
      />
    </div>
  );
}

/** Visual indicator that mirrors the deck-phase isolation state. */
function PhaseToggle({ isolated }: { isolated: boolean }) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-cf-border bg-cf-bg-200 p-1">
      <motion.span
        layout
        className="absolute pointer-events-none"
        aria-hidden="true"
      />
      <span
        className={[
          "flex items-center gap-2 rounded-full px-4 py-2 font-mono text-xs uppercase tracking-[0.06em] transition-all",
          !isolated
            ? "bg-[color:var(--color-cf-error)]/15 text-cf-error"
            : "text-cf-text-subtle",
        ].join(" ")}
      >
        <EyeOff className="h-3.5 w-3.5" /> Direct
      </span>
      <span
        className={[
          "flex items-center gap-2 rounded-full px-4 py-2 font-mono text-xs uppercase tracking-[0.06em] transition-all",
          isolated
            ? "bg-cf-text text-cf-bg-100 shadow-cf-card"
            : "text-cf-text-subtle",
        ].join(" ")}
      >
        <ShieldCheck className="h-3.5 w-3.5" /> Isolated
      </span>
    </div>
  );
}

/* ====================================================================== */

interface AtlasBodyProps {
  isolated: boolean;
  replayKey: number;
}

function FakeAtlasBody({ isolated, replayKey }: AtlasBodyProps) {
  return (
    <div className="relative grid h-full grid-cols-[200px_1fr] bg-cf-bg-100">
      {/* Left rail */}
      <aside className="flex flex-col border-r border-cf-border bg-cf-bg-200 px-3 py-4">
        <div className="flex items-center gap-2 px-2 pb-3">
          <span
            className="flex h-6 w-6 items-center justify-center rounded-md text-white"
            style={{
              background:
                "linear-gradient(135deg, var(--color-cf-orange) 0%, #B83400 100%)",
            }}
          >
            <span className="font-mono text-[10px] font-medium">A</span>
          </span>
          <span className="text-sm font-medium text-cf-text">Atlas</span>
        </div>
        <button
          type="button"
          data-no-advance
          className="mb-3 flex items-center gap-2 rounded-full border border-cf-border bg-cf-bg-100 px-3 py-1.5 text-xs text-cf-text-muted transition hover:border-cf-orange"
        >
          <span className="text-cf-orange">+</span> New run
        </button>
        <span className="px-2 font-mono text-[9px] uppercase tracking-wider text-cf-text-subtle">
          Recent runs
        </span>
        <ul className="mt-2 flex flex-col gap-0.5 text-xs text-cf-text-muted">
          {[
            { name: "Forecast research", active: true },
            { name: "PR review · auth-svc", active: false },
            { name: "Customer email triage", active: false },
            { name: "Onboarding draft", active: false },
            { name: "Roadmap synthesis", active: false },
          ].map((c) => (
            <li
              key={c.name}
              className={[
                "cursor-default truncate rounded-md px-2 py-1.5 transition",
                c.active
                  ? "bg-cf-orange-light text-cf-orange"
                  : "hover:bg-cf-bg-300",
              ].join(" ")}
            >
              {c.name}
            </li>
          ))}
        </ul>
      </aside>

      {/* Conversation pane */}
      <div className="relative flex flex-col overflow-hidden">
        {/* Run header */}
        <div className="flex items-center justify-between border-b border-cf-border bg-cf-bg-200 px-5 py-3">
          <h4 className="text-sm font-medium text-cf-text">
            Forecast research
          </h4>
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[color:var(--color-cf-info)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-cf-info)]" />
            12 tools available · reasoning
          </span>
        </div>

        {/* Messages */}
        <div className="flex flex-1 flex-col gap-3 overflow-hidden p-5">
          <UserBubble text={USER_PROMPT} replayKey={replayKey} />
          <AgentBubble text={AGENT_RESPONSE} replayKey={replayKey} />
          <InputComposer />
        </div>

        {/* Strong isolation cue overlay — sweeps once when isolated flips on */}
        <AnimatePresence>
          {isolated && (
            <motion.div
              key={`scan-${replayKey}`}
              className="pointer-events-none absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.7, 0] }}
              transition={{ duration: 1.2, ease: easeEntrance }}
              style={{
                background:
                  "linear-gradient(180deg, transparent 0%, rgba(10,149,255,0.3) 50%, transparent 100%)",
              }}
              aria-hidden="true"
            />
          )}
        </AnimatePresence>

        {/* Status pill (bottom-right) */}
        <motion.div
          key={`pill-${isolated}`}
          className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-2 rounded-full border bg-cf-bg-100 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider shadow-cf-card"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: easeEntrance }}
          style={{
            color: isolated
              ? "var(--color-cf-compute)"
              : "var(--color-cf-error)",
            borderColor: isolated
              ? "color-mix(in srgb, var(--color-cf-compute) 40%, transparent)"
              : "color-mix(in srgb, var(--color-cf-error) 40%, transparent)",
          }}
        >
          {isolated ? (
            <ShieldCheck className="h-3 w-3" />
          ) : (
            <EyeOff className="h-3 w-3" />
          )}
          {isolated
            ? "Chromium @ MAN PoP · 14 ms RTT"
            : "Direct origin · exfil possible"}
        </motion.div>
      </div>
    </div>
  );
}

/* ====================================================================== */
/*  Chat bubbles — user right, agent left, animated typewriter on each.   */
/* ====================================================================== */

function UserBubble({ text, replayKey }: { text: string; replayKey: number }) {
  const typed = useTypewriter(text, replayKey, { duration: 1100, startDelay: 250 });
  const isDone = typed === text;
  return (
    <div className="flex justify-end">
      <motion.div
        key={`user-${replayKey}`}
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, ease: easeEntrance }}
        className="max-w-[78%] rounded-2xl rounded-tr-md border bg-cf-orange-light px-4 py-3"
        style={{ borderColor: "color-mix(in srgb, var(--color-cf-orange) 25%, transparent)" }}
      >
        <div className="mb-1 flex items-center justify-end gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-cf-orange">
            Maria · product
          </span>
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cf-orange text-white">
            <span className="font-mono text-[10px] font-medium">M</span>
          </span>
        </div>
        <p className="text-sm leading-relaxed text-cf-text">
          {typed}
          {!isDone && <span className="ml-0.5 inline-block opacity-60">▌</span>}
        </p>
      </motion.div>
    </div>
  );
}

function AgentBubble({ text, replayKey }: { text: string; replayKey: number }) {
  const typed = useTypewriter(text, replayKey, { duration: 1600, startDelay: 1500 });
  const isStarted = typed.length > 0;
  const isDone = typed === text;
  return (
    <div className="flex justify-start">
      <motion.div
        key={`agent-${replayKey}`}
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, delay: 0.15, ease: easeEntrance }}
        className="max-w-[78%] rounded-2xl rounded-tl-md border border-cf-border bg-cf-bg-200 px-4 py-3"
      >
        <div className="mb-1 flex items-center gap-1.5">
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full text-white"
            style={{
              background:
                "linear-gradient(135deg, var(--color-cf-orange) 0%, #B83400 100%)",
            }}
          >
            <span className="font-mono text-[10px] font-medium">A</span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-cf-text-subtle">
            Atlas
          </span>
          {!isStarted && (
            <span className="ml-1 flex gap-1">
              <Dot delay={0} />
              <Dot delay={0.15} />
              <Dot delay={0.3} />
            </span>
          )}
        </div>
        <p className="text-sm leading-relaxed text-cf-text">
          {typed}
          {isStarted && !isDone && (
            <span className="ml-0.5 inline-block opacity-60">▌</span>
          )}
        </p>
      </motion.div>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <motion.span
      className="h-1.5 w-1.5 rounded-full bg-cf-text-subtle"
      animate={{ opacity: [0.3, 1, 0.3] }}
      transition={{ duration: 0.9, delay, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

function InputComposer() {
  return (
    <div className="mt-auto flex items-center gap-2 rounded-full border border-cf-border bg-cf-bg-200 px-4 py-2">
      <span className="flex-1 font-mono text-xs text-cf-text-subtle">
        Send a follow-up to Atlas…
      </span>
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cf-orange text-white">
        <span className="font-mono text-xs">↑</span>
      </span>
    </div>
  );
}

/* ====================================================================== */
/*  useTypewriter — drive a string to grow over `duration` ms after a     */
/*  `startDelay`. Re-runs whenever `replayKey` changes.                   */
/* ====================================================================== */

function useTypewriter(
  text: string,
  replayKey: number,
  opts: { duration: number; startDelay: number },
) {
  const [out, setOut] = useState("");
  useEffect(() => {
    setOut("");
    let raf = 0;
    let start = 0;
    const startTimer = setTimeout(() => {
      start = performance.now();
      const tick = (now: number) => {
        const t = Math.min((now - start) / opts.duration, 1);
        const count = Math.floor(text.length * t);
        setOut(text.slice(0, count));
        if (t < 1) raf = requestAnimationFrame(tick);
        else setOut(text);
      };
      raf = requestAnimationFrame(tick);
    }, opts.startDelay);
    return () => {
      clearTimeout(startTimer);
      cancelAnimationFrame(raf);
    };
  }, [text, replayKey, opts.duration, opts.startDelay]);
  return out;
}

// Re-export Reveal so the slide doesn't break if elsewhere expects it.
export { Reveal };
