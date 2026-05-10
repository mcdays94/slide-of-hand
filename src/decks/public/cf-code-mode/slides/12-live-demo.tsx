import type { SlideDef } from "@/framework/viewer/types";
import { LiveDemoBody } from "./live-demo/LiveDemo";

/**
 * Slide 12 — Live MCP-vs-Code-Mode comparison.
 *
 * THE marquee slide. Layout=full so the deck chrome doesn't crowd the
 * two columns. The slide owns its own click capture (data-no-advance on
 * the root, data-interactive on every form field) so clicking inside
 * the demo doesn't advance the deck.
 *
 * Wiring is in `./live-demo/LiveDemo.tsx`; this file is the slide's
 * registry entry only.
 */
export const liveDemoSlide: SlideDef = {
  id: "live-demo",
  title: "MCP vs. Code Mode — live.",
  layout: "full",
  sectionLabel: "Live demo",
  sectionNumber: "05",
  phases: 0,
  render: () => <LiveDemoBody />,
};
