import type { SlideDef } from "@/framework/viewer/types";
import { Frame } from "../components/Frame";
import { CornerBrackets } from "../components/CornerBrackets";

const TOTAL = 7;
const SLIDE_INDEX = 6;

/**
 * Slide 6 — the hand-off into the fireside chat.
 *
 * Hero speaker card with Michael's portrait, name in CF247 brand purple,
 * role line, and a "Cloudflare customer · since 2018" chip with the
 * CF247 logo. Above the card: a small "Please welcome" line — the
 * audience sees Michael's name large and unambiguously.
 */
export const handoffSlide: SlideDef = {
  id: "handoff",
  title: "Please welcome",
  layout: "full",
  notes: (
    <>
      <p>
        But none of this is theoretical — let me bring on the person who's
        actually been building it. Please welcome Michael Binks, Director of
        Technology at Car Finance 247.
      </p>
      <p>(Advance to backdrop slide.) ~10s.</p>
    </>
  ),
  render: () => (
    <Frame current={SLIDE_INDEX} total={TOTAL}>
      <div className="eyebrow">Now — the fireside chat</div>

      <h2
        className="h2"
        style={{
          margin: 0,
          marginBottom: "clamp(28px, 4vh, 44px)",
          color: "var(--cf-text)",
          letterSpacing: "-0.025em",
          lineHeight: 1.05,
        }}
      >
        Please welcome
      </h2>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "clamp(28px, 3.6vw, 60px)",
          padding: "clamp(24px, 3.4vh, 40px) clamp(32px, 3.6vw, 60px)",
          background: "var(--cf-bg-200)",
          border: "1px solid var(--cf-border)",
          borderRadius: 22,
          position: "relative",
          boxShadow: "0 1px 3px rgba(82, 16, 0, 0.04), 0 12px 36px rgba(82, 16, 0, 0.08)",
        }}
      >
        <CornerBrackets />

        <div
          style={{
            width: "clamp(140px, 14vw, 220px)",
            height: "clamp(140px, 14vw, 220px)",
            borderRadius: "50%",
            overflow: "hidden",
            flexShrink: 0,
            boxShadow:
              "0 0 0 3px var(--cf-bg-100), 0 0 0 4px var(--cf-border), 0 12px 32px rgba(82, 16, 0, 0.14)",
          }}
        >
          <img
            src="/cf247-dtx-manchester/photos/michael.jpg"
            alt="Michael Binks"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        </div>

        <div style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              fontSize: "clamp(36px, 4.2vw, 64px)",
              fontWeight: 500,
              letterSpacing: "-0.03em",
              color: "var(--cf247-purple)",
              lineHeight: 1.02,
            }}
          >
            Michael Binks
          </div>

          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "clamp(13px, 1.3vw, 19px)",
              letterSpacing: "0.05em",
              color: "var(--cf-text-muted)",
              textTransform: "uppercase",
            }}
          >
            Director of Technology · Car Finance 247
          </div>

          <div
            style={{
              marginTop: "clamp(8px, 1.2vh, 14px)",
              display: "inline-flex",
              alignItems: "center",
              gap: "clamp(8px, 0.8vw, 12px)",
              padding: "clamp(6px, 0.8vh, 10px) clamp(10px, 1.2vw, 16px)",
              background: "var(--cf-bg-100)",
              border: "1px solid var(--cf247-purple-light)",
              borderRadius: 999,
              alignSelf: "flex-start",
              boxShadow: "0 4px 14px var(--cf247-purple-glow)",
            }}
          >
            <img
              src="/cf247-dtx-manchester/logos/carfinance247.png"
              alt="Car Finance 247"
              style={{
                height: "clamp(20px, 1.8vw, 28px)",
                width: "auto",
                objectFit: "contain",
                display: "block",
              }}
            />
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "clamp(10px, 0.9vw, 12px)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--cf247-purple)",
                fontWeight: 600,
              }}
            >
              Cloudflare customer · since 2018
            </span>
          </div>
        </div>
      </div>
    </Frame>
  ),
};
