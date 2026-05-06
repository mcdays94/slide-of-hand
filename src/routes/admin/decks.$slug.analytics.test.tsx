/**
 * Render tests for the admin analytics page.
 *
 * happy-dom has no `ResizeObserver`, which Recharts' `<ResponsiveContainer>`
 * relies on. We polyfill a no-op shim before the route mounts. The chart
 * is rendered "headless" in this env (no measured size) but the surrounding
 * KPI strip + table still render and that's what we want to assert.
 *
 * `fetch` is stubbed to return canned `AnalyticsResponse` payloads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminDeckAnalyticsRoute from "./decks.$slug.analytics";

// happy-dom doesn't ship ResizeObserver. Recharts touches it.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  // Stub once per test so individual `mockResolvedValue` calls are honoured.
  (
    globalThis as unknown as { ResizeObserver: typeof NoopResizeObserver }
  ).ResizeObserver = NoopResizeObserver;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderRoute(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/admin/decks/${slug}/analytics`]}>
      <Routes>
        <Route
          path="/admin/decks/:slug/analytics"
          element={<AdminDeckAnalyticsRoute />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function mockAnalyticsResponse(body: object): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }),
  );
}

describe("AdminDeckAnalyticsRoute", () => {
  it("renders 404 for unknown deck slugs", async () => {
    renderRoute("does-not-exist");
    expect(await screen.findByText(/404/)).toBeTruthy();
  });

  it("shows a loading state while the request is in flight", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(
          () =>
            new Promise(() => {
              /* never resolves */
            }),
        ),
    );
    renderRoute("hello");
    expect(
      await screen.findByTestId("analytics-loading"),
    ).toBeTruthy();
  });

  it("renders the empty state when totalViews is 0", async () => {
    mockAnalyticsResponse({
      slug: "hello",
      range: "7d",
      totalViews: 0,
      perSlide: [],
      perDay: [],
    });
    renderRoute("hello");
    expect(await screen.findByTestId("analytics-empty")).toBeTruthy();
  });

  it("renders the KPI strip, chart container, and table when data exists", async () => {
    mockAnalyticsResponse({
      slug: "hello",
      range: "7d",
      totalViews: 142,
      perSlide: [
        {
          slideId: "cover",
          views: 120,
          medianDurationMs: 4500,
          p75DurationMs: 9000,
          p95DurationMs: 14000,
          phaseAdvances: 0,
          jumpsTo: 3,
        },
        {
          slideId: "phase-demo",
          views: 80,
          medianDurationMs: 12000,
          p75DurationMs: 18000,
          p95DurationMs: 25000,
          phaseAdvances: 12,
          jumpsTo: 1,
        },
      ],
      perDay: [
        { date: "2026-05-04", views: 30 },
        { date: "2026-05-05", views: 40 },
        { date: "2026-05-06", views: 72 },
      ],
    });
    renderRoute("hello");

    expect(await screen.findByTestId("analytics-kpis")).toBeTruthy();
    expect(screen.getByTestId("analytics-chart")).toBeTruthy();
    expect(screen.getByTestId("analytics-table")).toBeTruthy();

    expect(screen.getByText("142")).toBeTruthy();
    expect(screen.getByText("cover")).toBeTruthy();
    expect(screen.getByText("phase-demo")).toBeTruthy();
  });

  it("re-fetches when the range changes", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        slug: "hello",
        range: "7d",
        totalViews: 0,
        perSlide: [],
        perDay: [],
      }),
      text: async () => "{}",
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderRoute("hello");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock.mock.calls[0]![0]).toContain("range=7d");

    fireEvent.click(screen.getByTestId("range-24h"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(fetchMock.mock.calls[1]![0]).toContain("range=24h");
  });

  it("renders an error state when the API call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({ error: "boom" }),
        text: async () => "boom",
      }),
    );
    renderRoute("hello");
    expect(await screen.findByTestId("analytics-error")).toBeTruthy();
  });
});
