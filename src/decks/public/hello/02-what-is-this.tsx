/**
 * Slide 02 — what is this?
 *
 * Default layout (kicker + progress bar). Two paragraphs of body, plus a
 * callout that reveals at phase 1.
 */

import type { SlideDef } from "@/framework/viewer/types";
import { Reveal } from "@/framework/viewer/Reveal";

export const whatIsThisSlide: SlideDef = {
  id: "what-is-this",
  title: "What is ReAction?",
  layout: "default",
  sectionLabel: "Overview",
  sectionNumber: "01",
  phases: 1,
  runtimeSeconds: 30,
  notes: (
    <>
      <p>
        ReAction is a JSX-first deck platform: each slide is a React component;
        each deck is a folder of TypeScript files.
      </p>
      <p>
        Reveal the “No directives” callout when you say the line about
        descriptor schemas.
      </p>
    </>
  ),
  render: () => (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h2 className="text-5xl font-medium tracking-[-0.03em] text-cf-text">
        What is ReAction?
      </h2>

      <p className="text-lg leading-relaxed text-cf-text-muted">
        A self-hosted deck platform that runs on Cloudflare Workers + Static
        Assets. Each deck is a folder under <code className="font-mono text-base text-cf-text">src/decks/</code>;
        each slide is a typed React component you import into the deck file.
      </p>

      <p className="text-lg leading-relaxed text-cf-text-muted">
        The framework gives you keyboard navigation, phase reveals, layouts,
        and presenter ergonomics — and stays out of your way otherwise. Author
        with the same tools you’d use for any React app.
      </p>

      <Reveal at={1}>
        <div className="cf-card border-l-4 border-l-cf-orange p-6">
          <p className="cf-tag mb-1">No directives</p>
          <p className="text-base text-cf-text">
            No markdown vocabulary, no descriptor schema, no palette catalog.
            Slides are <span className="font-medium">just React</span>.
          </p>
        </div>
      </Reveal>
    </div>
  ),
};
