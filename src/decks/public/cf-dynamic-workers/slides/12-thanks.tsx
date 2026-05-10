import { useState } from "react";
import { motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import type { SlideDef } from "@/framework/viewer/types";
import { easeEntrance, staggerContainer, staggerItem } from "../lib/motion";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { BackgroundLines } from "../components/primitives/BackgroundLines";
import { DotPattern } from "../components/primitives/DotPattern";

/** Speaker portrait — same source as slide 01. */
const PHOTO_SRC = "/cf-dynamic-workers/miguel.png";

/** QR target URLs. The repo URL is a placeholder until the orchestrator
 *  swaps it post-push. Both are encoded into on-brand cream/brown QRs. */
const LINKEDIN_URL = "https://www.linkedin.com/in/miguelcaetanodias/";
const REPO_URL = "https://github.com/mdias/cf-dynamic-workers-slides";

export const thanksSlide: SlideDef = {
  id: "thanks",
  title: "Thanks",
  layout: "cover",
  render: () => <ThanksBody />,
};

function ThanksBody() {
  const [photoOk, setPhotoOk] = useState(true);

  return (
    <div className="relative flex h-full w-full items-center overflow-hidden bg-cf-bg-100">
      <BackgroundLines />
      <DotPattern fade="edges" />

      <motion.div
        className="relative z-10 mx-auto grid w-full max-w-[1280px] grid-cols-1 items-center gap-12 px-8 sm:px-16 lg:grid-cols-[1.1fr_1fr]"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        {/* LEFT — Thanks headline + speaker block (mirrors slide 01). */}
        <div className="flex flex-col gap-10">
          <motion.h1
            variants={staggerItem}
            className="text-7xl leading-[0.95] tracking-[-0.04em] sm:text-8xl md:text-[140px]"
          >
            <span>Thanks</span>
            <span className="text-cf-orange">.</span>
          </motion.h1>

          <motion.p
            variants={staggerItem}
            className="max-w-2xl text-2xl text-cf-text-muted sm:text-3xl"
          >
            Questions? Ideas? Tell me what you'd build.
          </motion.p>

          <motion.div
            variants={staggerItem}
            className="flex flex-wrap items-center gap-x-12 gap-y-6"
          >
            <span className="flex items-center gap-5">
              <CornerBrackets
                className="relative h-40 w-40 flex-shrink-0 overflow-hidden rounded-full border-2 border-cf-border bg-cf-bg-200 shadow-[0_10px_30px_rgba(255,72,1,0.16)]"
                inset={-5}
              >
                {photoOk ? (
                  <img
                    src={PHOTO_SRC}
                    alt="Miguel Caetano Dias"
                    className="h-full w-full rounded-full object-cover select-none"
                    onError={() => setPhotoOk(false)}
                    draggable={false}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-cf-orange-light text-3xl font-medium text-cf-orange">
                    MD
                  </div>
                )}
              </CornerBrackets>
              <span className="flex flex-col gap-2">
                <span className="text-3xl font-medium tracking-[-0.02em] text-cf-text">
                  Miguel Caetano Dias
                </span>
                <span className="font-mono text-base uppercase tracking-[0.14em] text-cf-text-muted">
                  Senior Majors SE · Cloudflare
                </span>
              </span>
            </span>
          </motion.div>
        </div>

        {/* RIGHT — two QR codes side-by-side, vertically centered.
            Stagger the right column ~0.15s after the speaker block. */}
        <motion.div
          className="flex flex-wrap items-start justify-center gap-8 lg:justify-end"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.45, ease: easeEntrance }}
        >
          <QrCard
            label="LinkedIn · @miguelcaetanodias"
            url={LINKEDIN_URL}
            ariaLabel="LinkedIn profile QR code"
          />
          <QrCard
            label="Source · cf-dynamic-workers-slides"
            url={REPO_URL}
            ariaLabel="Source repository QR code"
          />
        </motion.div>
      </motion.div>
    </div>
  );
}

/** A QR + caption block, wrapped in CornerBrackets for the elevated-card
 *  treatment. The QR is rendered as SVG (sharp at any zoom), with the
 *  warm-cream/warm-brown brand palette baked in. */
function QrCard({
  label,
  url,
  ariaLabel,
}: {
  label: string;
  url: string;
  ariaLabel: string;
}) {
  return (
    <div className="flex flex-col items-center gap-4">
      <CornerBrackets
        className="relative bg-cf-bg-100 p-5 border border-cf-border"
        inset={-4}
      >
        <QRCodeSVG
          value={url}
          size={160}
          bgColor="#FFFBF5"
          fgColor="#521000"
          level="M"
          aria-label={ariaLabel}
        />
      </CornerBrackets>
      <span className="max-w-[200px] text-center font-mono text-xs uppercase tracking-[0.14em] text-cf-text-muted">
        {label}
      </span>
    </div>
  );
}
