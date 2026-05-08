/**
 * Full-bleed template — single edge-to-edge image. No title, no chrome.
 *
 * Default layout is `full` so the viewer suppresses the kicker bar +
 * progress chrome (see `<Slide>` in `src/framework/viewer/Slide.tsx`).
 */

import type { ReactNode } from "react";
import type { SlideTemplate } from "@/framework/templates/types";

const fullBleed: SlideTemplate<{
  image: "image";
}> = {
  id: "full-bleed",
  label: "Full-bleed",
  description: "Edge-to-edge image. No chrome — useful for hero shots.",
  defaultLayout: "full",
  slots: {
    image: {
      kind: "image",
      label: "Image",
      description: "The image to fill the slide.",
      required: true,
    },
  },
  render: ({ slots }) => {
    const s = slots as unknown as { image: ReactNode };
    return (
      <div className="cf-full-bleed flex h-full w-full items-center justify-center bg-cf-text [&_img]:max-h-full [&_img]:max-w-full [&_img]:object-contain">
        {s.image}
      </div>
    );
  },
};

export default fullBleed;
