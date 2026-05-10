import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2,
  Check,
  Fingerprint,
  Laptop,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type { SlideDef } from "@/framework/viewer/types";
import { Tag } from "../components/primitives/Tag";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { usePhase } from "@/framework/viewer/PhaseContext";
import { easeButton, easeEntrance } from "../lib/motion";

interface Persona {
  id: string;
  name: string;
  role: string;
  email: string;
  device: string;
  identity: boolean;
  posture: boolean;
  group: boolean;
  outcome: "allow" | "step-up" | "block";
  reason: string;
}

const PERSONAS: Persona[] = [
  {
    id: "sarah",
    name: "Sarah",
    role: "Backend engineer",
    email: "sarah@acme.io",
    device: "MacBook · managed · OS 15.1",
    identity: true,
    posture: true,
    group: true,
    outcome: "allow",
    reason: "Identity, posture, group all pass. Full Cursor access granted.",
  },
  {
    id: "alex",
    name: "Alex",
    role: "Marketing lead",
    email: "alex@acme.io",
    device: "Personal Windows laptop",
    identity: true,
    posture: false,
    group: true,
    outcome: "step-up",
    reason:
      "Identity ok, but device not enrolled. Routed through Browser Isolation; copy-paste disabled.",
  },
  {
    id: "vendor",
    name: "Contractor",
    role: "External vendor",
    email: "external@vendorcorp.com",
    device: "Unknown",
    identity: false,
    posture: false,
    group: false,
    outcome: "block",
    reason: "No SSO match for AI app group. Request denied; logged.",
  },
];

export const accessPoliciesSlide: SlideDef = {
  id: "access-policies",
  title: "Identity- and posture-aware access",
  layout: "default",
  sectionLabel: "GOVERN",
  sectionNumber: "02",
  /**
   * Phase 0: Sarah (allow)
   * Phase 1: Alex (step-up)
   * Phase 2: Contractor (block)
   * Pressing → on phase 2 advances to the next slide.
   */
  phases: 2,
  render: () => <AccessPoliciesBody />,
};

function AccessPoliciesBody() {
  const phase = usePhase();
  // The phase drives the persona, but the toggle buttons remain
  // clickable so the speaker can jump around manually if needed.
  const [personaId, setPersonaId] = useState(PERSONAS[0].id);
  const [tick, setTick] = useState(0);
  const persona = PERSONAS.find((p) => p.id === personaId)!;

  // Sync persona to the current phase whenever the deck advances.
  useEffect(() => {
    const idx = Math.min(Math.max(phase, 0), PERSONAS.length - 1);
    setPersonaId(PERSONAS[idx].id);
  }, [phase]);

  useEffect(() => {
    setTick((t) => t + 1);
  }, [personaId]);

  return (
    <div className="mx-auto flex h-full w-full max-w-[1480px] flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Tag tone="compute">Govern · Demo</Tag>
          <h2 className="mt-3 text-3xl tracking-[-0.035em] sm:text-5xl">
            Identity-aware. Posture-aware. AI-aware.
          </h2>
          <p className="mt-2 max-w-2xl text-cf-text-muted">
            Pick a persona to see Cloudflare evaluate the request in real
            time. Every step is enforced before the AI app is reached.
          </p>
        </div>

        {/* Persona toggle */}
        <div
          className="flex gap-1 rounded-full border border-cf-border bg-cf-bg-200 p-1"
          data-interactive
        >
          {PERSONAS.map((p) => {
            const isActive = p.id === personaId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPersonaId(p.id)}
                className={[
                  "flex flex-col items-start rounded-full px-4 py-2 text-left transition",
                  isActive
                    ? "bg-cf-text text-cf-bg-100 shadow-cf-card"
                    : "text-cf-text-muted hover:bg-cf-bg-300 hover:text-cf-text",
                ].join(" ")}
              >
                <span className="text-xs font-medium">{p.name}</span>
                <span
                  className={[
                    "font-mono text-[10px] uppercase tracking-[0.06em]",
                    isActive ? "opacity-70" : "opacity-50",
                  ].join(" ")}
                >
                  {p.role}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Flow diagram */}
      <div className="relative grid flex-1 grid-cols-[260px_1fr_240px] gap-6">
        {/* User card */}
        <CornerBrackets className="cf-card flex flex-col gap-3 p-5">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
            User · context
          </span>
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-cf-orange-light text-cf-orange">
              <Building2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-medium text-cf-text">
                {persona.name}
              </h3>
              <span className="block font-mono text-[10px] uppercase tracking-wider text-cf-text-subtle">
                {persona.email}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-2 border-t border-dashed border-cf-border pt-3 text-sm text-cf-text-muted">
            <span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-cf-text-subtle">
                Role
              </span>
              <br />
              {persona.role}
            </span>
            <span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-cf-text-subtle">
                Device
              </span>
              <br />
              {persona.device}
            </span>
          </div>
        </CornerBrackets>

        {/* Pipeline */}
        <div className="relative flex flex-col justify-center">
          <div className="grid grid-cols-3 gap-3">
            <PipelineStage
              icon={Fingerprint}
              title="Identity"
              detail="SSO via Okta"
              ok={persona.identity}
              tick={tick}
              delay={0.2}
            />
            <PipelineStage
              icon={Laptop}
              title="Device posture"
              detail="MDM + WARP client"
              ok={persona.posture}
              tick={tick}
              delay={0.5}
            />
            <PipelineStage
              icon={ShieldCheck}
              title="Group / role"
              detail="Membership: ai-pilots"
              ok={persona.group}
              tick={tick}
              delay={0.8}
            />
          </div>

          {/* Animated request dot */}
          <RequestPath tick={tick} stagesPassed={[persona.identity, persona.posture, persona.group]} />
        </div>

        {/* Outcome */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${personaId}-outcome`}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.4, ease: easeEntrance }}
            className="cf-corner-brackets cf-card relative flex flex-col gap-3 p-5"
            style={{
              background:
                persona.outcome === "allow"
                  ? "color-mix(in srgb, var(--color-cf-success) 8%, var(--color-cf-bg-200))"
                  : persona.outcome === "step-up"
                    ? "color-mix(in srgb, var(--color-cf-warning) 8%, var(--color-cf-bg-200))"
                    : "color-mix(in srgb, var(--color-cf-error) 8%, var(--color-cf-bg-200))",
            }}
          >
            <span className="cf-corner-bracket -left-[4px] -top-[4px]" />
            <span className="cf-corner-bracket -right-[4px] -top-[4px]" />
            <span className="cf-corner-bracket -bottom-[4px] -left-[4px]" />
            <span className="cf-corner-bracket -bottom-[4px] -right-[4px]" />

            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
              Outcome
            </span>
            <OutcomeBadge outcome={persona.outcome} />
            <p className="text-sm text-cf-text">{persona.reason}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom strip — Real Cloudflare Access policy table */}
      <CornerBrackets className="cf-card flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
            Cloudflare Access policy · "AI Pilots: full access"
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
            Decision · Allow
          </span>
        </div>
        <table className="w-full text-left font-mono text-xs">
          <thead>
            <tr className="border-b border-cf-border text-cf-text-subtle">
              <th className="py-2 pr-3 font-medium uppercase tracking-[0.06em]">Action</th>
              <th className="py-2 pr-3 font-medium uppercase tracking-[0.06em]">Rule type</th>
              <th className="py-2 pr-3 font-medium uppercase tracking-[0.06em]">Selector</th>
              <th className="py-2 font-medium uppercase tracking-[0.06em]">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-dashed border-cf-border">
              <td className="py-2 pr-3">
                <span className="rounded-md bg-[color:var(--color-cf-success)]/10 px-2 py-0.5 text-cf-success">
                  Allow
                </span>
              </td>
              <td className="py-2 pr-3 text-cf-orange">Include</td>
              <td className="py-2 pr-3 text-cf-text-muted">Emails ending in</td>
              <td className="py-2 text-cf-text">@acme.io</td>
            </tr>
            <tr className="border-b border-dashed border-cf-border">
              <td className="py-2 pr-3 text-cf-text-subtle">·</td>
              <td className="py-2 pr-3 text-[color:var(--color-cf-info)]">Require</td>
              <td className="py-2 pr-3 text-cf-text-muted">Identity provider group</td>
              <td className="py-2 text-cf-text">Okta · ai-pilots</td>
            </tr>
            <tr className="border-b border-dashed border-cf-border">
              <td className="py-2 pr-3 text-cf-text-subtle">·</td>
              <td className="py-2 pr-3 text-[color:var(--color-cf-info)]">Require</td>
              <td className="py-2 pr-3 text-cf-text-muted">Device posture</td>
              <td className="py-2 text-cf-text">WARP enrolled · Crowdstrike clean</td>
            </tr>
            <tr>
              <td className="py-2 pr-3 text-cf-text-subtle">·</td>
              <td className="py-2 pr-3 text-cf-error">Exclude</td>
              <td className="py-2 pr-3 text-cf-text-muted">User Risk Score</td>
              <td className="py-2 text-cf-text">High</td>
            </tr>
          </tbody>
        </table>
        <p className="font-mono text-[10px] text-cf-text-subtle">
          Same selectors are available via Terraform + the Access API ·{" "}
          <span className="text-cf-text-muted">developers.cloudflare.com/cloudflare-one/api-terraform/</span>
        </p>
      </CornerBrackets>
    </div>
  );
}

function PipelineStage({
  icon: Icon,
  title,
  detail,
  ok,
  tick,
  delay,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  detail: string;
  ok: boolean;
  tick: number;
  delay: number;
}) {
  return (
    <motion.div
      key={`${tick}-${title}`}
      initial={{ opacity: 0, y: 12, boxShadow: "0 0 0 0 rgba(0,0,0,0)" }}
      animate={{
        opacity: 1,
        y: 0,
        // Soft glow that pulses once on entry — green for pass, red for fail.
        // Final state holds a steady, subtle outer glow.
        boxShadow: ok
          ? [
              "0 0 0 0 rgba(22,163,74,0)",
              "0 0 24px 6px rgba(22,163,74,0.45)",
              "0 0 14px 2px rgba(22,163,74,0.30)",
            ]
          : [
              "0 0 0 0 rgba(220,38,38,0)",
              "0 0 24px 6px rgba(220,38,38,0.45)",
              "0 0 14px 2px rgba(220,38,38,0.30)",
            ],
      }}
      transition={{
        duration: 0.6,
        delay,
        ease: easeEntrance,
        boxShadow: { duration: 1.4, delay, times: [0, 0.4, 1] },
      }}
      className={[
        "cf-corner-brackets relative flex flex-col gap-2 rounded-xl border bg-cf-bg-200 p-5",
        ok
          ? "border-[color:var(--color-cf-success)]/50"
          : "border-[color:var(--color-cf-error)]/50",
      ].join(" ")}
    >
      <span className="cf-corner-bracket -left-[4px] -top-[4px]" />
      <span className="cf-corner-bracket -right-[4px] -top-[4px]" />
      <span className="cf-corner-bracket -bottom-[4px] -left-[4px]" />
      <span className="cf-corner-bracket -bottom-[4px] -right-[4px]" />

      <div className="flex items-center justify-between">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-md"
          style={{
            background: ok
              ? "color-mix(in srgb, var(--color-cf-success) 18%, transparent)"
              : "color-mix(in srgb, var(--color-cf-error) 18%, transparent)",
            color: ok ? "var(--color-cf-success)" : "var(--color-cf-error)",
          }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full"
          style={{
            background: ok
              ? "color-mix(in srgb, var(--color-cf-success) 20%, transparent)"
              : "color-mix(in srgb, var(--color-cf-error) 20%, transparent)",
            color: ok ? "var(--color-cf-success)" : "var(--color-cf-error)",
          }}
        >
          {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        </span>
      </div>
      <h4 className="text-base font-medium text-cf-text">{title}</h4>
      <span className="font-mono text-[10px] uppercase tracking-wider text-cf-text-subtle">
        {detail}
      </span>
    </motion.div>
  );
}

function RequestPath({
  tick,
  stagesPassed,
}: {
  tick: number;
  stagesPassed: boolean[];
}) {
  // Animate a horizontal bar growing left→right, stopping at the first
  // failed stage (or running to the end if every stage passes). Bar stops
  // visually under the offending stage's centre.
  const stopAt = stagesPassed.findIndex((s) => !s);
  const totalStages = stagesPassed.length;
  // 0.5 puts the bar's leading edge under the centre of the failing stage
  // card; full traversal puts it under the end of the last card.
  const target = stopAt === -1 ? totalStages : stopAt + 0.5;
  const fraction = target / totalStages;
  const allPass = stopAt === -1;
  const color = allPass ? "var(--color-cf-success)" : "var(--color-cf-error)";

  return (
    <>
      {/* Animated bar */}
      <motion.div
        key={`${tick}-path`}
        className="absolute -bottom-2 left-0 h-1 rounded-full"
        style={{ background: color }}
        initial={{ width: "0%" }}
        animate={{ width: `${fraction * 100}%` }}
        transition={{
          duration: allPass ? 1.2 : 0.85 + 0.4 * fraction,
          ease: easeButton,
        }}
      />
      {/* Stop indicator at the failure point — small ring under the
          failing stage's centre. Tells the audience "this is where the
          request was denied." */}
      {!allPass && (
        <motion.span
          key={`${tick}-stop`}
          className="absolute -bottom-3 z-10 flex h-3 w-3 items-center justify-center rounded-full"
          style={{
            left: `${fraction * 100}%`,
            transform: "translateX(-50%)",
            background: color,
            boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 30%, transparent)`,
          }}
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: [0.4, 1.3, 1] }}
          transition={{
            duration: 0.5,
            delay: 0.85 + 0.4 * fraction,
            ease: easeButton,
          }}
        >
          <X className="h-2 w-2 text-cf-bg-100" strokeWidth={3} />
        </motion.span>
      )}
    </>
  );
}

function OutcomeBadge({ outcome }: { outcome: Persona["outcome"] }) {
  const map = {
    allow: {
      icon: Check,
      label: "Allow",
      color: "var(--color-cf-success)",
    },
    "step-up": {
      icon: Sparkles,
      label: "Step-up: Browser Isolation",
      color: "var(--color-cf-warning)",
    },
    block: {
      icon: X,
      label: "Block",
      color: "var(--color-cf-error)",
    },
  } as const;
  const m = map[outcome];
  return (
    <span
      className="inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 font-mono text-xs font-medium uppercase tracking-[0.06em]"
      style={{
        color: m.color,
        borderColor: m.color + "55",
        background: m.color + "15",
      }}
    >
      <m.icon className="h-3 w-3" />
      {m.label}
    </span>
  );
}
