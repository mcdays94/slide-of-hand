/**
 * Unit tests for the analytics API handlers.
 *
 * Two surfaces:
 *  - POST /api/beacon — exercised against an in-memory `writeDataPoint`
 *    spy, no real Analytics Engine binding required.
 *  - GET /api/admin/analytics/<slug> — `globalThis.fetch` is stubbed so
 *    we can assert the SQL the Worker sends to the Cloudflare API and
 *    the parsed response shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleAnalytics,
  type AnalyticsDataPoint,
  type AnalyticsEnv,
} from "./analytics";

class FakeAnalytics {
  events: AnalyticsDataPoint[] = [];
  shouldThrow = false;
  writeDataPoint(event: AnalyticsDataPoint): void {
    if (this.shouldThrow) throw new Error("AE write failed");
    this.events.push(event);
  }
}

function makeEnv(overrides: Partial<AnalyticsEnv> = {}): {
  env: AnalyticsEnv;
  ae: FakeAnalytics;
} {
  const ae = new FakeAnalytics();
  return {
    ae,
    env: {
      ANALYTICS: ae,
      CF_API_TOKEN: "test-token",
      CF_ACCOUNT_ID: "test-account",
      ...overrides,
    },
  };
}

async function call(
  request: Request,
  env: AnalyticsEnv,
): Promise<Response> {
  const res = await handleAnalytics(request, env);
  if (!res) {
    throw new Error(
      `handler returned null for ${request.method} ${request.url}`,
    );
  }
  return res;
}

const validBody = {
  slug: "hello",
  slideId: "cover",
  eventType: "view" as const,
  sessionId: "11111111-2222-3333-4444-555555555555",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/beacon", () => {
  it("writes a data point with the documented shape", async () => {
    const { env, ae } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/beacon", {
        method: "POST",
        body: JSON.stringify({
          ...validBody,
          eventType: "slide_advance",
          durationMs: 1500,
          phaseIndex: 0,
        }),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(ae.events).toHaveLength(1);
    const evt = ae.events[0]!;
    expect(evt.blobs).toEqual([
      "hello",
      "cover",
      "slide_advance",
      "11111111-2222-3333-4444-555555555555",
    ]);
    expect(evt.doubles).toEqual([1500, 0]);
    expect(evt.indexes).toEqual(["hello"]);
  });

  it("defaults durationMs and phaseIndex to 0 when omitted", async () => {
    const { env, ae } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/beacon", {
        method: "POST",
        body: JSON.stringify(validBody),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(204);
    expect(ae.events[0]!.doubles).toEqual([0, 0]);
  });

  it("rejects an invalid eventType with 400", async () => {
    const { env, ae } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/beacon", {
        method: "POST",
        body: JSON.stringify({ ...validBody, eventType: "scroll" }),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
    expect(ae.events).toHaveLength(0);
  });

  it("rejects a missing slug with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/beacon", {
        method: "POST",
        body: JSON.stringify({ ...validBody, slug: undefined }),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects an oversize body with 400", async () => {
    const { env } = makeEnv();
    const big = "a".repeat(3000);
    const res = await call(
      new Request("https://example.com/api/beacon", {
        method: "POST",
        body: JSON.stringify({ ...validBody, sessionId: big }),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/beacon", {
        method: "POST",
        body: "not-json",
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 405 for non-POST methods", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/beacon", { method: "GET" }),
      env,
    );
    expect(res.status).toBe(405);
  });

  it("swallows AE write failures and still returns 204", async () => {
    const { env, ae } = makeEnv();
    ae.shouldThrow = true;
    // Suppress noisy console.warn during the test.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await call(
      new Request("https://example.com/api/beacon", {
        method: "POST",
        body: JSON.stringify(validBody),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(204);
  });

  it("emits cache-control: no-store on the 204", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/beacon", {
        method: "POST",
        body: JSON.stringify(validBody),
        headers: { "content-type": "application/json" },
      }),
      env,
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /api/admin/analytics/<slug>", () => {
  function mockSqlResponses(responses: unknown[]): void {
    let i = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      const next = responses[i] ?? { data: [] };
      i += 1;
      return {
        ok: true,
        status: 200,
        json: async () => next,
        text: async () => JSON.stringify(next),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    return;
  }

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the SQL API once per per-slide aggregation and assembles the response", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
      text: async () => JSON.stringify({ data: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/admin/analytics/hello"),
      env,
    );
    expect(res.status).toBe(200);
    // Six queries: total views, per-day, per-slide views, per-slide
    // durations (median/p75/p95), per-slide phase advances, per-slide
    // jumps. CF Analytics SQL doesn't support the `*If` aggregate
    // variants, so we filter at WHERE level and stitch client-side.
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const firstCall = fetchMock.mock.calls[0]!;
    const url = firstCall[0] as string;
    const init = firstCall[1] as RequestInit;
    expect(url).toContain(
      "/accounts/test-account/analytics_engine/sql",
    );
    expect(init.method).toBe("POST");
    expect(
      (init.headers as Record<string, string>).authorization,
    ).toBe("Bearer test-token");
    const body = init.body as string;
    expect(body).toContain("FROM slide_of_hand_views");
    expect(body).toContain("blob1 = 'hello'");
  });

  it("uses 7d range by default and 24h when requested", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
      text: async () => JSON.stringify({ data: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { env } = makeEnv();
    await call(
      new Request("https://example.com/api/admin/analytics/hello"),
      env,
    );
    expect(fetchMock.mock.calls[0]![1]!.body).toContain("INTERVAL '7' DAY");

    fetchMock.mockClear();
    await call(
      new Request(
        "https://example.com/api/admin/analytics/hello?range=24h",
      ),
      env,
    );
    expect(fetchMock.mock.calls[0]![1]!.body).toContain("INTERVAL '1' DAY");
  });

  it("falls back to 7d for unknown range parameters", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
      text: async () => JSON.stringify({ data: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { env } = makeEnv();
    const res = await call(
      new Request(
        "https://example.com/api/admin/analytics/hello?range=90d",
      ),
      env,
    );
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0]![1]!.body).toContain("INTERVAL '7' DAY");
    const body = (await res.json()) as { range: string };
    expect(body.range).toBe("7d");
  });

  it("parses the SQL response into the documented shape", async () => {
    // Order matches the Promise.all in handleRead:
    //   1. total views
    //   2. per-day views
    //   3. per-slide view counts
    //   4. per-slide duration percentiles
    //   5. per-slide phase advances
    //   6. per-slide jump arrivals
    mockSqlResponses([
      { data: [{ totalViews: 100 }] },
      { data: [{ date: "2026-05-06", views: "12" }] },
      { data: [{ slideId: "cover", views: 100 }] },
      {
        data: [
          {
            slideId: "cover",
            medianDurationMs: 4500,
            p75DurationMs: 9000,
            p95DurationMs: 14000,
          },
        ],
      },
      { data: [{ slideId: "cover", count: 5 }] },
      { data: [{ slideId: "cover", count: 3 }] },
    ]);

    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/admin/analytics/hello"),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=300");
    const body = (await res.json()) as {
      slug: string;
      range: string;
      totalViews: number;
      perSlide: Array<{
        slideId: string;
        views: number;
        medianDurationMs: number;
        phaseAdvances: number;
        jumpsTo: number;
      }>;
      perDay: Array<{ date: string; views: number }>;
    };
    expect(body.slug).toBe("hello");
    expect(body.range).toBe("7d");
    expect(body.totalViews).toBe(100);
    expect(body.perSlide).toHaveLength(1);
    expect(body.perSlide[0]!).toMatchObject({
      slideId: "cover",
      views: 100,
      medianDurationMs: 4500,
      phaseAdvances: 5,
      jumpsTo: 3,
    });
    expect(body.perDay).toEqual([{ date: "2026-05-06", views: 12 }]);
  });

  it("synthesizes per-slide rows from the union of all per-slide queries", async () => {
    // A slide that has phase advances but no view events should still
    // appear in the result, with `views: 0`.
    mockSqlResponses([
      { data: [{ totalViews: 0 }] },
      { data: [] },
      // No per-slide views.
      { data: [] },
      // No per-slide durations.
      { data: [] },
      // Phase advances on `phase-demo`.
      { data: [{ slideId: "phase-demo", count: 7 }] },
      // Jumps to `cover`.
      { data: [{ slideId: "cover", count: 4 }] },
    ]);

    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/admin/analytics/hello"),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      perSlide: Array<{
        slideId: string;
        views: number;
        phaseAdvances: number;
        jumpsTo: number;
      }>;
    };
    const ids = body.perSlide.map((s) => s.slideId).sort();
    expect(ids).toEqual(["cover", "phase-demo"]);
    const phaseDemo = body.perSlide.find((s) => s.slideId === "phase-demo")!;
    expect(phaseDemo.views).toBe(0);
    expect(phaseDemo.phaseAdvances).toBe(7);
  });

  it("rejects an invalid slug with 400", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/admin/analytics/Bad..Slug"),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 502 when the SQL API errors", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
      text: async () => "boom",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/admin/analytics/hello"),
      env,
    );
    expect(res.status).toBe(502);
  });

  it("returns 502 when CF_API_TOKEN is missing", async () => {
    const { env } = makeEnv({ CF_API_TOKEN: undefined });
    const res = await call(
      new Request("https://example.com/api/admin/analytics/hello"),
      env,
    );
    expect(res.status).toBe(502);
  });

  it("returns 405 for POST on the read endpoint", async () => {
    const { env } = makeEnv();
    const res = await call(
      new Request("https://example.com/api/admin/analytics/hello", {
        method: "POST",
      }),
      env,
    );
    expect(res.status).toBe(405);
  });
});

describe("routing", () => {
  it("returns null for non-/api/* paths (handler not responsible)", async () => {
    const { env } = makeEnv();
    const res = await handleAnalytics(
      new Request("https://example.com/decks/hello"),
      env,
    );
    expect(res).toBeNull();
  });
});
