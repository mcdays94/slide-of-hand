/**
 * Presenter affordances composition point.
 *
 * Each Wave 3 slice plugs into this single component instead of editing
 * <Deck> directly. That keeps three parallel workers' diffs landing on
 * DISTINCT slot markers within this file, so cherry-pick auto-merges
 * cleanly at integration time.
 *
 * Slots:
 *   - Slice #5 (presenter window) → SLICE_5_*
 *   - Slice #6 (presentation tools) → SLICE_6_*
 *
 * The component returns null when `usePresenterMode()` is false (i.e., on
 * the public `/decks/<slug>` route). Slice #7 wraps the admin viewer in
 * `<PresenterModeProvider enabled={true}>` to activate everything below.
 *
 * Each slice's component is responsible for its own keyboard listeners,
 * its own broadcast channel sends, and its own DOM. <Deck> doesn't know
 * about presenter affordances beyond mounting this single component.
 */
import { Fragment } from "react";
import { usePresenterMode } from "./mode";

// >>> SLICE_5_IMPORTS — slice #5 worker adds:
import { PresenterWindowTrigger } from "./PresenterWindowTrigger";

// >>> SLICE_6_IMPORTS — slice #6 worker adds:
// import { PresenterTools } from "@/framework/tools/PresenterTools";

export function PresenterAffordances() {
  if (!usePresenterMode()) return null;
  return (
    <Fragment>
      {/* >>> SLICE_5_MOUNT — slice #5 worker adds <PresenterWindowTrigger /> below: */}
      <PresenterWindowTrigger />

      {/* >>> SLICE_6_MOUNT — slice #6 worker adds <PresenterTools /> below: */}

    </Fragment>
  );
}
