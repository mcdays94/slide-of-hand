import type { CSSProperties, ReactNode } from "react";
import type { SlideDef } from "@/framework/viewer/types";
import { Frame } from "../components/Frame";
import { CloudflareLogo } from "../components/CloudflareLogo";
import { CornerBrackets } from "../components/CornerBrackets";

const TOTAL = 7;
const SLIDE_INDEX = 4;

/**
 * Slide 4 — "A whole class of problems just becomes forgotten."
 *
 * Visualised as the Cloudflare request path: a glowing pulse traverses
 * DNS → TLS → DDoS → WAF, arriving at the CF247 origin. Two more pulses
 * are blocked at DDoS and WAF respectively.
 */
export const forgottenProblemsSlide: SlideDef = {
  id: "forgotten-problems",
  title: "A whole class of problems just becomes forgotten",
  layout: "full",
  notes: (
    <>
      <p>
        Once you offload the security perimeter, a class of problems just
        become "forgotten" for the engineering team — DDoS, WAF, certificate
        management, even DNS-as-code via Terraform. That's the shift Michael
        will speak to in Topic 1.
      </p>
      <p>~30s.</p>
    </>
  ),
  render: () => (
    <Frame current={SLIDE_INDEX} total={TOTAL}>
      <div className="eyebrow">What gets offloaded</div>

      <h2 className="h2" style={{ maxWidth: "20ch" }}>
        A whole class of problems just{" "}
        <span className="text-orange">becomes forgotten</span>.
      </h2>

      <div className="flow" aria-label="Request path through Cloudflare">
        <div className="flow__line" aria-hidden="true">
          <span className="flow__pulse" aria-hidden="true" />
          <span className="flow__pulse flow__pulse--blocked-ddos" aria-hidden="true" />
          <span className="flow__pulse flow__pulse--blocked-waf" aria-hidden="true" />
        </div>

        <RequestEndpoint />

        <div className="flow__cf-zone">
          <div className="flow__cf-tab" aria-hidden="true">
            <CloudflareLogo style={{ height: 16, width: "auto", color: "var(--cf-orange)" }} />
            <span>Cloudflare</span>
          </div>

          <FlowStage stage={0} icon={<DnsIcon />} title="DNS" accent="var(--accent-violet)" />
          <FlowStage stage={1} icon={<TlsIcon />} title="TLS" accent="var(--accent-green)" />
          <FlowStage stage={2} icon={<ShieldIcon />} title="DDoS" accent="var(--accent-red)" />
          <FlowStage stage={3} icon={<WAFIcon />} title="WAF" accent="var(--accent-blue)" />
        </div>

        <OriginEndpoint />
      </div>
    </Frame>
  ),
};

function RequestEndpoint() {
  return (
    <div className="flow__endpoint flow__endpoint--request" aria-hidden="true">
      <div className="flow__endpoint-icon">
        <RequestIcon />
      </div>
      <div className="flow__endpoint-label">Request</div>
    </div>
  );
}

function OriginEndpoint() {
  return (
    <div className="flow__endpoint flow__endpoint--origin" aria-hidden="true">
      <div className="flow__endpoint-icon flow__endpoint-icon--logo">
        <img
          src="/cf247-dtx-manchester/logos/carfinance247.png"
          alt=""
          style={{ width: "78%", height: "78%", objectFit: "contain" }}
        />
      </div>
      <div className="flow__endpoint-label">Origin</div>
    </div>
  );
}

function FlowStage({
  stage,
  icon,
  title,
  accent,
}: {
  stage: 0 | 1 | 2 | 3;
  icon: ReactNode;
  title: string;
  accent: string;
}) {
  return (
    <div
      className="flow__stage"
      data-stage={stage}
      style={{ "--accent": accent } as CSSProperties}
    >
      <CornerBrackets />
      <div className="flow__stage-icon" aria-hidden="true">
        {icon}
      </div>
      <div className="flow__stage-title">{title}</div>
    </div>
  );
}

function RequestIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M2 12h20" />
      <path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10Z" />
    </svg>
  );
}

function DnsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 4h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
      <path d="M5 13h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2Z" />
      <path d="M7 7.5h.01" />
      <path d="M7 16.5h.01" />
    </svg>
  );
}

function TlsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      <circle cx="12" cy="16" r="1" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function WAFIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 14l3 3 5-6" />
    </svg>
  );
}
