import type { ReactNode } from "react";
import type { SlideDef } from "@/framework/viewer/types";
import { Frame } from "../components/Frame";
import { CloudflareLogo } from "../components/CloudflareLogo";
import { CornerBrackets } from "../components/CornerBrackets";

const TOTAL = 7;
const SLIDE_INDEX = 5;

/**
 * Slide 5 — the three-way tug of war.
 *
 * Security ↔ Dev velocity ↔ Business velocity. Dev velocity card
 * has a soft idle glow + tug motion. Security gets a "handed to
 * Cloudflare" badge.
 */
export const tugOfWarSlide: SlideDef = {
  id: "tug-of-war",
  title: "A three-way tug of war",
  layout: "full",
  notes: (
    <>
      <p>
        Most fintechs feel a tug-of-war between security and developer
        velocity. CF247 added a third rope: business velocity. Michael's
        framing is brilliant — by handing the security rope to a partner,
        dev and business pull in the same direction. That's Topic 2.
      </p>
      <p>~30s.</p>
    </>
  ),
  render: () => (
    <Frame current={SLIDE_INDEX} total={TOTAL}>
      <div className="eyebrow">The fintech tension</div>

      <h2 className="h2" style={{ maxWidth: "20ch" }}>
        A <span className="text-orange">three-way</span> tug of war.
      </h2>

      <div
        className="row"
        style={{
          marginTop: "clamp(32px, 5vh, 64px)",
          gap: "clamp(8px, 1.4vw, 20px)",
          alignItems: "stretch",
          width: "100%",
          maxWidth: 1280,
        }}
      >
        <Pillar
          label="Security"
          body="Wants to apply the brakes."
          icon={<BrakeIcon />}
          dimmed
          handedOff
        />
        <Connector tugDirection="pull-left" />
        <Pillar
          label="Dev velocity"
          body="Wants to floor it."
          icon={<RocketIcon />}
          highlight
        />
        <Connector tugDirection="pull-right" />
        <Pillar
          label="Business velocity"
          body="Always wants more, faster."
          icon={<TrendIcon />}
          floatIcon
        />
      </div>

      <p
        className="body"
        style={{
          marginTop: "clamp(24px, 3.5vh, 44px)",
          maxWidth: "56ch",
          color: "var(--cf-text)",
        }}
      >
        Hand the security rope to a partner — and dev and business start pulling in the{" "}
        <span className="text-orange text-strong">same direction</span>.
      </p>
    </Frame>
  ),
};

function Pillar({
  label,
  body,
  icon,
  highlight,
  dimmed,
  handedOff,
  floatIcon,
}: {
  label: string;
  body: string;
  icon: ReactNode;
  highlight?: boolean;
  dimmed?: boolean;
  handedOff?: boolean;
  floatIcon?: boolean;
}) {
  return (
    <div
      className={`card tug-pillar${highlight ? " tug-pillar--highlight" : ""}${
        dimmed ? " tug-pillar--dimmed" : ""
      }`}
      style={{
        flex: 1,
        alignItems: "center",
        textAlign: "center",
        gap: 8,
        background: highlight ? "var(--cf-bg-300)" : "var(--cf-bg-200)",
        borderColor: highlight ? "var(--cf-orange)" : "var(--cf-border)",
        position: "relative",
      }}
    >
      <CornerBrackets />

      {handedOff && (
        <div className="tug-pillar__handoff" aria-hidden="true">
          <CloudflareLogo style={{ height: 14, width: "auto", color: "var(--cf-orange)" }} />
          <span>handed to Cloudflare</span>
        </div>
      )}

      <div
        className={`card__icon${floatIcon ? " tug-pillar__icon--float" : ""}`}
        style={{
          background: highlight ? "var(--cf-orange-light)" : undefined,
        }}
      >
        {icon}
      </div>
      <div
        className="card__title"
        style={{
          color: highlight ? "var(--cf-orange)" : undefined,
        }}
      >
        {label}
      </div>
      <div className="card__body" style={{ textAlign: "center" }}>
        {body}
      </div>
    </div>
  );
}

function Connector({ tugDirection }: { tugDirection: "pull-left" | "pull-right" }) {
  return (
    <div className={`tug-connector tug-connector--${tugDirection}`} aria-hidden>
      <span className="tug-connector__arrow">{tugDirection === "pull-left" ? "←" : "→"}</span>
    </div>
  );
}

function BrakeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M5 5l14 14" />
    </svg>
  );
}

function RocketIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.5-2 5-2 5s3.5-.5 5-2c.85-.85 1-2 0-3-1-1-2.15-.85-3 0Z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}

function TrendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 17 6-6 4 4 8-8" />
      <path d="M14 7h7v7" />
    </svg>
  );
}
