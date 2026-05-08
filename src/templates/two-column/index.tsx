/**
 * Two-column template — title spans the top, two equal columns below.
 *
 * Both columns are `richtext` (Slice 6 wires markdown rendering; today they
 * render as plain text via `renderSlot`).
 */

import type { ReactNode } from "react";
import type { SlideTemplate } from "@/framework/templates/types";

const twoColumn: SlideTemplate<{
  title: "text";
  left: "richtext";
  right: "richtext";
}> = {
  id: "two-column",
  label: "Two-column",
  description: "Title + left/right columns. Useful for compare-and-contrast.",
  defaultLayout: "default",
  slots: {
    title: {
      kind: "text",
      label: "Title",
      description: "Heading spanning both columns.",
      required: true,
      maxLength: 120,
      placeholder: "Before vs. after",
    },
    left: {
      kind: "richtext",
      label: "Left column",
      description: "Left-hand content. Markdown supported (Slice 6).",
      required: true,
      maxLength: 2000,
    },
    right: {
      kind: "richtext",
      label: "Right column",
      description: "Right-hand content. Markdown supported (Slice 6).",
      required: true,
      maxLength: 2000,
    },
  },
  render: ({ slots }) => {
    const s = slots as unknown as {
      title: ReactNode;
      left: ReactNode;
      right: ReactNode;
    };
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <h2 className="text-4xl font-medium tracking-[-0.03em] text-cf-text sm:text-5xl">
          {s.title}
        </h2>
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
          <div className="text-lg leading-relaxed text-cf-text-muted">
            {s.left}
          </div>
          <div className="text-lg leading-relaxed text-cf-text-muted">
            {s.right}
          </div>
        </div>
      </div>
    );
  },
};

export default twoColumn;
