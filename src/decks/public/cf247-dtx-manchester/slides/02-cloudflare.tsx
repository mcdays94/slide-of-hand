import type { ReactNode } from "react";
import type { SlideDef } from "@/framework/viewer/types";
import { Frame } from "../components/Frame";
import { CornerBrackets } from "../components/CornerBrackets";
import { Globe3D } from "../globe";

const TOTAL = 7;
const SLIDE_INDEX = 2;

/**
 * Slide 2 — what is Cloudflare.
 *
 * Full-bleed 3D globe + 4 product pillar cards on the right + 4 stat
 * cards along the bottom. The globe spins with backbone arcs, traffic
 * flow dots, and a gold beacon on Manchester (DTX 2026's host city).
 */
export const cloudflareSlide: SlideDef = {
  id: "cloudflare",
  title: "We're the connectivity cloud",
  layout: "full",
  notes: (
    <>
      <p>
        Cloudflare in 30 seconds. We're a connectivity cloud: security,
        performance, networking, and AI primitives, delivered at the edge.
        ~20% of the web sits behind us; 330+ cities; &lt;50ms from 95% of
        internet users.
      </p>
      <p>Glance at the globe — Manchester is highlighted, right here in the room with us.</p>
      <p>~30s.</p>
    </>
  ),
  render: () => (
    <Frame current={SLIDE_INDEX} total={TOTAL}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      >
        {/* Right-side product pillars — sit BEHIND the globe (z-index 0) so the
            orange connection arcs sweep OVER them. */}
        <div
          style={{
            position: "absolute",
            top: "clamp(72px, 9vh, 116px)",
            bottom: "clamp(200px, 24vh, 280px)",
            right: "clamp(20px, 2.4vw, 40px)",
            width: "min(34ch, 30%)",
            zIndex: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "clamp(10px, 1.2vh, 18px)",
            pointerEvents: "none",
          }}
        >
          <div className="eyebrow" style={{ margin: 0, textAlign: "right" }}>
            The Connectivity Cloud
          </div>
          <PillarCard
            slot={0}
            icon={<ApplicationServicesIcon />}
            name="Application Services"
            desc="WAF, DDoS, CDN, Bot, API & Page Shield."
            accent="var(--cf-orange)"
          />
          <PillarCard
            slot={1}
            icon={<CloudflareOneIcon />}
            name="Cloudflare One"
            desc="Zero Trust SASE — Access, Gateway, Tunnel, CASB, DLP."
            accent="#0A95FF"
          />
          <PillarCard
            slot={2}
            icon={<DeveloperPlatformIcon />}
            name="Developer Platform"
            desc="Workers, Pages, R2, KV, D1, Durable Objects, Queues."
            accent="#9616FF"
          />
          <PillarCard
            slot={3}
            icon={<AIIcon />}
            name="AI"
            desc="Workers AI, AI Gateway, Vectorize, AutoRAG."
            accent="#19A14B"
          />
        </div>

        {/* Globe — full bleed. z-index 1 so canvas+arcs draw OVER the cards. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            pointerEvents: "none",
            background:
              "radial-gradient(circle at 50% 55%, rgba(255, 72, 1, 0.10) 0%, rgba(255, 72, 1, 0) 55%)",
          }}
        >
          <Globe3D
            spinSpeed={1.6}
            cameraDistance={3.2}
            tiltX={0.38}
            initialRotationY={3.45}
            showPopDots
            showNetworkArcs
            showTrafficFlow
            showManchesterPulse
            showGraticule
            dotColor="#0A95FF"
            landColor="#FF4801"
            arcColor="#FF4801"
            manchesterColor="#FFCC00"
            trafficColor="#FFE38A"
            sphereOpacity={0.12}
          />
        </div>

        {/* Top-left text column */}
        <div
          style={{
            position: "absolute",
            top: "clamp(64px, 8vh, 100px)",
            left: "clamp(20px, 2.4vw, 40px)",
            maxWidth: "min(38ch, 42%)",
            zIndex: 2,
            textAlign: "left",
            display: "flex",
            flexDirection: "column",
            gap: "clamp(12px, 1.6vh, 22px)",
            pointerEvents: "none",
          }}
        >
          <div className="eyebrow" style={{ margin: 0 }}>
            What is Cloudflare
          </div>
          <h2 className="h2" style={{ maxWidth: "14ch", margin: 0 }}>
            We're the <span className="text-orange">connectivity cloud</span>.
          </h2>
          <p
            className="body"
            style={{
              color: "var(--cf-text-muted)",
              fontSize: "clamp(14px, 1.4vw, 20px)",
              margin: 0,
            }}
          >
            Security, performance, networking and AI primitives — at the edge, in front of roughly a
            fifth of the web.
          </p>
          <div
            style={{
              marginTop: "clamp(4px, 0.6vh, 10px)",
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 14px",
              background: "var(--cf-bg-200)",
              border: "1px solid var(--cf-border)",
              borderRadius: 999,
              fontFamily: "var(--font-mono)",
              fontSize: "clamp(11px, 0.95vw, 13px)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--cf-text-muted)",
              alignSelf: "flex-start",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#FFCC00",
                boxShadow: "0 0 10px 3px rgba(255, 204, 0, 0.6)",
                flexShrink: 0,
              }}
            />
            Manchester PoP — that's us, right here
          </div>
        </div>

        {/* Stats row */}
        <div
          style={{
            position: "absolute",
            bottom: "clamp(64px, 8vh, 100px)",
            left: "clamp(20px, 2.4vw, 40px)",
            right: "clamp(20px, 2.4vw, 40px)",
            zIndex: 2,
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: "clamp(10px, 1.2vw, 18px)",
            pointerEvents: "none",
          }}
        >
          <Stat target={330} suffix="+" label="cities · 125+ countries" slot={0} />
          <Stat target={500} suffix="+" label="Tbps network capacity" slot={1} />
          <Stat prefix="~" target={20} suffix="%" label="of the web" slot={2} />
          <Stat prefix="<" target={50} suffix="ms" label="from 95% of internet users" slot={3} />
        </div>
      </div>
    </Frame>
  ),
};

function PillarCard({
  slot,
  icon,
  name,
  desc,
  accent,
}: {
  slot: number;
  icon: ReactNode;
  name: string;
  desc: string;
  accent: string;
}) {
  return (
    <div
      className="cf-pillar"
      style={{
        position: "relative",
        background: "var(--cf-bg-200)",
        border: "1px solid var(--cf-border)",
        borderRadius: 12,
        padding: "clamp(12px, 1.4vh, 18px) clamp(14px, 1.4vw, 20px)",
        textAlign: "left",
        boxShadow: "0 1px 3px rgba(82, 16, 0, 0.04), 0 4px 12px rgba(82, 16, 0, 0.02)",
        animationDelay: `calc(0.5s + ${slot} * 0.18s)`,
      }}
    >
      <CornerBrackets />
      <div style={{ display: "flex", alignItems: "center", gap: "clamp(10px, 1vw, 14px)" }}>
        <div
          aria-hidden="true"
          style={{
            width: "clamp(32px, 2.6vw, 40px)",
            height: "clamp(32px, 2.6vw, 40px)",
            borderRadius: 8,
            background: `color-mix(in srgb, ${accent} 10%, transparent)`,
            color: accent,
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: "clamp(13px, 1.2vw, 17px)",
              fontWeight: 500,
              letterSpacing: "-0.01em",
              color: "var(--cf-text)",
              lineHeight: 1.2,
            }}
          >
            {name}
          </div>
          <div
            style={{
              fontSize: "clamp(11px, 0.95vw, 13px)",
              color: "var(--cf-text-muted)",
              marginTop: 3,
              lineHeight: 1.4,
            }}
          >
            {desc}
          </div>
        </div>
      </div>
    </div>
  );
}

function ApplicationServicesIcon() {
  return (
    <svg width="60%" height="60%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function CloudflareOneIcon() {
  return (
    <svg width="60%" height="60%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4Z" />
      <circle cx="12" cy="11" r="3" />
    </svg>
  );
}

function DeveloperPlatformIcon() {
  return (
    <svg width="60%" height="60%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function AIIcon() {
  return (
    <svg width="60%" height="60%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v4" />
      <path d="M12 18v4" />
      <path d="m4.93 4.93 2.83 2.83" />
      <path d="m16.24 16.24 2.83 2.83" />
      <path d="M2 12h4" />
      <path d="M18 12h4" />
      <path d="m4.93 19.07 2.83-2.83" />
      <path d="m16.24 7.76 2.83-2.83" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function Stat({
  prefix,
  target,
  suffix,
  label,
  slot,
}: {
  prefix?: string;
  target: number;
  suffix?: string;
  label: string;
  slot: number;
}) {
  return (
    <div
      className="card cf-stat"
      style={{
        alignItems: "flex-start",
        textAlign: "left",
        padding: "clamp(12px, 1.6vh, 22px) clamp(14px, 1.4vw, 22px)",
        gap: 4,
        background: "rgba(255, 253, 251, 0.93)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
        animationDelay: `calc(0.9s + ${slot} * 0.18s)`,
      }}
    >
      <CornerBrackets />
      <div
        className="cf-stat__number"
        style={{
          fontSize: "clamp(28px, 3.2vw, 48px)",
          fontWeight: 500,
          letterSpacing: "-0.035em",
          lineHeight: 1,
          color: "var(--cf-orange)",
        }}
      >
        {prefix && <span className="cf-stat__fix">{prefix}</span>}
        <span
          className={`cf-stat__digit cf-stat__digit--t${target}`}
          style={{ animationDelay: `calc(1.1s + ${slot} * 0.18s)` }}
        />
        {suffix && <span className="cf-stat__fix">{suffix}</span>}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "clamp(10px, 0.9vw, 13px)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--cf-text-muted)",
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  );
}
