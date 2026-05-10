import { motion } from "framer-motion";
import { TrendingUp } from "lucide-react";
import type { SlideDef } from "@/framework/viewer/types";
import { Reveal } from "../lib/Reveal";
import { usePhase } from "@/framework/viewer/PhaseContext";
import { Tag } from "../components/primitives/Tag";
import { GiantNumber } from "../components/primitives/GiantNumber";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { Cite } from "../components/primitives/Cite";
import { SourceFooter } from "../components/primitives/SourceFooter";
import { easeEntrance } from "../lib/motion";

const SOURCES = [
  {
    n: 1,
    label:
      "Microsoft & LinkedIn · Work Trend Index Annual Report 2024",
    href: "https://www.microsoft.com/en-us/worklab/work-trend-index/ai-at-work-is-here-now-comes-the-hard-part",
  },
  {
    n: 2,
    label: "IBM · Cost of a Data Breach Report 2025",
    href: "https://www.ibm.com/reports/data-breach",
  },
];

export const aiMomentSlide: SlideDef = {
  id: "ai-moment",
  title: "The AI moment",
  layout: "default",
  sectionLabel: "OPENING",
  phases: 2,
  render: () => <AIMomentBody />,
};

function AIMomentBody() {
  const phase = usePhase();
  return (
    <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col justify-center gap-8">
      <div className="flex items-center gap-3">
        <Tag>Setting the scene</Tag>
        <Tag tone="muted">2024 → 2025</Tag>
      </div>

      <h2 className="text-4xl tracking-[-0.035em] sm:text-6xl">
        Every employee is now an{" "}
        <span className="text-cf-orange">AI developer.</span>
      </h2>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:items-stretch">
        <Reveal at={0} className="h-full">
          <CornerBrackets className="cf-card flex h-full flex-col gap-3 p-6">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
              Coverage
            </span>
            <GiantNumber value={75} suffix="%" className="text-6xl" />
            <p className="mt-auto text-sm text-cf-text-muted">
              of global knowledge workers use AI at work. Usage nearly
              doubled in six months
              <Cite n={1} href={SOURCES[0].href} />
            </p>
          </CornerBrackets>
        </Reveal>

        <Reveal at={1} className="h-full">
          <CornerBrackets className="cf-card flex h-full flex-col gap-3 p-6">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
              Reality
            </span>
            <GiantNumber
              value={78}
              suffix="%"
              color="var(--color-cf-warning)"
              className="text-6xl"
            />
            <p className="mt-auto text-sm text-cf-text-muted">
              of those AI users{" "}
              <span className="text-cf-text font-medium">
                bring their own AI to work
              </span>
              , bypassing IT-sanctioned tools and corporate guardrails (BYOAI)
              <Cite n={1} href={SOURCES[0].href} />
            </p>
          </CornerBrackets>
        </Reveal>

        <Reveal at={2} className="h-full">
          <CornerBrackets className="cf-card flex h-full flex-col gap-3 p-6">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cf-text-subtle">
              Risk
            </span>
            <GiantNumber
              value={97}
              suffix="%"
              color="var(--color-cf-error)"
              className="text-6xl"
            />
            <p className="mt-auto text-sm text-cf-text-muted">
              of organisations that suffered an AI-related security incident{" "}
              <span className="text-cf-text font-medium">
                lacked proper AI access controls
              </span>
              <Cite n={2} href={SOURCES[1].href} />
            </p>
          </CornerBrackets>
        </Reveal>
      </div>

      {/* Banner — always in flow so it doesn't shift the layout when it
          appears; only opacity + y animate as phase advances. */}
      <motion.div
        className="flex items-center gap-3 rounded-2xl border border-dashed border-cf-orange/40 bg-cf-orange-light p-6"
        initial={false}
        animate={{
          opacity: phase >= 2 ? 1 : 0,
          y: phase >= 2 ? 0 : 8,
        }}
        transition={{ duration: 0.45, ease: easeEntrance }}
      >
        <TrendingUp className="h-5 w-5 text-cf-orange" />
        <p className="text-cf-text">
          <span className="font-medium">The bet:</span>{" "}
          <span className="text-cf-text-muted">
            you can either say no to AI (you can't), or you can build the
            guardrails that make "yes, with confidence" the default answer.
          </span>
        </p>
      </motion.div>

      <SourceFooter sources={SOURCES} />
    </div>
  );
}
