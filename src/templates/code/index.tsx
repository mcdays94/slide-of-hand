/**
 * Code template — optional title, a language label, and a code block.
 *
 * The `code` slot is rendered by `renderSlot` (see
 * `src/framework/templates/render.tsx`) as a `<pre><code>` element with
 * a `language-<lang>` class. Shiki / syntax-highlighting in production
 * is parked debt — Slice 8's notes called it out as a separate cleanup
 * to handle alongside richtext markdown rendering.
 *
 * The `lang` slot is purely a metadata hint; the renderer reads it from
 * the code slot value, not from this `lang` slot. We expose it as an
 * editable text slot so the editor surfaces a labelled input — useful
 * when authors want to display the language above the block.
 */

import type { ReactNode } from "react";
import type { SlideTemplate } from "@/framework/templates/types";

const code: SlideTemplate<{
  title: "text";
  lang: "text";
  code: "code";
}> = {
  id: "code",
  label: "Code",
  description: "Optional title + a code block. Useful for live demos.",
  defaultLayout: "default",
  slots: {
    title: {
      kind: "text",
      label: "Title",
      description: "Optional heading above the code block.",
      required: false,
      maxLength: 120,
      placeholder: "Reading this looks like…",
    },
    lang: {
      kind: "text",
      label: "Language",
      description: "Display label for the code block (e.g. 'TypeScript').",
      required: true,
      maxLength: 32,
      placeholder: "TypeScript",
    },
    code: {
      kind: "code",
      label: "Code",
      description: "Source. Edit the `lang` field on the code slot for highlighting.",
      required: true,
      maxLength: 4000,
    },
  },
  render: ({ slots }) => {
    const s = slots as unknown as {
      title?: ReactNode;
      lang: ReactNode;
      code: ReactNode;
    };
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        {s.title && (
          <h2 className="text-3xl font-medium tracking-[-0.025em] text-cf-text">
            {s.title}
          </h2>
        )}
        <div className="cf-tag self-start">{s.lang}</div>
        <div className="cf-code-block overflow-hidden rounded-md border border-cf-border bg-cf-bg-200 p-4 font-mono text-sm leading-relaxed text-cf-text">
          {s.code}
        </div>
      </div>
    );
  },
};

export default code;
