/**
 * Image-hero template — large image with optional caption beneath.
 *
 * The image slot resolves to an `<img>` produced by `renderSlot` (see
 * `src/framework/templates/render.tsx`). The renderer also sets `revealAt`
 * support, so callers can phase the caption in independently.
 */

import type { ReactNode } from "react";
import type { SlideTemplate } from "@/framework/templates/types";

const imageHero: SlideTemplate<{
  image: "image";
  caption: "text";
}> = {
  id: "image-hero",
  label: "Image hero",
  description: "Large hero image with an optional caption underneath.",
  defaultLayout: "default",
  slots: {
    image: {
      kind: "image",
      label: "Image",
      description: "The hero image. Upload via the image slot editor.",
      required: true,
    },
    caption: {
      kind: "text",
      label: "Caption",
      description: "Short caption shown below the image.",
      required: false,
      maxLength: 240,
      placeholder: "A short caption.",
    },
  },
  render: ({ slots }) => {
    const s = slots as unknown as {
      image: ReactNode;
      caption?: ReactNode;
    };
    return (
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-6">
        <div className="cf-image-hero w-full overflow-hidden rounded-md border border-cf-border bg-cf-bg-200">
          {s.image}
        </div>
        {s.caption && (
          <div className="text-center text-sm text-cf-text-muted">
            {s.caption}
          </div>
        )}
      </div>
    );
  },
};

export default imageHero;
