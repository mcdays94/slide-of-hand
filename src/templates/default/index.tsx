/**
 * Default template — title at the top, body in a comfortable reading column.
 *
 * Visual treatment mirrors `src/decks/public/hello/02-what-is-this.tsx`. The
 * body slot is `richtext` (Slice 6 will wire markdown rendering; today it
 * renders as plain text — see `renderSlot` in
 * `src/framework/templates/render.tsx`).
 */

import type { ReactNode } from "react";
import type { SlideTemplate } from "@/framework/templates/types";

const defaultTemplate: SlideTemplate<{
  title: "text";
  body: "richtext";
}> = {
  id: "default",
  label: "Default",
  description: "Title + body. The everyday content slide.",
  defaultLayout: "default",
  slots: {
    title: {
      kind: "text",
      label: "Title",
      description: "Section heading.",
      required: true,
      maxLength: 120,
      placeholder: "What is Slide of Hand?",
    },
    body: {
      kind: "richtext",
      label: "Body",
      description: "Main content. Markdown supported (rendered in Slice 6).",
      required: true,
      maxLength: 4000,
      placeholder: "A self-hosted deck platform…",
    },
  },
  render: ({ slots }) => {
    const s = slots as unknown as { title: ReactNode; body: ReactNode };
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <h2 className="text-5xl font-medium tracking-[-0.03em] text-cf-text">
          {s.title}
        </h2>
        <div className="text-lg leading-relaxed text-cf-text-muted">
          {s.body}
        </div>
      </div>
    );
  },
};

export default defaultTemplate;
