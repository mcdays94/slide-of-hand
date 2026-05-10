/**
 * Big-stat template — a single large number / metric with optional
 * supporting context underneath.
 *
 * The `stat` slot resolves to `<div class="cf-stat"><strong>VALUE</strong>
 * <span>CAPTION</span></div>` via `renderSlot` — we wrap it here in a
 * sized container.
 */

import type { ReactNode } from "react";
import type { SlideTemplate } from "@/framework/templates/types";
import { richtextProseClasses } from "../richtext-prose";

const bigStat: SlideTemplate<{
  stat: "stat";
  context: "richtext";
}> = {
  id: "big-stat",
  label: "Big stat",
  description: "A single large number or metric with optional supporting copy.",
  defaultLayout: "default",
  slots: {
    stat: {
      kind: "stat",
      label: "Stat",
      description: "The headline number (and optional caption).",
      required: true,
      maxLength: 32,
    },
    context: {
      kind: "richtext",
      label: "Context",
      description: "Supporting copy beneath the stat.",
      required: false,
      maxLength: 800,
      placeholder: "What this number means and why it matters.",
    },
  },
  render: ({ slots }) => {
    const s = slots as unknown as {
      stat: ReactNode;
      context?: ReactNode;
    };
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 text-center">
        <div className="cf-big-stat text-cf-orange [&_strong]:block [&_strong]:font-mono [&_strong]:text-[10rem] [&_strong]:font-medium [&_strong]:leading-none [&_strong]:tracking-[-0.05em] [&_span]:mt-3 [&_span]:block [&_span]:font-mono [&_span]:text-xs [&_span]:uppercase [&_span]:tracking-[0.25em] [&_span]:text-cf-text-muted">
          {s.stat}
        </div>
        {s.context && (
          <div
            className={`max-w-2xl text-lg leading-relaxed text-cf-text-muted ${richtextProseClasses}`}
          >
            {s.context}
          </div>
        )}
      </div>
    );
  },
};

export default bigStat;
