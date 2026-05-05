/**
 * Build a `vscode://file/...` URL pointing at a deck's `index.tsx` source.
 *
 * Used by the `/admin` deck list to render a per-row "Open in IDE" button
 * (dev-mode only — see `import.meta.env.DEV` guard at the call site). VSCode
 * (and any IDE that registers the `vscode://` protocol handler) will open the
 * file directly when the link is followed.
 *
 * Cross-platform path handling:
 *   - POSIX absolute roots (e.g. `/Users/x/proj`) are kept as-is. The leading
 *     slash is dropped because the `vscode://file/` prefix already supplies
 *     one — otherwise we'd produce `vscode://file//Users/...` which some
 *     handlers parse as a UNC path.
 *   - Windows roots (e.g. `C:\Users\x\proj`) have all backslashes converted
 *     to forward slashes. The drive letter + colon are preserved.
 *   - A trailing path separator on the root is collapsed so we never emit
 *     consecutive slashes inside the URL.
 *
 * Production sentinel:
 *   - When `projectRoot` is `""` (the value injected by `vite build` — see
 *     `vite.config.ts` `define.__PROJECT_ROOT__`), the function returns `""`.
 *     Callers MUST guard on this and skip rendering the button.
 */
export function vscodeUrlForDeckSource(
  projectRoot: string,
  visibility: "public" | "private",
  slug: string,
): string {
  if (!projectRoot) return "";

  // Normalise Windows backslashes to forward slashes.
  let root = projectRoot.replace(/\\/g, "/");
  // Trim trailing slashes so we never produce `foo//src/...`.
  root = root.replace(/\/+$/, "");
  // Drop a single leading slash so the `vscode://file/` prefix isn't doubled.
  if (root.startsWith("/")) root = root.slice(1);

  return `vscode://file/${root}/src/decks/${visibility}/${slug}/index.tsx?windowId=_blank`;
}
