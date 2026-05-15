/**
 * Default export for the legacy-demo archived deck (issue #243).
 *
 * The registry tags this deck with `meta.archived = true` based on
 * its folder location (`src/decks/archive/*`); no other UI surface
 * needs to know.
 */
import type { Deck } from "@/framework/viewer/types";
import { meta } from "./meta";
import { coverSlide } from "./01-cover";

const deck: Deck = {
  meta,
  slides: [coverSlide],
};

export default deck;
