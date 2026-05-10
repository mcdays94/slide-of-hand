/**
 * Tiny wrapper around `navigator.clipboard.writeText` used by slide 16's
 * "Copy" button. Pulled out of the slide module so it can be unit-tested
 * without rendering React + framer-motion.
 *
 * Resolves to `true` on success, `false` on any failure (permission
 * denied, missing API, hostile environment). Never throws — the UI
 * driving this should stay alive even if the clipboard call fails so a
 * presenter can fall back to typing the snippet manually.
 *
 * Typed structurally (rather than against `lib.dom.Navigator`) so the
 * file compiles cleanly in BOTH the SPA tsconfig (DOM lib) and the
 * worker/test tsconfig (workers-types lib, no DOM).
 *
 * The `nav` parameter is injectable so tests can pass in a stub.
 */
interface ClipboardLike {
  writeText: (text: string) => Promise<void>;
}
interface NavigatorLike {
  clipboard?: ClipboardLike;
}

export async function copyWithFeedback(
  text: string,
  nav: NavigatorLike | undefined = typeof navigator !== "undefined"
    ? (navigator as unknown as NavigatorLike)
    : undefined,
): Promise<boolean> {
  try {
    if (!nav || !nav.clipboard || typeof nav.clipboard.writeText !== "function") {
      return false;
    }
    await nav.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
