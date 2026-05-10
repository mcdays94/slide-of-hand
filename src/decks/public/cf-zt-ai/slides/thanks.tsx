import { useState } from "react";
import { motion } from "framer-motion";
import { Linkedin, Sparkles } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { SlideDef } from "@/framework/viewer/types";
import { easeEntrance, staggerContainer, staggerItem } from "../lib/motion";
import { Tag } from "../components/primitives/Tag";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { BackgroundLines } from "../components/primitives/BackgroundLines";
import { DotPattern } from "../components/primitives/DotPattern";
import { CloudflareWordmark } from "../components/primitives/CloudflareWordmark";

/** Update this single string and the QR regenerates automatically. */
const LINKEDIN_URL = "https://www.linkedin.com/in/miguelcaetanodias/";

/** Path to the speaker portrait (lives in /public). */
const PHOTO_SRC = "/cf-zt-ai/miguel.png";

export const thanksSlide: SlideDef = {
  id: "thanks",
  title: "Let's keep talking",
  layout: "cover",
  render: () => <ThanksBody />,
};

function ThanksBody() {
  const [photoOk, setPhotoOk] = useState(true);

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-cf-bg-100">
      <BackgroundLines />
      <DotPattern fade="edges" />

      <motion.div
        className="relative z-10 grid w-full max-w-[1280px] gap-12 px-8 sm:px-16 lg:grid-cols-[1fr_auto] lg:items-center"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        {/* LEFT: Headline + speaker block */}
        <div>
          <motion.div variants={staggerItem}>
            <CloudflareWordmark height={28} />
          </motion.div>

          <motion.div variants={staggerItem} className="mt-6">
            <Tag>Thanks for watching</Tag>
          </motion.div>

          <motion.h1
            variants={staggerItem}
            className="mt-8 text-5xl leading-[0.95] tracking-[-0.04em] sm:text-7xl md:text-[88px]"
          >
            Let's keep
            <br />
            <span className="text-cf-orange">talking.</span>
          </motion.h1>

          <motion.p
            variants={staggerItem}
            className="mt-8 max-w-xl text-xl text-cf-text-muted"
          >
            Bring your hardest AI governance problem. We'll architect a Zero
            Trust answer together. Scan to keep the conversation going on
            LinkedIn.
          </motion.p>

          {/* Speaker block: photo + name + role */}
          <motion.div
            variants={staggerItem}
            className="mt-10 flex items-center gap-5"
          >
            <CornerBrackets className="relative h-32 w-32 overflow-hidden rounded-full border-2 border-cf-border bg-cf-bg-200" inset={-5}>
              {photoOk ? (
                <img
                  src={PHOTO_SRC}
                  alt="Miguel Caetano Dias"
                  className="h-full w-full rounded-full object-cover"
                  onError={() => setPhotoOk(false)}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center rounded-full bg-cf-orange-light text-2xl font-medium text-cf-orange">
                  MD
                </div>
              )}
            </CornerBrackets>
            <div>
              <h2 className="text-3xl tracking-[-0.03em] text-cf-text sm:text-4xl">
                Miguel Caetano Dias
              </h2>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-cf-text-muted">
                Senior Majors Solutions Engineer · Cloudflare
              </p>
            </div>
          </motion.div>
        </div>

        {/* RIGHT: QR card */}
        <motion.div
          variants={staggerItem}
          className="flex justify-center lg:justify-end"
        >
          <CornerBrackets className="cf-card flex flex-col items-center gap-4 p-8" inset={-4}>
            <div className="flex items-center gap-2 self-start">
              <Linkedin className="h-4 w-4 text-cf-orange" strokeWidth={2.2} />
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-muted">
                Connect on LinkedIn
              </span>
            </div>

            {/* The QR. White background is required for high-contrast scanning. */}
            <div className="rounded-xl border border-cf-border bg-white p-4">
              <QRCodeSVG
                value={LINKEDIN_URL}
                size={224}
                level="M"
                fgColor="#521000"
                bgColor="#FFFFFF"
                marginSize={0}
              />
            </div>

            <div className="flex flex-col items-center gap-1 text-center">
              <span className="text-sm font-medium text-cf-text">
                miguelcaetanodias
              </span>
              <span className="font-mono text-[10px] text-cf-text-subtle">
                linkedin.com/in/miguelcaetanodias
              </span>
            </div>

            <div className="mt-2 flex items-center gap-1.5 rounded-full bg-cf-orange-light px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-cf-orange">
              <Sparkles className="h-3 w-3" />
              Scan with your phone camera
            </div>
          </CornerBrackets>
        </motion.div>
      </motion.div>

      {/* Decorative orange arc — flipped from title slide for symmetry */}
      <motion.div
        className="pointer-events-none absolute left-[-6%] top-1/2 hidden -translate-y-1/2 lg:block"
        initial={{ opacity: 0, x: -80 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 1.2, delay: 0.3, ease: easeEntrance }}
      >
        <svg width="420" height="420" viewBox="0 0 420 420" fill="none">
          <path
            d="M210 0 a210 210 0 0 0 0 420"
            stroke="var(--color-cf-orange)"
            strokeWidth="3"
            strokeDasharray="2 8"
            opacity="0.3"
          />
          <path
            d="M210 50 a160 160 0 0 0 0 320"
            stroke="var(--color-cf-orange)"
            strokeWidth="2"
            opacity="0.55"
          />
          <circle
            cx="210"
            cy="210"
            r="80"
            stroke="var(--color-cf-orange)"
            strokeWidth="1.5"
            opacity="0.35"
          />
          <circle cx="50" cy="210" r="5" fill="var(--color-cf-orange)" />
        </svg>
      </motion.div>
    </div>
  );
}
