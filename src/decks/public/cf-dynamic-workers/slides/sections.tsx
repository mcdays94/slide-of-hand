import type { SlideDef } from "@/framework/viewer/types";
import { SectionIntro } from "../components/primitives/SectionIntro";

export const sectionShapeOfCompute: SlideDef = {
  id: "section-shape-of-compute",
  layout: "section",
  render: () => (
    <SectionIntro
      number="01"
      label="The shape of compute"
      title="How code runs."
    />
  ),
};

export const sectionWhatsADynamicWorker: SlideDef = {
  id: "section-whats-a-dynamic-worker",
  layout: "section",
  render: () => (
    <SectionIntro
      number="02"
      label="What's a Dynamic Worker?"
      title="Spawn a server, on demand."
    />
  ),
};

export const sectionLiveDemo: SlideDef = {
  id: "section-live-demo",
  layout: "section",
  render: () => (
    <SectionIntro
      number="03"
      label="Live demo"
      title="Watch one being born."
    />
  ),
};

export const sectionWhyThisMatters: SlideDef = {
  id: "section-why-this-matters",
  layout: "section",
  render: () => (
    <SectionIntro
      number="04"
      label="Why this matters"
      title="AI, vibe-coding, multi-tenant."
    />
  ),
};
