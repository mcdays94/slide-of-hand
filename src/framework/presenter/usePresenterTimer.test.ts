/**
 * Pure-helper tests for the presenter timer + pacing classifier.
 *
 * The React hook (`useElapsedTime`) is integration-tested implicitly by the
 * presenter window mounting; here we cover only the pure functions, which is
 * where the off-by-one / sign / boundary risks live.
 */
import { describe, expect, it } from "vitest";
import {
  classifyPacing,
  expectedRuntimeMs,
  formatDelta,
  formatElapsed,
  readOrInitStart,
} from "./usePresenterTimer";

describe("formatElapsed", () => {
  it("formats sub-minute durations as 0:SS", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(1_000)).toBe("0:01");
    expect(formatElapsed(59_999)).toBe("0:59");
  });

  it("rolls over the minute boundary", () => {
    expect(formatElapsed(60_000)).toBe("1:00");
    expect(formatElapsed(125_000)).toBe("2:05");
  });

  it("clamps negative inputs to 0:00", () => {
    expect(formatElapsed(-1_000)).toBe("0:00");
  });
});

describe("formatDelta", () => {
  it("returns 0s without a sign for zero", () => {
    expect(formatDelta(0)).toBe("0s");
  });

  it("formats positive sub-minute deltas as +Ns", () => {
    expect(formatDelta(30_000)).toBe("+30s");
  });

  it("formats negative sub-minute deltas as -Ns", () => {
    expect(formatDelta(-30_000)).toBe("-30s");
  });

  it("formats whole minutes as ±Nm", () => {
    expect(formatDelta(120_000)).toBe("+2m");
    expect(formatDelta(-120_000)).toBe("-2m");
  });

  it("formats minute+second deltas as ±Nm Ss", () => {
    expect(formatDelta(65_000)).toBe("+1m 5s");
    expect(formatDelta(-65_000)).toBe("-1m 5s");
  });
});

describe("classifyPacing", () => {
  const expected = 600_000; // 10 minutes

  it("returns green inside the ±10s tolerance", () => {
    expect(classifyPacing(0, expected)).toBe("green");
    expect(classifyPacing(10_000, expected)).toBe("green");
    expect(classifyPacing(-10_000, expected)).toBe("green");
  });

  it("returns amber when over the green band but under 2× expected", () => {
    expect(classifyPacing(15_000, expected)).toBe("amber");
    expect(classifyPacing(120_000, expected)).toBe("amber");
  });

  it("returns amber when running ahead of schedule beyond green", () => {
    expect(classifyPacing(-30_000, expected)).toBe("amber");
  });

  it("returns red at and beyond 2× expected (delta ≥ expected)", () => {
    expect(classifyPacing(expected, expected)).toBe("red");
    expect(classifyPacing(expected + 1, expected)).toBe("red");
  });

  it("falls back to binary green/amber when no expected runtime", () => {
    expect(classifyPacing(0, 0)).toBe("green");
    expect(classifyPacing(11_000, 0)).toBe("amber");
    expect(classifyPacing(10_000_000, 0)).toBe("amber");
  });
});

describe("expectedRuntimeMs", () => {
  it("sums per-slide seconds when every slide has one", () => {
    expect(expectedRuntimeMs([10, 20, 30], 99)).toBe(60_000);
  });

  it("falls back to runtimeMinutes when any slide is missing seconds", () => {
    expect(expectedRuntimeMs([10, undefined, 30], 5)).toBe(300_000);
  });

  it("returns 0 when neither source is usable", () => {
    expect(expectedRuntimeMs([], undefined)).toBe(0);
    expect(expectedRuntimeMs([undefined, undefined], 0)).toBe(0);
  });
});

describe("readOrInitStart", () => {
  function makeStorage(initial: Record<string, string> = {}) {
    const data: Record<string, string> = { ...initial };
    return {
      data,
      storage: {
        getItem: (k: string) => data[k] ?? null,
        setItem: (k: string, v: string) => {
          data[k] = v;
        },
      } as Pick<Storage, "getItem" | "setItem">,
    };
  }

  it("initializes and persists when no value exists", () => {
    const { data, storage } = makeStorage();
    const start = readOrInitStart("hello", storage, 1_000);
    expect(start).toBe(1_000);
    expect(data["reaction-deck-elapsed:hello"]).toBe("1000");
  });

  it("reads the persisted value across calls (refresh case)", () => {
    const { storage } = makeStorage({
      "reaction-deck-elapsed:hello": "500",
    });
    expect(readOrInitStart("hello", storage, 9_999)).toBe(500);
  });

  it("returns `now` when storage is unavailable", () => {
    expect(readOrInitStart("hello", undefined, 42)).toBe(42);
  });

  it("scopes the key per slug", () => {
    const { data, storage } = makeStorage();
    readOrInitStart("a", storage, 100);
    readOrInitStart("b", storage, 200);
    expect(data["reaction-deck-elapsed:a"]).toBe("100");
    expect(data["reaction-deck-elapsed:b"]).toBe("200");
  });
});
