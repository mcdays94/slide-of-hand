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

  it("renders the simulated state by default (no Worker Loader binding)", () => {
    render(<HealthPill />);
    const pill = screen.getByTestId("health-pill");
    expect(pill).toHaveAttribute("data-state", "simulated");
    expect(pill).toHaveTextContent(/simulated/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders the checking state on first render when simulate=false", () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}), // never resolves
    );
    render(<HealthPill simulate={false} />);
    const pill = screen.getByTestId("health-pill");
    expect(pill).toHaveAttribute("data-state", "checking");
    expect(pill).toHaveTextContent(/checking/i);
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
