import { describe, expect, it } from "vitest";

/**
 * Smoke test — proves Vitest is wired up and the test runner returns a clean
 * exit code on a fresh tree. Subsequent slices will replace this with real
 * tests for the framework primitives (`<Reveal>`, `usePhase`, deck registry
 * discovery, keyboard navigation).
 */
describe("scaffold", () => {
  it("can run a passing assertion", () => {
    expect(1 + 1).toBe(2);
  });
});
