/**
 * The CF Workers signature decoration — four 10px squares pinned
 * to the corners of a card. Use inside any element with `position: relative`.
 *
 * Scoped through the deck-local stylesheet's `.cf247-slide` selector
 * (see `styles.css` § Corner brackets), so the corner squares only render
 * inside cf247 slides.
 */
export function CornerBrackets() {
  return (
    <div className="corner-brackets" aria-hidden="true">
      <span className="corner-bracket corner-bracket--tl" />
      <span className="corner-bracket corner-bracket--tr" />
      <span className="corner-bracket corner-bracket--bl" />
      <span className="corner-bracket corner-bracket--br" />
    </div>
  );
}
