import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import type { SlideDef } from "@/framework/viewer/types";
import { Tag } from "../components/primitives/Tag";
import { ChatWindow } from "../components/windows/ChatWindow";
import { Cite } from "../components/primitives/Cite";
import { SourceFooter } from "../components/primitives/SourceFooter";
import { usePhase } from "@/framework/viewer/PhaseContext";

const SCENARIOS = [
  {
    id: "without",
    label: "Without Cloudflare",
    title: "Source code → public AI",
    badge: "Vulnerable",
    accent: "var(--color-cf-error)",
    icon: AlertTriangle,
    mode: "response" as const,
    description:
      "Engineer pastes proprietary auth code into ChatGPT to review. The model returns advice, and the code is now part of someone else's training corpus.",
  },
  {
    id: "with",
    label: "With Cloudflare",
    title: "DLP intercepts at the edge",
    badge: "Protected",
    accent: "var(--color-cf-success)",
    icon: ShieldCheck,
    mode: "blocked" as const,
    description:
      "Same prompt, same engineer. Cloudflare Gateway inspects the body, matches the secret + source-code rule, and blocks the request before it leaves your network.",
  },
];

const PROMPT = `Here's our backend authentication module. Please review for vulnerabilities:`;

const CODE = `const SECRET_KEY = "sk_live_4f8d9e3b2c1a";

export function signToken(userId: string) {
  const payload = { userId, exp: Date.now() + 3600_000 };
  return base64(JSON.stringify(payload)) + "." + SECRET_KEY;
}`;

export const promptGuardSlide: SlideDef = {
  id: "prompt-guard",
  title: "Prompt Guard · DLP on every prompt",
  layout: "default",
  sectionLabel: "PROTECT",
  sectionNumber: "03",
  /**
   * Phase 0: "Without Cloudflare" — show the risk first.
   * Phase 1: "With Cloudflare"   — show the save.
   * Pressing → on phase 1 moves to the next slide.
   */
  phases: 1,
  render: () => <PromptGuardSlideBody />,
};

function PromptGuardSlideBody() {
  const phase = usePhase();
  // Default to the unprotected scenario; the deck phase drives the
  // toggle but speaker can also click the buttons directly.
  const [scenarioId, setScenarioId] = useState<"without" | "with">("without");
  const [replayKey, setReplayKey] = useState(0);
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;

  // Sync scenario to the current phase whenever the deck advances.
  useEffect(() => {
    const targetId = phase >= 1 ? "with" : "without";
    setScenarioId((prev) => {
      if (prev === targetId) return prev;
      setReplayKey((k) => k + 1);
      return targetId;
    });
  }, [phase]);

  function setScenario(id: "without" | "with") {
    setScenarioId(id);
    setReplayKey((k) => k + 1);
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-[1480px] flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Tag>Protect · Demo</Tag>
          <h2 className="mt-3 text-3xl tracking-[-0.035em] sm:text-5xl">
            Stop secrets at the prompt boundary.
          </h2>
          <p className="mt-2 max-w-xl text-cf-text-muted">
            Toggle below to compare a vanilla browser-to-AI flow against the
            same flow protected by{" "}
            <span className="font-medium text-cf-orange">Cloudflare Gateway DLP</span>
            <Cite
              n={2}
              href="https://developers.cloudflare.com/cloudflare-one/data-loss-prevention/"
            />
            .
          </p>
        </div>

        {/* Scenario toggle */}
        <div
          className="flex gap-1 rounded-full border border-cf-border bg-cf-bg-200 p-1"
          data-interactive
        >
          {SCENARIOS.map((s) => {
            const isActive = s.id === scenarioId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setScenario(s.id as "without" | "with")}
                className={[
                  "flex items-center gap-2 rounded-full px-4 py-2 font-mono text-xs uppercase tracking-[0.06em] transition",
                  isActive
                    ? "bg-cf-text text-cf-bg-100 shadow-cf-card"
                    : "text-cf-text-muted hover:bg-cf-bg-300 hover:text-cf-text",
                ].join(" ")}
              >
                <s.icon className="h-3.5 w-3.5" />
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body — chat + commentary */}
      <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]">
        <motion.div
          key={`chat-${scenarioId}-${replayKey}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-center"
        >
          <ChatWindow
            title="AI Agent · paste-and-review"
            user="Sarah · backend engineer"
            assistant={scenarioId === "with" ? "AI Agent (intercepted)" : "AI Agent"}
            prompt={PROMPT}
            code={CODE}
            mode={scenario.mode}
            replayKey={`${scenarioId}-${replayKey}`}
            autoplay
            className="w-full max-w-2xl"
          />
        </motion.div>

        <div className="flex flex-col justify-center gap-4">
          <div
            className="flex flex-col gap-4 rounded-2xl border p-6 transition-colors"
            style={{
              borderColor: scenario.accent + "55",
              background: scenario.accent + "10",
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full"
                style={{ background: scenario.accent + "20", color: scenario.accent }}
              >
                <scenario.icon className="h-5 w-5" />
              </span>
              <div>
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.12em]"
                  style={{ color: scenario.accent }}
                >
                  {scenario.badge}
                </span>
                <h3 className="text-lg leading-tight">{scenario.title}</h3>
              </div>
            </div>
            <p className="text-sm text-cf-text-muted">{scenario.description}</p>
          </div>

          <div className="cf-card flex flex-col gap-3 p-5">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
              DLP profiles in flight
              <Cite
                n={1}
                href="https://developers.cloudflare.com/cloudflare-one/data-loss-prevention/dlp-profiles/predefined-profiles/"
              />
            </span>
            {[
              { kind: "Credentials & Secrets", detail: "Stripe sk_live_*, AWS keys, GH PATs, …" },
              { kind: "Source code", detail: "Rust regex on POST body" },
              { kind: "Custom profile", detail: "Your patterns + uploaded datasets" },
            ].map((r) => (
              <div
                key={r.kind}
                className="flex items-center justify-between gap-2 border-b border-dashed border-cf-border pb-2 last:border-0 last:pb-0"
              >
                <span className="text-sm text-cf-text">{r.kind}</span>
                <span className="font-mono text-xs text-cf-text-subtle">
                  {r.detail}
                </span>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setReplayKey((k) => k + 1)}
            className="cf-btn-ghost self-start"
            data-interactive
          >
            Replay animation
          </button>
        </div>
      </div>

      <SourceFooter
        sources={[
          {
            n: 1,
            label:
              "Cloudflare DLP · predefined profiles (Credentials & Secrets)",
            href: "https://developers.cloudflare.com/cloudflare-one/data-loss-prevention/dlp-profiles/predefined-profiles/",
          },
          {
            n: 2,
            label: "Cloudflare Gateway · DLP overview",
            href: "https://developers.cloudflare.com/cloudflare-one/data-loss-prevention/",
          },
        ]}
      />
    </div>
  );
}
