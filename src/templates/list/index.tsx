/**
 * List template — title + bullet list of items.
 *
 * The `list` slot resolves to a `<ul>` with one `<li>` per item via
 * `renderSlot`. The template wraps it in styled containers; per-item
 * reveals are not yet supported (parked debt — `revealAt` lives on the
 * whole slot in v0.1).
 */

import type { ReactNode } from "react";
import type { SlideTemplate } from "@/framework/templates/types";

const list: SlideTemplate<{
  title: "text";
  items: "list";
}> = {
  id: "list",
  label: "List",
  description: "Title plus a bulleted list of items. Useful for agendas or takeaways.",
  defaultLayout: "default",
  slots: {
    title: {
      kind: "text",
      label: "Title",
      description: "Heading above the list.",
      required: true,
      maxLength: 120,
      placeholder: "Today's agenda",
    },
    items: {
      kind: "list",
      label: "Items",
      description: "One bullet per line.",
      required: true,
    },
  },
  render: ({ slots }) => {
    const s = slots as unknown as {
      title: ReactNode;
      items: ReactNode;
    };
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <h2 className="text-4xl font-medium tracking-[-0.025em] text-cf-text">
          {s.title}
        </h2>
        <div className="cf-list-block text-lg leading-relaxed text-cf-text-muted [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-6 [&_li]:marker:text-cf-orange">
          {s.items}
        </div>
      </div>
    );
  },
};

export default list;
