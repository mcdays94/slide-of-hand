/**
 * Quote template — large pull quote with optional attribution.
 *
 * Quote content is `richtext` to allow markdown emphasis once the
 * markdown renderer lands (parked debt — today richtext renders as
 * plain text per `renderSlot`).
 */

import type { ReactNode } from "react";
import type { SlideTemplate } from "@/framework/templates/types";
import { richtextProseClasses } from "../richtext-prose";

const quote: SlideTemplate<{
  quote: "richtext";
  attribution: "text";
}> = {
  id: "quote",
  label: "Quote",
  description: "Large pull quote with optional attribution.",
  defaultLayout: "default",
  slots: {
    quote: {
      kind: "richtext",
      label: "Quote",
      description: "The quote body. Markdown supported (when wired).",
      required: true,
      maxLength: 800,
      placeholder: "Any sufficiently advanced technology…",
    },
    attribution: {
      kind: "text",
      label: "Attribution",
      description: "Who said it.",
      required: false,
      maxLength: 120,
      placeholder: "— Arthur C. Clarke",
    },
  },
  render: ({ slots }) => {
    const s = slots as unknown as {
      quote: ReactNode;
      attribution?: ReactNode;
    };
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <blockquote className="cf-quote text-4xl font-medium leading-tight tracking-[-0.025em] text-cf-text">
          <span aria-hidden className="mr-2 text-cf-orange">
            &ldquo;
          </span>
          {/*
           * Prose styling is applied to a wrapper around the
           * richtext content rather than the <blockquote> itself
           * because the blockquote also carries decorative leading
           * and trailing quote-mark <span>s. Applying prose at the
           * blockquote level would space those decorative elements
           * away from the quote text. See `richtextProseClasses`
           * docstring (issue #86).
           */}
          <span className={`inline ${richtextProseClasses}`}>{s.quote}</span>
          <span aria-hidden className="ml-1 text-cf-orange">
            &rdquo;
          </span>
        </blockquote>
        {s.attribution && (
          <div className="text-base text-cf-text-muted">
            {s.attribution}
          </div>
        )}
      </div>
    );
  },
};

export default quote;
