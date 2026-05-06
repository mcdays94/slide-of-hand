/**
 * Hook tests for `useDeckAnalytics`.
 *
 * happy-dom + a stubbed `fetch`. We render the hook and assert against
 * the captured fetch calls — that's the actual contract the Worker
 * relies on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDeckAnalytics } from "./useDeckAnalytics";

interface CapturedCall {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function captureFetchCalls(): CapturedCall[] {
  const calls: CapturedCall[] = [];
  const fetchMock = vi.fn(
    async (url: string | URL, init: RequestInit = {}) => {
      const bodyText =
        typeof init.body === "string" ? init.body : JSON.stringify(init.body);
      calls.push({
        url: String(url),
        init,
        body: bodyText ? JSON.parse(bodyText) : {},
      });
      return new Response(null, { status: 204 });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

beforeEach(() => {
  // happy-dom carries state across tests if we don't clear it.
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("useDeckAnalytics", () => {
  it("generates and persists a session ID on first call", () => {
    const calls = captureFetchCalls();
    const { result } = renderHook(() => useDeckAnalytics("hello"));
    act(() => {
      result.current.trackJump("cover");
    });
    const stored = window.sessionStorage.getItem(
      "slide-of-hand-session-id",
    );
    expect(stored).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.sessionId).toBe(stored);
  });

  it("reuses an existing session ID from sessionStorage", () => {
    window.sessionStorage.setItem(
      "slide-of-hand-session-id",
      "preexisting-session-id",
    );
    const calls = captureFetchCalls();
    const { result } = renderHook(() => useDeckAnalytics("hello"));
    act(() => {
      result.current.trackJump("cover");
    });
    expect(calls[0]!.body.sessionId).toBe("preexisting-session-id");
  });

  it("trackSlideAdvance posts slide_advance + view events", () => {
    const calls = captureFetchCalls();
    const { result } = renderHook(() => useDeckAnalytics("hello"));
    act(() => {
      result.current.trackSlideAdvance("cover", "second-slide", 4321);
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body).toMatchObject({
      slug: "hello",
      slideId: "cover",
      eventType: "slide_advance",
      durationMs: 4321,
    });
    expect(calls[1]!.body).toMatchObject({
      slug: "hello",
      slideId: "second-slide",
      eventType: "view",
    });
  });

  it("trackSlideAdvance with null fromSlideId only emits a view", () => {
    const calls = captureFetchCalls();
    const { result } = renderHook(() => useDeckAnalytics("hello"));
    act(() => {
      result.current.trackSlideAdvance(null, "cover", 0);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.eventType).toBe("view");
    expect(calls[0]!.body.slideId).toBe("cover");
  });

  it("trackPhaseAdvance posts phase_advance with phaseIndex", () => {
    const calls = captureFetchCalls();
    const { result } = renderHook(() => useDeckAnalytics("hello"));
    act(() => {
      result.current.trackPhaseAdvance("phase-demo", 2);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({
      eventType: "phase_advance",
      slideId: "phase-demo",
      phaseIndex: 2,
    });
  });

  it("trackJump posts a jump event", () => {
    const calls = captureFetchCalls();
    const { result } = renderHook(() => useDeckAnalytics("hello"));
    act(() => {
      result.current.trackJump("section");
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({
      eventType: "jump",
      slideId: "section",
    });
  });

  it("trackOverviewOpen posts an overview_open event with sentinel slideId", () => {
    const calls = captureFetchCalls();
    const { result } = renderHook(() => useDeckAnalytics("hello"));
    act(() => {
      result.current.trackOverviewOpen();
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({
      eventType: "overview_open",
      slideId: "overview",
    });
  });

  it("uses keepalive: true on every beacon", () => {
    const calls = captureFetchCalls();
    const { result } = renderHook(() => useDeckAnalytics("hello"));
    act(() => {
      result.current.trackJump("cover");
    });
    expect(calls[0]!.init.keepalive).toBe(true);
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("swallows fetch errors silently", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDeckAnalytics("hello"));
    expect(() => {
      act(() => {
        result.current.trackJump("cover");
      });
    }).not.toThrow();
  });

  it("rounds non-integer durations and phase indexes", () => {
    const calls = captureFetchCalls();
    const { result } = renderHook(() => useDeckAnalytics("hello"));
    act(() => {
      result.current.trackSlideAdvance("a", "b", 1234.7);
      result.current.trackPhaseAdvance("a", 1.4);
    });
    expect(calls[0]!.body.durationMs).toBe(1235);
    expect(calls[2]!.body.phaseIndex).toBe(1);
  });

  it("skips beacons when running as the author in dev mode", async () => {
    // Simulate the production-ish runtime where `import.meta.env.DEV`
    // is true AND `__PROJECT_ROOT__` is non-empty — the same shape
    // `npm run dev` produces for the author. We rebuild the hook
    // module under that condition via dynamic import + stubbing.
    const calls = captureFetchCalls();
    vi.stubEnv("MODE", "development");
    vi.stubEnv("DEV", true);
    vi.resetModules();
    const { useDeckAnalytics: hookUnderDevGate } = await import(
      "./useDeckAnalytics"
    );
    const { result } = renderHook(() => hookUnderDevGate("hello"));
    act(() => {
      result.current.trackJump("cover");
      result.current.trackSlideAdvance("a", "b", 100);
      result.current.trackPhaseAdvance("a", 1);
      result.current.trackOverviewOpen();
    });
    expect(calls).toHaveLength(0);
    vi.unstubAllEnvs();
  });

  it("clamps negative numeric arguments to 0", () => {
    const calls = captureFetchCalls();
    const { result } = renderHook(() => useDeckAnalytics("hello"));
    act(() => {
      result.current.trackSlideAdvance("a", "b", -5);
      result.current.trackPhaseAdvance("a", -3);
    });
    expect(calls[0]!.body.durationMs).toBe(0);
    expect(calls[2]!.body.phaseIndex).toBe(0);
  });
});
