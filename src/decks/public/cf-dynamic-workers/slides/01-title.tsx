import { useState } from "react";
import { motion } from "framer-motion";
import type { SlideDef } from "@/framework/viewer/types";
import { easeEntrance, staggerContainer, staggerItem } from "../lib/motion";
import { BackgroundLines } from "../components/primitives/BackgroundLines";
import { DotPattern } from "../components/primitives/DotPattern";
import { CloudflareWordmark } from "../components/primitives/CloudflareWordmark";
import { CornerBrackets } from "../components/primitives/CornerBrackets";

/** Speaker portrait (lives in /public/miguel.png — also used on Thanks). */
const PHOTO_SRC = "/cf-dynamic-workers/miguel.png";

export const titleSlide: SlideDef = {
  id: "title",
  title: "Cloudflare Dynamic Workers",
  layout: "cover",
  render: () => <TitleBody />,
};

function TitleBody() {
  const [photoOk, setPhotoOk] = useState(true);

  return (
    <div className="relative flex h-full w-full items-center overflow-hidden bg-cf-bg-100">
      <BackgroundLines />
      <DotPattern fade="edges" />

      <motion.div
        className="relative z-10 mx-auto w-full max-w-[1200px] px-8 sm:px-16"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        {/* Cloudflare wordmark — the deck is a Cloudflare-branded narrative,
            so the cover leads with the wordmark and nothing else above the
            headline. Forks can swap this for their own brand. */}
        <motion.div variants={staggerItem} className="flex items-center">
          <CloudflareWordmark height={36} />
        </motion.div>

        <motion.h1
          variants={staggerItem}
          className="mt-12 text-6xl leading-[0.95] tracking-[-0.04em] sm:text-8xl md:text-[116px]"
        >
          <span className="text-cf-orange">Dynamic</span>{" "}
          <span>Workers</span>
        </motion.h1>

        <motion.p
          variants={staggerItem}
          className="mt-8 max-w-3xl text-2xl text-cf-text-muted sm:text-3xl"
        >
          Spawn isolated mini-servers in milliseconds, on demand, from your
          code. The foundation for AI agents that run code, vibe-coding
          platforms, and multi-tenant SaaS.
        </motion.p>

        <motion.div
          variants={staggerItem}
          className="mt-12 flex flex-wrap items-center gap-x-12 gap-y-6"
        >
          {/* Speaker block — large portrait next to name and role.
              No "Speaker ·" / "Role ·" prefixes; the photo + brand
              context already make it obvious. */}
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
      </motion.div>

      {/* Right-side orbital decoration: dashed arc (slowly rotating), inner
          arc (static), inner circle, anchor dot, and the Cloudflare logo
          centred over the whole composition. Mirrors cf-zt-ai-slides cover —
          the visual identity is intentionally consistent across decks. */}
      <motion.div
        className="pointer-events-none absolute right-[-4%] top-1/2 hidden -translate-y-1/2 lg:block"
        initial={{ opacity: 0, x: 80 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 1.2, delay: 0.3, ease: easeEntrance }}
      >
        <div className="relative h-[520px] w-[520px]">
          {/* Slowly-rotating dashed arc — ambient motion */}
          <motion.svg
            className="absolute inset-0"
            width="520"
            height="520"
            viewBox="0 0 520 520"
            fill="none"
            animate={{ rotate: 360 }}
            transition={{ duration: 60, ease: "linear", repeat: Infinity }}
            style={{ transformOrigin: "260px 260px" }}
          >
            <path
              d="M260 0 a260 260 0 0 1 0 520"
              stroke="var(--color-cf-orange)"
              strokeWidth="3"
              strokeDasharray="2 8"
              opacity="0.35"
            />
            <circle cx="460" cy="260" r="6" fill="var(--color-cf-orange)" />
          </motion.svg>

          {/* Static inner arc + circle ring */}
          <svg
            className="absolute inset-0"
            width="520"
            height="520"
            viewBox="0 0 520 520"
            fill="none"
          >
            <path
              d="M260 60 a200 200 0 0 1 0 400"
              stroke="var(--color-cf-orange)"
              strokeWidth="2"
              opacity="0.6"
            />
            <circle
              cx="260"
              cy="260"
              r="100"
              stroke="var(--color-cf-orange)"
              strokeWidth="1.5"
              opacity="0.4"
            />
          </svg>

          {/* Cloudflare logo at the centre of the orbits — single-colour
              brand-orange version sourced from the Cloudflare Workers
              design system (cf-workers-design). */}
          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.9, ease: easeEntrance }}
          >
            <img
              src="/cf-dynamic-workers/logos/cloudflare-design.svg"
              alt="Cloudflare"
              className="h-24 w-auto select-none drop-shadow-[0_8px_24px_rgba(255,72,1,0.28)]"
              draggable={false}
            />
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
