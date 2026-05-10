import type { CSSProperties, ReactNode } from "react";
import type { SlideDef } from "@/framework/viewer/types";
import { Frame } from "../components/Frame";
import { CloudflareLogo } from "../components/CloudflareLogo";
import { CornerBrackets } from "../components/CornerBrackets";

const TOTAL = 7;
const SLIDE_INDEX = 3;

/**
 * Slide 3 — the journey.
 *
 * Animated horizontal timeline:
 *   Pre-2018 → Two attacks → Joined Cloudflare → Today.
 * Line draws left-to-right, CF247 logo playhead glides over it, each
 * node fades and slides up in sequence. The "Today" node has a slow
 * idle pulse to convey "still active".
 */
export const storySlide: SlideDef = {
  id: "story",
  title: "Two attacks. Three months.",
  layout: "full",
  notes: (
    <>
      <p>
        Car Finance 247 came to us in 2018. The way they got there is the
        story I want to set up for the conversation. Two large attacks
        within three months. Their standalone WAF couldn't keep up. They
        moved to Cloudflare — and as Michael will tell you shortly, the
        problem essentially disappeared.
      </p>
      <p>~35s.</p>
    </>
  ),
  render: () => (
    <Frame current={SLIDE_INDEX} total={TOTAL}>
      <div className="eyebrow">2018 → 2026 · The journey</div>

      <h2 className="h2" style={{ maxWidth: "20ch" }}>
        Two attacks. <span className="text-orange">Three months.</span>
      </h2>

      <p className="lede lede--wide" style={{ maxWidth: "60ch" }}>
        A standalone WAF couldn't keep up with the second one. Eight years on, the problem stays{" "}
        <span className="text-strong">forgotten</span>.
      </p>

      <Timeline />
    </Frame>
  ),
};

function Timeline() {
  return (
    <div className="timeline" role="list" aria-label="Car Finance 247 journey to Cloudflare">
      <div className="timeline__line" aria-hidden="true" />
      <div className="timeline__playhead" aria-hidden="true">
        <img src="/cf247-dtx-manchester/logos/carfinance247.png" alt="" />
      </div>

      <TimelineNode
        index={0}
        date="Before 2018"
        title="Standalone WAF"
        desc="Edge security stitched together in-house."
        icon={<ServerIcon />}
        tone="neutral"
      />
      <TimelineNode
        index={1}
        date="Q1 — Q2 2018"
        title="Two attacks"
        desc="Three months apart. The second one breaks through."
        icon={<BoltIcon />}
        tone="alert"
      />
      <TimelineNode
        index={2}
        date="2018"
        title="Car Finance 247 joins Cloudflare"
        desc="Migration in days. The problem disappears."
        icon={
          <CloudflareLogo
            style={{ height: "62%", width: "auto", color: "currentColor" }}
            title="Cloudflare"
          />
        }
        tone="cloudflare"
      />
      <TimelineNode
        index={3}
        date="Today · 2026"
        title="Eight years on"
        desc="Problems forgotten. Velocity unlocked."
        icon={<CheckIcon />}
        tone="now"
      />
    </div>
  );
}

type Tone = "neutral" | "alert" | "cloudflare" | "now";

function TimelineNode({
  index,
  date,
  title,
  desc,
  icon,
  tone,
}: {
  index: number;
  date: string;
  title: string;
  desc: string;
  icon: ReactNode;
  tone: Tone;
}) {
  return (
    <div
      role="listitem"
      className={`timeline__node timeline__node--${tone}`}
      style={{ "--node-index": index } as CSSProperties}
    >
      <div className="timeline__circle" aria-hidden="true">
        {tone === "now" && <span className="timeline__pulse" aria-hidden="true" />}
        <span className="timeline__icon">{icon}</span>
      </div>

      <div className="timeline__card">
        <CornerBrackets />
        <div className="timeline__date">{date}</div>
        <div className="timeline__title">{title}</div>
        <div className="timeline__desc">{desc}</div>
      </div>
    </div>
  );
}

function ServerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="8" rx="2" />
      <rect x="3" y="13" width="18" height="8" rx="2" />
      <path d="M7 7h.01" />
      <path d="M7 17h.01" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
