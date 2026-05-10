import type { SlideDef } from "@/framework/viewer/types";
import { Frame } from "../components/Frame";
import { CornerBrackets } from "../components/CornerBrackets";

const TOTAL = 7;
const SLIDE_INDEX = 1;

/**
 * Cover slide.
 *
 * Side-by-side speaker introduction inside a cream card: Michael Binks
 * (Director of Technology, Car Finance 247) on the left and Miguel
 * Caetano Dias (Senior Majors SE, Cloudflare) on the right, separated
 * by a dashed vertical divider. Eyebrow above carries the DTX lockup +
 * "Manchester · 29 April 2026".
 */
export const titleSlide: SlideDef = {
  id: "title",
  title: "Shifting Gears with Car Finance 247",
  layout: "full",
  notes: (
    <>
      <p>
        Walk on stage. Brief verbal intro — name, role, and that you're here
        to set up a conversation about how Cloudflare and Car Finance 247
        have been working together since 2018.
      </p>
      <p>~25s.</p>
    </>
  ),
  render: () => (
    <Frame current={SLIDE_INDEX} total={TOTAL}>
      <div
        className="eyebrow"
        style={{
          margin: 0,
          display: "inline-flex",
          alignItems: "center",
          gap: 14,
          color: "var(--cf-text-muted)",
        }}
      >
        <img
          src="/cf247-dtx-manchester/photos/dtx-logo.png"
          alt="DTX"
          style={{
            height: "1.9em",
            width: "auto",
            objectFit: "contain",
            display: "block",
          }}
        />
        <span style={{ color: "var(--cf-text-subtle)" }}>·</span>
        <span>Manchester · 29 April 2026</span>
      </div>

      <h1 className="h1" style={{ maxWidth: "16ch", marginTop: "clamp(20px, 3.2vh, 40px)" }}>
        Shifting Gears
        <br />
        with <span className="text-cf247">Car Finance 247</span>
      </h1>

      <p
        className="lede lede--wide"
        style={{ marginTop: "clamp(20px, 3.2vh, 40px)", color: "var(--cf-text)", opacity: 0.85 }}
      >
        Accelerating innovation in the fast lane of regulation.
      </p>

      <div
        className="row"
        style={{
          marginTop: "clamp(28px, 4.6vh, 60px)",
          gap: "clamp(20px, 2.6vw, 40px)",
          padding: "clamp(18px, 2.6vh, 28px) clamp(24px, 3vw, 44px)",
          background: "var(--cf-bg-200)",
          border: "1px solid var(--cf-border)",
          borderRadius: 14,
          position: "relative",
        }}
      >
        <CornerBrackets />
        <SpeakerWithAvatar
          photoSrc="/cf247-dtx-manchester/photos/michael.jpg"
          name="Michael Binks"
          role="Director of Technology · Car Finance 247"
        />
        <div className="divider" aria-hidden="true" style={{ height: "clamp(56px, 7vh, 88px)" }} />
        <SpeakerWithAvatar
          photoSrc="/cf247-dtx-manchester/photos/miguel.png"
          name="Miguel Caetano Dias"
          role="Senior Majors Solutions Engineer · Cloudflare"
        />
      </div>
    </Frame>
  ),
};

function SpeakerWithAvatar({
  photoSrc,
  name,
  role,
}: {
  photoSrc: string;
  name: string;
  role: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "clamp(14px, 1.6vw, 22px)" }}>
      <div
        style={{
          width: "clamp(64px, 6vw, 92px)",
          height: "clamp(64px, 6vw, 92px)",
          borderRadius: "50%",
          overflow: "hidden",
          flexShrink: 0,
          boxShadow:
            "0 0 0 2px var(--cf-bg-100), 0 0 0 3px var(--cf-border), 0 4px 14px rgba(82, 16, 0, 0.08)",
        }}
      >
        <img
          src={photoSrc}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      </div>
      <div style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          style={{
            fontSize: "clamp(22px, 2.2vw, 32px)",
            fontWeight: 500,
            letterSpacing: "-0.02em",
            color: "var(--cf-text)",
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "clamp(12px, 1.15vw, 16px)",
            letterSpacing: "0.04em",
            color: "var(--cf-text-muted)",
          }}
        >
          {role}
        </div>
      </div>
    </div>
  );
}
