/**
 * Pin the public surface of `@/framework/citation`. The AI deck
 * generation prompt instructs the model to:
 *
 *     import { Cite, SourceFooter, type Source } from "@/framework/citation";
 *
 * so all three exports must remain stable at this path. A rename in
 * the future requires updating the prompt in lockstep — this test
 * catches accidental breakage.
 */
import { describe, expect, it } from "vitest";

import * as citation from "./index";

describe("@/framework/citation barrel exports", () => {
  it("exposes the `Cite` component", () => {
    expect(typeof citation.Cite).toBe("function");
  });

  it("exposes the `SourceFooter` component", () => {
    expect(typeof citation.SourceFooter).toBe("function");
  });

  it("exposes a `Source` type — verified by usage in a typed value", () => {
    // The runtime can't introspect type-only exports. This compile-
    // time line is the actual assertion: if `Source` were removed
    // or its shape changed, `tsc` would fail before the test runs.
    const sample: citation.Source = { n: 1, label: "x" };
    expect(sample.n).toBe(1);
  });
});
