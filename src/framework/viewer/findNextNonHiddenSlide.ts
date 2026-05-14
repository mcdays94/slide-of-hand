/**
 * Pure helper used by `deckReducer` to implement Sequential nav's
 * skip-Hidden semantics.
 *
 * Per ADR 0003 and the CONTEXT.md glossary:
 *   - The `useDeckState` cursor is keyed on `effectiveSlides` (all slides
 *     after manifest merge — hidden included).
 *   - Sequential nav (`→` / `←` and friends) MUST skip slides flagged
 *     `hidden: true` for both audience and admin.
 *   - ToC nav and `goto(N)` deliberately bypass this helper so admin can
 *     land on a Hidden slide without un-hiding it.
 *
 * The scan begins at `fromIndex + direction`. The cursor's own slide is
 * never returned — callers that exhaust phase reveals on the current
 * slide call this helper to find the next/prev slide to step to.
 *
 * @returns the effective-slides index of the next/prev non-hidden slide,
 *          or `null` when no such slide exists in the scan direction.
 */
export function findNextNonHiddenSlide(
  slides: { hidden?: boolean }[],
  fromIndex: number,
  direction: 1 | -1,
): number | null {
  for (let i = fromIndex + direction; i >= 0 && i < slides.length; i += direction) {
    if (!slides[i]?.hidden) {
      return i;
    }
  }
  return null;
}
