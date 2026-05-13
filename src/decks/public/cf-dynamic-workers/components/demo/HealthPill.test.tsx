import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { HealthPill } from "./HealthPill";

describe("HealthPill", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockOnce(response: unknown, status = 200) {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify(response), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  }

  it("renders the checking state by default (real /api/cf-dynamic-workers/health probe in flight)", () => {
    // The default flipped from simulate=true → false post-#167 once the
    // Worker Loader binding shipped. The pill now probes the real
    // /api/cf-dynamic-workers/health endpoint on mount and renders the
    // result. Default render with no fetch mock + no explicit simulate
    // prop should land in the "checking" state while the probe is
    // in flight.
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}), // never resolves
    );
    render(<HealthPill />);
    const pill = screen.getByTestId("health-pill");
    expect(pill).toHaveAttribute("data-state", "checking");
    expect(pill).toHaveTextContent(/checking/i);
    // Confirms the default endpoint is the namespaced one.
    expect(fetch).toHaveBeenCalledWith(
      "/api/cf-dynamic-workers/health",
      expect.any(Object),
    );
  });

  it("renders the simulated state when simulate=true is explicitly passed", () => {
    // The simulate=true opt-in is retained for the rare case where the
    // pill is rendered outside the platform (e.g. unit tests that
    // don't intercept fetch). When set, fetch is never called.
    render(<HealthPill simulate />);
    const pill = screen.getByTestId("health-pill");
    expect(pill).toHaveAttribute("data-state", "simulated");
    expect(pill).toHaveTextContent(/simulated/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders LOADER ✓ AI ✓ on a healthy backend (simulate=false)", async () => {
    mockOnce({ ok: true, loaderAvailable: true, aiAvailable: true });
    render(<HealthPill simulate={false} />);
    await waitFor(() => {
      expect(screen.getByTestId("health-pill")).toHaveAttribute(
        "data-state",
        "ok",
      );
    });
    expect(screen.getByTestId("health-pill")).toHaveTextContent(/LOADER ✓.*AI ✓/);
  });

  it("renders LOADER ✓ AI ✗ when only one binding is available (simulate=false)", async () => {
    mockOnce({ ok: true, loaderAvailable: true, aiAvailable: false });
    render(<HealthPill simulate={false} />);
    await waitFor(() => {
      expect(screen.getByTestId("health-pill")).toHaveAttribute(
        "data-state",
        "ok",
      );
    });
    expect(screen.getByTestId("health-pill")).toHaveTextContent(/AI ✗/);
  });

  it("renders the error state when fetch rejects (simulate=false)", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("network down"),
    );
    render(<HealthPill simulate={false} />);
    await waitFor(() => {
      expect(screen.getByTestId("health-pill")).toHaveAttribute(
        "data-state",
        "error",
      );
    });
    expect(screen.getByTestId("health-pill")).toHaveTextContent(/network down/);
  });

  it("renders an error pill when the response is non-2xx (simulate=false)", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("nope", { status: 503 }),
    );
    render(<HealthPill simulate={false} />);
    await waitFor(() => {
      expect(screen.getByTestId("health-pill")).toHaveAttribute(
        "data-state",
        "error",
      );
    });
    expect(screen.getByTestId("health-pill")).toHaveTextContent(/503/);
  });
});
