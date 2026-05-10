import type { ReactNode } from "react";
import type { SlideDef } from "@/framework/viewer/types";
import { Frame } from "../components/Frame";
import { CloudflareLogo } from "../components/CloudflareLogo";

const TOTAL = 7;
const SLIDE_INDEX = 7;

/**
 * Slide 7 — backdrop. Stays on stage for the entire ~22 min fireside chat.
 *
 * Custom orange swoop on the right, DTX MANCHESTER lockup top-left,
 * Peer Point Manchester QR card top-right, big speaker portraits on
 * the right, deck title on the left, partnership footer.
 *
 * Rendered without chrome via Frame's `variant="backdrop"`.
 */
export const backdropSlide: SlideDef = {
  id: "backdrop",
  title: "Fireside chat (backdrop)",
  layout: "full",
  notes: (
    <>
      <p>
        Static slide — the official DTX × Cloudflare holding slide for this
        session. Stays on screen for the entire ~22 min fireside chat.
      </p>
      <p>To swap it: drop a different image at the backdrop path and refresh.</p>
    </>
  ),
  render: () => (
    <Frame current={SLIDE_INDEX} total={TOTAL} variant="backdrop">
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "#FFFFFF",
          overflow: "hidden",
          color: "#1A1A1A",
          fontFamily: "var(--font-sans)",
        }}
      >
        {/* Orange swoop */}
        <svg
          viewBox="0 0 1920 1080"
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        >
          <defs>
            <linearGradient id="holding-orange-cf247" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FF7B3D" />
              <stop offset="55%" stopColor="#FF4801" />
              <stop offset="100%" stopColor="#E13900" />
            </linearGradient>
          </defs>
          <path
            d="M 1080 -10 Q 940 540 1090 1090 L 1930 1090 L 1930 -10 Z"
            fill="url(#holding-orange-cf247)"
          />
          <path
            d="M 1240 -10 Q 1100 540 1230 1090"
            stroke="rgba(255, 255, 255, 0.18)"
            strokeWidth="2"
            fill="none"
          />
          <path
            d="M 1340 -10 Q 1220 540 1320 1090"
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth="1.5"
            fill="none"
          />
        </svg>

        {/* DTX MANCHESTER lockup — top-left */}
        <div
          style={{
            position: "absolute",
            top: "4.4%",
            left: "4.8%",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            zIndex: 2,
          }}
        >
          <img
            src="/cf247-dtx-manchester/photos/dtx-logo.png"
            alt="DTX"
            style={{
              height: "clamp(56px, 6.4vw, 96px)",
              width: "auto",
              objectFit: "contain",
              display: "block",
            }}
          />
          <div
            style={{
              fontSize: "clamp(18px, 1.7vw, 28px)",
              fontWeight: 500,
              letterSpacing: "0.32em",
              color: "#1A1A1A",
              paddingLeft: 6,
            }}
          >
            MANCHESTER
          </div>
        </div>

        <PeerPointReminder />

        {/* Title column */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: "4.8%",
            width: "54%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            paddingTop: "clamp(110px, 14vh, 180px)",
            paddingBottom: "clamp(80px, 10vh, 130px)",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: "clamp(34px, 3.8vw, 64px)",
              fontWeight: 700,
              letterSpacing: "-0.018em",
              lineHeight: 1.1,
              color: "#1A1A1A",
              maxWidth: "20ch",
            }}
          >
            Shifting Gears with
            <br />
            <span style={{ color: "var(--cf247-purple)" }}>Car Finance 247</span>:
            <br />
            Accelerating Innovation
            <br />
            in the Fast Lane of
            <br />
            Regulation
          </h2>
        </div>

        {/* Speakers column */}
        <div
          style={{
            position: "absolute",
            top: "clamp(240px, 28vh, 300px)",
            bottom: "clamp(80px, 10vh, 130px)",
            right: "4.8%",
            width: "38%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "clamp(28px, 4vh, 52px)",
            color: "#FFFFFF",
          }}
        >
          <SpeakerRow
            photoSrc="/cf247-dtx-manchester/photos/michael.jpg"
            name="Michael Binks"
            role={
              <>
                Director of Technology,
                <br />
                Car Finance 247
              </>
            }
          />
          <SpeakerRow
            photoSrc="/cf247-dtx-manchester/photos/miguel.png"
            name="Miguel Caetano Dias"
            role={
              <>
                Senior Majors Solutions Engineer
                <br />
                Cloudflare
              </>
            }
          />
        </div>

        {/* Footer */}
        <div
          style={{
            position: "absolute",
            left: "4.8%",
            right: "4.8%",
            bottom: "4.4%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 24,
            zIndex: 2,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: "clamp(15px, 1.4vw, 22px)",
              color: "#1A1A1A",
            }}
          >
            <span style={{ fontWeight: 600 }}>11:30 AM</span>
            <span style={{ color: "rgba(26, 26, 26, 0.35)" }}>|</span>
            <span>Modern Infrastructure &amp; Connected Experiences Stage</span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "clamp(20px, 2vw, 36px)",
            }}
          >
            <CloudflareLogo
              style={{
                height: "clamp(40px, 3.4vw, 60px)",
                width: "auto",
                color: "#FFFFFF",
                filter: "drop-shadow(0 2px 8px rgba(0, 0, 0, 0.15))",
              }}
            />
            <span
              aria-hidden="true"
              style={{
                width: 1,
                height: "clamp(36px, 3vw, 54px)",
                background: "rgba(255, 255, 255, 0.55)",
                display: "inline-block",
              }}
            />
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "clamp(10px, 1.1vh, 16px) clamp(18px, 1.8vw, 26px)",
                background: "#FFFFFF",
                borderRadius: 999,
                boxShadow: "0 6px 20px rgba(0, 0, 0, 0.15)",
              }}
            >
              <img
                src="/cf247-dtx-manchester/logos/carfinance247.png"
                alt="Car Finance 247"
                style={{
                  height: "clamp(54px, 4.6vw, 80px)",
                  width: "auto",
                  objectFit: "contain",
                  display: "block",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </Frame>
  ),
};

function PeerPointReminder() {
  return (
    <div
      style={{
        position: "absolute",
        top: "4.4%",
        right: "4.8%",
        zIndex: 3,
        display: "flex",
        flexDirection: "column",
        gap: "clamp(8px, 0.9vh, 12px)",
        padding: "clamp(14px, 1.3vw, 20px) clamp(16px, 1.5vw, 24px)",
        background: "#FFFFFF",
        borderRadius: 14,
        boxShadow:
          "0 1px 3px rgba(0, 0, 0, 0.08), 0 8px 28px rgba(0, 0, 0, 0.16)",
        maxWidth: "clamp(280px, 22vw, 360px)",
      }}
      role="img"
      aria-label="Cloudflare Peer Point Manchester. 7 July 2026 at The Alan Hotel. Scan the QR code to register."
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "clamp(10px, 0.85vw, 12px)",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--cf-orange)",
          fontWeight: 600,
          lineHeight: 1,
        }}
      >
        Next stop
      </div>
      <div
        style={{
          fontSize: "clamp(15px, 1.4vw, 21px)",
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: "-0.012em",
          color: "#1A1A1A",
          maxWidth: "16ch",
        }}
      >
        Cloudflare Peer Point Manchester
      </div>
      <div
        style={{
          display: "flex",
          gap: "clamp(12px, 1vw, 16px)",
          alignItems: "center",
          marginTop: "clamp(2px, 0.4vh, 6px)",
        }}
      >
        <img
          src="/cf247-dtx-manchester/peer-point-qr.svg"
          alt=""
          style={{
            width: "clamp(96px, 7.6vw, 128px)",
            height: "clamp(96px, 7.6vw, 128px)",
            flexShrink: 0,
            display: "block",
            borderRadius: 4,
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "clamp(3px, 0.4vh, 6px)",
            minWidth: 0,
          }}
        >
          <div
            style={{
              fontSize: "clamp(13px, 1.15vw, 17px)",
              fontWeight: 600,
              color: "#1A1A1A",
              lineHeight: 1.15,
            }}
          >
            7 July 2026
          </div>
          <div
            style={{
              fontSize: "clamp(11px, 1vw, 14px)",
              color: "rgba(26, 26, 26, 0.65)",
              lineHeight: 1.25,
            }}
          >
            The Alan Hotel
          </div>
          <div
            style={{
              fontSize: "clamp(10px, 0.9vw, 12px)",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--cf-orange)",
              fontWeight: 600,
              marginTop: "clamp(2px, 0.4vh, 4px)",
            }}
          >
            Scan to register
          </div>
        </div>
      </div>
    </div>
  );
}

function SpeakerRow({
  photoSrc,
  name,
  role,
}: {
  photoSrc: string;
  name: string;
  role: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "clamp(22px, 2vw, 36px)" }}>
      <div
        style={{
          width: "clamp(150px, 13vw, 240px)",
          height: "clamp(150px, 13vw, 240px)",
          borderRadius: "50%",
          overflow: "hidden",
          flexShrink: 0,
          border: "4px solid rgba(255, 255, 255, 0.9)",
          boxShadow: "0 10px 36px rgba(0, 0, 0, 0.22)",
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
            filter: "grayscale(1) contrast(1.05)",
          }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <div
          style={{
            fontSize: "clamp(28px, 2.6vw, 46px)",
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: "-0.012em",
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontSize: "clamp(18px, 1.6vw, 28px)",
            fontWeight: 400,
            lineHeight: 1.3,
            color: "rgba(255, 255, 255, 0.95)",
          }}
        >
          {role}
        </div>
      </div>
    </div>
  );
}
