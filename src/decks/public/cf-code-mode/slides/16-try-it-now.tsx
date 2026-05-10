import { motion, useReducedMotion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import type { SlideDef } from "@/framework/viewer/types";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { BackgroundLines } from "../components/primitives/BackgroundLines";
import { easeEntrance } from "../lib/motion";

/**
 * 16 — Closing slide. (Merge of the old "Try it now." + "Thank you.")
 *
 * Per QA round 3:
 *   "make all badges much bigger, fill up the slide so users can easily
 *    scan them. Also merge that slide with my thank you slide. Maybe
 *    have a badge/card per QR code, etc."
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │                                                                  │
 *   │     Thank you.                                                   │
 *   │     Find me on the booth. Or scan to keep the conversation       │
 *   │     going.                                                       │
 *   │                                                                  │
 *   │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐             │
 *   │  │  ▣▣▣▣▣▣  │ │  ▣▣▣▣▣▣  │ │  ▣▣▣▣▣▣  │ │  ▣▣▣▣▣▣  │             │
 *   │  │ LinkedIn │ │ Code Mode│ │ Dynamic  │ │ Starter  │             │
 *   │  │   QR     │ │   docs   │ │ Workers  │ │   repo   │             │
 *   │  │  short   │ │  short   │ │  short   │ │  short   │             │
 *   │  │   URL    │ │   URL    │ │   URL    │ │   URL    │             │
 *   │  └──────────┘ └──────────┘ └──────────┘ └──────────┘             │
 *   │                                                                  │
 *   │  ┌── Speaker card ──┐                                            │
 *   │  │ [photo]  Miguel  │                                            │
 *   │  └──────────────────┘                                            │
 *   │                                                                  │
 *   │  ●  Come say hi at the Cloudflare booth · DTX Manchester · 30 Apr │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Design choices:
 *   - 4 equally-sized QR cards in a row, BIG (~160px QR) so the
 *     audience can scan from a few rows back.
 *   - Each card is a CornerBrackets-wrapped tile with title above, QR
 *     in the middle, and a font-mono short-URL underneath.
 *   - The Code Mode card carries an extra `npm i @cloudflare/codemode`
 *     line as a quiet bonus (folds in the old "install" tile).
 *   - Speaker block sits below the cards, photo + name + role.
 *
 * Animation:
 *   - Cards stagger in left-to-right (0.12s between each, 0.4s
 *     easeEntrance per card).
 *   - Speaker block fades in once cards have settled.
 *   - `prefers-reduced-motion: reduce` snaps everything to end-state.
 *
 * Interaction:
 *   - Slide root is `data-no-advance` so click-to-advance is suppressed
 *     across the whole closing slide (the audience may still be
 *     scanning when the presenter taps somewhere).
 *   - Each URL is clickable as a fallback for the on-screen presenter
 *     and tagged `data-interactive`.
 */

const LINKEDIN_URL = "https://www.linkedin.com/in/miguelcaetanodias/";
const DOCS_CODEMODE_URL =
  "https://developers.cloudflare.com/agents/api-reference/codemode/";
const DOCS_DYNAMIC_WORKERS_URL =
  "https://developers.cloudflare.com/dynamic-workers/";
const STARTER_URL =
  "https://github.com/cloudflare/agents/tree/main/examples/dynamic-workers";

/**
 * QR colours: design system text colour (warm brown #521000) on the
 * canvas tone (#FFFBF5). Tested for contrast — passes the QR
 * "decodable" bar comfortably on a projector.
 */
const QR_FG = "#521000";
const QR_BG = "#FFFBF5";

interface ResourceCardProps {
  index: number;
  reduce: boolean;
  baseDelay: number;
  url: string;
  qrLabel: string;
  title: string;
  shortUrl: string;
  /** Optional second-line meta (e.g. npm install snippet). */
  metaLine?: string;
}

function ResourceCard({
  index,
  reduce,
  baseDelay,
  url,
  qrLabel,
  title,
  shortUrl,
  metaLine,
}: ResourceCardProps) {
  const delay = reduce ? 0 : baseDelay + index * 0.12;
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: easeEntrance, delay }}
      className="relative flex h-full"
    >
      <CornerBrackets className="flex h-full w-full flex-col items-center gap-4 rounded-2xl border border-cf-border bg-cf-bg-200 p-6 transition-colors duration-200 hover:[border-style:dashed]">
        <h3 className="text-center text-[clamp(15px,1.2vw,18px)] font-medium leading-[1.2] tracking-[-0.02em] text-cf-text">
          {title}
        </h3>

        {/* QR — sits inside its own light-bg tile so the brackets read
            as a card border and the QR keeps its high-contrast canvas. */}
        <div className="rounded-lg border border-cf-border bg-cf-bg-100 p-3">
          <QRCodeSVG
            value={url}
            size={160}
            fgColor={QR_FG}
            bgColor={QR_BG}
            level="M"
            marginSize={0}
            aria-label={qrLabel}
          />
        </div>

        <div className="mt-auto flex w-full flex-col items-center gap-1">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            data-interactive
            className="block max-w-full break-all text-center font-mono text-[11px] leading-[1.45] tracking-[0.02em] text-cf-text-muted underline-offset-4 hover:text-cf-orange hover:underline"
          >
            {shortUrl}
          </a>
          {metaLine ? (
            <code className="block max-w-full break-all text-center font-mono text-[10px] leading-[1.45] tracking-[0.04em] text-cf-text-subtle">
              {metaLine}
            </code>
          ) : null}
        </div>
      </CornerBrackets>
    </motion.div>
  );
}

function SpeakerBlock({ reduce, delay }: { reduce: boolean; delay: number }) {
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: easeEntrance }}
      className="flex justify-start"
    >
      <div className="relative inline-block">
        <CornerBrackets>
          <div className="cf-card flex items-center gap-6 px-8 py-5">
            <div
              className="h-[88px] w-[88px] flex-shrink-0 overflow-hidden rounded-full"
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
                    parent.style.background =
                      "var(--color-cf-orange-light)";
                    parent.style.color = "var(--color-cf-orange)";
                    parent.style.fontFamily = "var(--font-mono)";
                    parent.style.fontWeight = "500";
                    parent.innerText = "MD";
                  }
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-[clamp(20px,1.85vw,28px)] font-medium leading-tight tracking-[-0.02em] text-cf-text">
                Miguel Caetano Dias
              </div>
              <div className="font-mono text-[clamp(11px,0.95vw,14px)] uppercase tracking-[0.06em] text-cf-text-muted">
                Senior Majors Solutions Engineer · Cloudflare
              </div>
            </div>
          </div>
        </CornerBrackets>
      </div>
    </motion.div>
  );
}

function Body() {
  const reducedRaw = useReducedMotion();
  const reduce = reducedRaw ?? false;

  // Cards begin a touch after slide entrance to feel intentional.
  const baseDelay = 0.2;
  // Speaker block lands AFTER the last card (index 3) has finished its
  // 0.4s entrance. baseDelay + 3*0.12 + 0.4 ≈ 0.96s — round up a bit
  // so it feels deliberate rather than chasing the cards.
  const speakerDelay = reduce ? 0 : baseDelay + 3 * 0.12 + 0.45;
  const footerDelay = reduce ? 0 : speakerDelay + 0.25;

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      data-no-advance
    >
      {/* Faint dot grid behind everything — matches slide 01. */}
      <div className="cf-dot-pattern absolute inset-0 opacity-30" />

      {/* Soft ambient lines biased to the right side, providing depth
          without competing with the cards. */}
      <div
        className="pointer-events-none absolute inset-y-0 right-0 hidden w-[40%] lg:block"
        aria-hidden="true"
      >
        <BackgroundLines count={5} opacity={0.16} />
      </div>

      <div className="relative z-10 mx-auto flex h-full w-full max-w-[1500px] flex-col justify-center gap-10 px-12 py-12 sm:px-20">
        {/* Header — "Thank you." + subtitle */}
        <div className="flex flex-col gap-4">
          <motion.h1
            initial={
              reduce ? false : { opacity: 0, y: 18, filter: "blur(4px)" }
            }
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.5, ease: easeEntrance }}
            className="text-[clamp(44px,6.4vw,88px)] font-medium leading-[0.95] tracking-[-0.04em] text-cf-text"
          >
            Thank you<span className="text-cf-orange">.</span>
          </motion.h1>

          <motion.p
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.4,
              delay: reduce ? 0 : 0.15,
              ease: easeEntrance,
            }}
            className="max-w-[60ch] text-[clamp(16px,1.4vw,22px)] leading-[1.45] text-cf-text-muted"
          >
            Find me on the booth. Or scan to keep the conversation going.
          </motion.p>
        </div>

        {/* Card row — 4 equally-sized QR tiles. `auto-rows-fr` +
            `place-items-stretch` keeps every card the same height
            regardless of meta-line presence. */}
        <div className="grid auto-rows-fr grid-cols-1 place-items-stretch gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <ResourceCard
            index={0}
            reduce={reduce}
            baseDelay={baseDelay}
            url={LINKEDIN_URL}
            qrLabel="QR code linking to Miguel Caetano Dias on LinkedIn"
            title="Connect on LinkedIn"
            shortUrl="linkedin.com/in/miguelcaetanodias"
          />
          <ResourceCard
            index={1}
            reduce={reduce}
            baseDelay={baseDelay}
            url={DOCS_CODEMODE_URL}
            qrLabel="QR code linking to the Cloudflare Code Mode documentation"
            title="Code Mode docs"
            shortUrl="developers.cloudflare.com/agents/api-reference/codemode"
            metaLine="npm i @cloudflare/codemode"
          />
          <ResourceCard
            index={2}
            reduce={reduce}
            baseDelay={baseDelay}
            url={DOCS_DYNAMIC_WORKERS_URL}
            qrLabel="QR code linking to the Cloudflare Dynamic Workers documentation"
            title="Dynamic Workers"
            shortUrl="developers.cloudflare.com/dynamic-workers"
          />
          <ResourceCard
            index={3}
            reduce={reduce}
            baseDelay={baseDelay}
            url={STARTER_URL}
            qrLabel="QR code linking to the Cloudflare Agents starter repo"
            title="Deploy the starter"
            shortUrl="github.com/cloudflare/agents · examples/dynamic-workers"
          />
        </div>

        {/* Speaker block — sits below the cards, anchored to the left. */}
        <SpeakerBlock reduce={reduce} delay={speakerDelay} />
      </div>

      {/* Bottom-strip footer — locked to the bottom. */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: footerDelay, ease: easeEntrance }}
        className="absolute inset-x-0 bottom-6 flex items-center justify-center gap-2 px-12 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-cf-text-subtle sm:px-20"
      >
        <span
          className="inline-block h-[6px] w-[6px] rounded-full bg-cf-orange"
          aria-hidden="true"
        />
        <span>
          Come say hi at the Cloudflare booth · DTX Manchester · 30 April 2026.
        </span>
      </motion.div>
    </div>
  );
}

export const closingSlide: SlideDef = {
  id: "closing",
  layout: "cover",
  render: () => <Body />,
};

/**
 * Backwards-compat alias. Until the slide registry import is renamed,
 * keep the old name resolvable.
 */
export const tryItNowSlide = closingSlide;
