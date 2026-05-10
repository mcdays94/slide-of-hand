import { motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import type { SlideDef } from "@/framework/viewer/types";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { BackgroundLines } from "../components/primitives/BackgroundLines";
import { Tag } from "../components/primitives/Tag";
import { Globe3D } from "../components/globe";
import {
  staggerContainer,
  staggerItem,
  easeEntrance,
} from "../lib/motion";

/**
 * 01 — Title cover.
 *
 * Composition:
 *
 *   ┌────────────────────────────────────────────────────────────────────────┐
 *   │  [DTX]   Manchester · 30 April 2026                                    │
 *   │                                                                        │
 *   │   Code Mode &                                  ╭───────────────╮       │
 *   │   Dynamic Workers                              │               │       │
 *   │                                                │   3D GLOBE    │       │
 *   │   The token-efficient way for AI agents to     │   (Manchester │       │
 *   │   use MCP — and the millisecond V8 isolates    │     pulse)    │       │
 *   │   that make it possible.                       │               │       │
 *   │                                                ╰───────────────╯       │
 *   │   ┌─ speaker card ──────────────────────┐  ┌─ QR ──────┐               │
 *   │   │ [photo]   Miguel Caetano Dias       │  │  [qrcode] │               │
 *   │   │           Senior Majors SE · CF      │  │  CONNECT  │               │
 *   │   └─────────────────────────────────────┘  └───────────┘               │
 *   │                                                                        │
 *   │  Cloudflare booth · DTX Manchester                15 min · live demo  │
 *   └────────────────────────────────────────────────────────────────────────┘
 *
 * Polish notes:
 *   - H1 animates word-by-word for a slow, confident reveal (0.04s cadence).
 *   - Right column hosts the 3D Cloudflare-network globe with the Manchester
 *     PoP pulsing in cf-orange. Same component as the foundation section,
 *     here used as the cover medallion so the audience sees the network the
 *     moment they walk past the booth.
 *   - Speaker card name is sized for booth-floor visibility (clamp at 40px).
 *   - LinkedIn QR sits beside the speaker card so anyone in the room can
 *     scan from anywhere — no excuse to miss the connection.
 *   - Bottom strip carries a single info Tag for "15 min · live demo".
 */

const LINKEDIN_URL = "https://www.linkedin.com/in/miguelcaetanodias/";

const QR_FG = "#521000"; // var(--color-cf-text)
const QR_BG = "#FFFBF5"; // var(--color-cf-bg-100)

const H1_LINES: { words: string[]; accent?: number }[] = [
  // First line: "Code Mode &" — the ampersand is the accent character.
  { words: ["Code", "Mode", "&"], accent: 2 },
  // Second line: "Dynamic Workers"
  { words: ["Dynamic", "Workers"] },
];

export const titleSlide: SlideDef = {
  id: "title",
  layout: "cover",
  render: () => (
    <div className="relative h-full w-full overflow-hidden">
      {/* Faint dot grid behind everything */}
      <div className="cf-dot-pattern absolute inset-0 opacity-30" />

      {/* Soft ambient lines biased to the right side, providing depth behind
          the globe without competing with the H1. */}
      <div
        className="pointer-events-none absolute inset-y-0 right-0 hidden w-[46%] lg:block"
        aria-hidden="true"
      >
        <BackgroundLines count={5} opacity={0.18} />
      </div>

      <motion.div
        className="relative z-10 mx-auto flex h-full max-w-[1500px] items-center gap-12 px-12 sm:px-20"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        {/* Left column: title + speaker card + QR */}
        <div className="flex max-w-[860px] flex-col gap-7">
          {/* Eyebrow: DTX logo + date pill */}
          <motion.div
            variants={staggerItem}
            className="flex flex-wrap items-center gap-4 font-mono text-[12px] uppercase tracking-[0.16em] text-cf-text-muted"
          >
            <img
              src="/cf-code-mode/photos/dtx-logo.png"
              alt="DTX Manchester"
              className="block h-[1.9em] w-auto select-none object-contain"
              draggable={false}
            />
            <span className="cf-tag">
              <span
                className="inline-block h-[6px] w-[6px] rounded-full bg-cf-orange"
                aria-hidden="true"
              />
              Manchester · 30 April 2026
            </span>
          </motion.div>

          {/* H1 — word-by-word reveal at 0.04s cadence per word. */}
          <motion.h1
            variants={{
              initial: {},
              animate: {
                transition: {
                  staggerChildren: 0.04,
                  delayChildren: 0.18,
                },
              },
            }}
            className="text-[clamp(48px,7.6vw,108px)] font-medium leading-[0.95] tracking-[-0.04em] text-cf-text"
            aria-label="Code Mode and Dynamic Workers"
          >
            {H1_LINES.map((line, lineIdx) => (
              <span key={lineIdx} className="block">
                {line.words.map((word, wordIdx) => {
                  const isAccent = line.accent === wordIdx;
                  return (
                    <motion.span
                      key={`${lineIdx}-${wordIdx}`}
                      variants={{
                        initial: { opacity: 0, y: 18, filter: "blur(4px)" },
                        animate: {
                          opacity: 1,
                          y: 0,
                          filter: "blur(0px)",
                          transition: {
                            duration: 0.6,
                            ease: easeEntrance,
                          },
                        },
                      }}
                      className={`inline-block ${isAccent ? "text-cf-orange" : ""}`}
                      style={{ marginRight: "0.22em" }}
                    >
                      {word}
                    </motion.span>
                  );
                })}
              </span>
            ))}
          </motion.h1>

          {/* Lede */}
          <motion.p
            variants={staggerItem}
            className="max-w-[52ch] text-[clamp(18px,1.6vw,26px)] leading-[1.45] text-cf-text-muted"
          >
            The token-efficient way for AI agents to use MCP, and the
            millisecond V8 isolates that make it possible.
          </motion.p>

          {/* Speaker card + LinkedIn QR side by side */}
          <motion.div
            variants={staggerItem}
            className="mt-3 flex flex-wrap items-stretch gap-4"
          >
            {/* Speaker card */}
            <CornerBrackets className="cf-card flex flex-1 min-w-[420px] items-center gap-6 px-7 py-5">
              <div
                className="h-[clamp(84px,7vw,108px)] w-[clamp(84px,7vw,108px)] flex-shrink-0 overflow-hidden rounded-full"
                style={{
                  boxShadow:
                    "0 0 0 2px var(--color-cf-bg-100), 0 0 0 3px var(--color-cf-border), 0 4px 14px rgba(82, 16, 0, 0.08)",
                }}
              >
                <img
                  src="/cf-code-mode/photos/miguel.png"
                  alt="Miguel Caetano Dias"
                  className="h-full w-full object-cover"
                  draggable={false}
                  onError={(e) => {
                    const img = e.currentTarget;
                    img.style.display = "none";
                    const parent = img.parentElement;
                    if (parent) {
                      parent.style.display = "flex";
                      parent.style.alignItems = "center";
                      parent.style.justifyContent = "center";
                      parent.style.background = "var(--color-cf-orange-light)";
                      parent.style.color = "var(--color-cf-orange)";
                      parent.style.fontFamily = "var(--font-mono)";
                      parent.style.fontWeight = "500";
                      parent.innerText = "MD";
                    }
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="whitespace-nowrap text-[clamp(24px,2.05vw,34px)] font-medium leading-[1.05] tracking-[-0.025em] text-cf-text">
                  Miguel Caetano Dias
                </div>
                <div className="whitespace-nowrap font-mono text-[clamp(11px,0.95vw,14px)] uppercase tracking-[0.06em] text-cf-text-muted">
                  Senior Majors SE
                  <span className="mx-1.5 text-cf-text-subtle">·</span>
                  Cloudflare
                </div>
              </div>
            </CornerBrackets>

            {/* LinkedIn QR card */}
            <a
              href={LINKEDIN_URL}
              target="_blank"
              rel="noreferrer"
              data-interactive
              className="group block"
              aria-label="Connect with Miguel on LinkedIn"
            >
              <CornerBrackets className="flex h-full flex-col items-center justify-center gap-2 rounded-2xl border border-cf-border bg-cf-bg-200 px-4 py-3 transition-colors duration-200 group-hover:[border-style:dashed]">
                <div className="rounded-md border border-cf-border bg-cf-bg-100 p-2">
                  <QRCodeSVG
                    value={LINKEDIN_URL}
                    size={92}
                    fgColor={QR_FG}
                    bgColor={QR_BG}
                    level="M"
                    marginSize={0}
                    aria-label="QR code linking to Miguel Caetano Dias on LinkedIn"
                  />
                </div>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-muted">
                  Connect on LinkedIn
                </span>
              </CornerBrackets>
            </a>
          </motion.div>
        </div>

        {/* Right column: 3D Cloudflare network globe */}
        <motion.div
          className="relative hidden flex-shrink-0 items-center justify-center lg:flex"
          style={{ width: "min(560px, 38vw)", height: "min(560px, 38vw)" }}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, ease: easeEntrance, delay: 0.35 }}
        >
          <Globe3D
            spinSpeed={0.35}
            tiltX={0.32}
            initialRotationY={3.3}
            cameraDistance={2.95}
            sphereOpacity={0.1}
            manchesterColor="#FF4801"
            trafficColor="#FFB088"
            arcColor="#FF4801"
            landColor="#FF4801"
            dotColor="#0A95FF"
            showManchesterPulse
            showTrafficFlow
            showNetworkArcs
            showPopDots
            draggable={false}
          />
        </motion.div>
      </motion.div>

      {/* Bottom strip: meta on the left, info Tag on the right. */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.7, ease: easeEntrance }}
        className="absolute inset-x-0 bottom-6 flex items-center justify-between gap-4 px-12 font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-subtle sm:px-20"
      >
        <span>Cloudflare booth</span>
        <Tag tone="info">15 min · live demo</Tag>
      </motion.div>
    </div>
  ),
};
