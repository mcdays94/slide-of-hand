/**
 * Element selector + fingerprint module — used by the inspector
 * (#14, slice 3) to identify a clicked element so the chosen Tailwind
 * override can be re-applied on subsequent renders.
 *
 * Pure DOM logic — framework-agnostic. Lives under `src/lib/` rather
 * than `src/framework/` so the Worker code-path could in principle
 * reuse it (it currently doesn't, but the dependency direction stays
 * sane: framework → lib, never the other way round).
 *
 * ── Why `tagName:nth-child(N)` and not class names ─────────────────
 *
 * The whole point of the inspector is to mutate `className` at runtime.
 * Encoding the selector against class names would be self-defeating: the
 * very act of applying an override would invalidate the lookup. Walking
 * by structural position (`tagName` + `:nth-child`) is stable across
 * className mutations and across re-renders that emit identical JSX.
 *
 * ── Fingerprint convention ─────────────────────────────────────────
 *
 * `fingerprint(el)` returns the literal `{ tag: el.tagName.toLowerCase(),
 * text: el.textContent.slice(0, 80) }` with NO trimming or normalization.
 * The AC in #44 is explicit about the shape, so the comparison in
 * `findBySelector` uses byte-identical strings. If the slide source
 * changes such that the trailing whitespace shifts, that's still treated
 * as an "orphaned" mutation — which is the conservative / safe outcome.
 */

const ROOT_SELECTOR = ":scope" as const;

/**
 * Compute a CSS selector path from `slideRoot` down to `el`.
 *
 * The selector is built by walking up from `el` to `slideRoot`,
 * recording each step as `<tag>:nth-child(<1-based-index>)`. The
 * resulting path is joined with ` > ` so the structure is unambiguous
 * (no descendant fallback), and it round-trips cleanly through
 * `Element.querySelector` invoked against `slideRoot`.
 *
 * Edge cases:
 *  - If `el === slideRoot` the function returns `:scope`. `findBySelector`
 *    short-circuits this and returns the slideRoot directly without
 *    actually invoking `querySelector(":scope")` (the spec for `:scope`
 *    in `Element.querySelector` is well-defined, but this avoids
 *    relying on the implementation details of the test DOM).
 *  - If `el` is not a descendant of `slideRoot` the function throws
 *    `Error("Element is not a descendant of slideRoot")`. Callers should
 *    have validated this beforehand (the inspector only tracks elements
 *    the user clicked inside the slide subtree).
 */
export function computeSelector(el: Element, slideRoot: Element): string {
  if (el === slideRoot) return ROOT_SELECTOR;

  const segments: string[] = [];
  let current: Element | null = el;

  while (current && current !== slideRoot) {
    const parent: Element | null = current.parentElement;
    if (!parent) {
      throw new Error("Element is not a descendant of slideRoot");
    }
    // `:nth-child(N)` is 1-based and counts ELEMENT siblings only
    // (matching the CSS spec — text nodes do not contribute).
    const siblings = parent.children;
    let index = 0;
    for (let i = 0; i < siblings.length; i++) {
      if (siblings[i] === current) {
        index = i + 1;
        break;
      }
    }
    const tag = current.tagName.toLowerCase();
    segments.unshift(`${tag}:nth-child(${index})`);
    current = parent;
  }

  if (current !== slideRoot) {
    throw new Error("Element is not a descendant of slideRoot");
  }

  return segments.join(" > ");
}

/**
 * Capture a verification fingerprint for `el`.
 *
 * Used by `findBySelector` to detect "the selector still resolves to
 * something but the content has shifted" — i.e. the slide source
 * changed and the same structural position now hosts different text.
 *
 * Returns the literal `{ tag: tagName.toLowerCase(), text:
 * textContent.slice(0, 80) }` per #44 AC. No trimming.
 */
export function fingerprint(el: Element): { tag: string; text: string } {
  return {
    tag: el.tagName.toLowerCase(),
    text: (el.textContent ?? "").slice(0, 80),
  };
}

/**
 * Find the element previously identified by `selector` + `expectedFingerprint`.
 *
 *  - "matched"  — `querySelector` found the element AND its fingerprint matches.
 *  - "orphaned" — `querySelector` found an element but its fingerprint differs
 *                 (slide source changed; element shifted to a different node).
 *  - "missing"  — `querySelector` returned `null`.
 */
export function findBySelector(
  slideRoot: Element,
  selector: string,
  expectedFingerprint: { tag: string; text: string },
): { el: Element | null; status: "matched" | "orphaned" | "missing" } {
  let el: Element | null;

  if (selector === ROOT_SELECTOR || selector === "") {
    el = slideRoot;
  } else {
    try {
      el = slideRoot.querySelector(selector);
    } catch {
      // Defensive: an invalid selector (shouldn't happen for selectors
      // we generated, but could happen if a stored selector was
      // manually edited) is treated the same as a miss.
      el = null;
    }
  }

  if (!el) {
    return { el: null, status: "missing" };
  }

  const fp = fingerprint(el);
  if (fp.tag === expectedFingerprint.tag && fp.text === expectedFingerprint.text) {
    return { el, status: "matched" };
  }
  return { el, status: "orphaned" };
}
