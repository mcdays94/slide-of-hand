/**
 * Tests for the `vscode://file/...` URL builder.
 *
 * The builder is pure: given an absolute project root, a deck visibility,
 * and a slug, it returns a `vscode://file/...?windowId=_blank` URL pointing
 * at `src/decks/<visibility>/<slug>/index.tsx`.
 *
 * Cross-platform contract:
 *   - POSIX paths are kept as-is (with the leading slash collapsed by the
 *     `vscode://file/` prefix to avoid `vscode://file//Users/...`).
 *   - Windows paths (mixed back/forward slashes) are normalised to forward
 *     slashes before being appended.
 *   - A trailing slash on the project root must not produce a double slash.
 *   - An empty `projectRoot` (production sentinel) returns "" so the consumer
 *     can guard the render.
 */

import { describe, expect, it } from "vitest";
import { vscodeUrlForDeckSource } from "./vscode-url";

describe("vscodeUrlForDeckSource", () => {
  it("builds a POSIX URL with no trailing slash", () => {
    expect(vscodeUrlForDeckSource("/Users/x/proj", "public", "hello")).toBe(
      "vscode://file/Users/x/proj/src/decks/public/hello/index.tsx?windowId=_blank",
    );
  });

  it("builds a POSIX URL with a trailing slash (no doubled slashes)", () => {
    expect(vscodeUrlForDeckSource("/Users/x/proj/", "public", "hello")).toBe(
      "vscode://file/Users/x/proj/src/decks/public/hello/index.tsx?windowId=_blank",
    );
  });

  it("normalises Windows-style backslashes to forward slashes", () => {
    expect(vscodeUrlForDeckSource("C:\\Users\\x\\proj", "public", "hello")).toBe(
      "vscode://file/C:/Users/x/proj/src/decks/public/hello/index.tsx?windowId=_blank",
    );
  });

  it("handles a Windows path with a trailing backslash", () => {
    expect(vscodeUrlForDeckSource("C:\\Users\\x\\proj\\", "public", "hello")).toBe(
      "vscode://file/C:/Users/x/proj/src/decks/public/hello/index.tsx?windowId=_blank",
    );
  });

  it("handles a Windows path with mixed separators", () => {
    expect(
      vscodeUrlForDeckSource("C:\\Users/x\\proj", "public", "hello"),
    ).toBe(
      "vscode://file/C:/Users/x/proj/src/decks/public/hello/index.tsx?windowId=_blank",
    );
  });

  it("composes the public visibility branch correctly", () => {
    expect(vscodeUrlForDeckSource("/Users/x/proj", "public", "alpha")).toBe(
      "vscode://file/Users/x/proj/src/decks/public/alpha/index.tsx?windowId=_blank",
    );
  });

  it("composes the private visibility branch correctly", () => {
    expect(vscodeUrlForDeckSource("/Users/x/proj", "private", "secret")).toBe(
      "vscode://file/Users/x/proj/src/decks/private/secret/index.tsx?windowId=_blank",
    );
  });

  it("returns an empty string when projectRoot is empty (production sentinel)", () => {
    expect(vscodeUrlForDeckSource("", "public", "hello")).toBe("");
  });
});
