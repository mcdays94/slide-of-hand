/**
 * Tests for `worker/sandbox-smoke.ts` — issue #131 phase 3c slice 0.
 *
 * The Cloudflare Sandbox SDK can't be exercised in jsdom / happy-dom
 * — `@cloudflare/sandbox` transitively imports `@cloudflare/containers`
 * which uses `cloudflare:workers` schemes that only resolve inside
 * the Workers runtime. We stub `getSandbox` so the test can pin the
 * routing + Access-gate + response-shape contracts without spinning
 * up a real container.
 *
 * Behaviour that real-Sandbox-only validates (not covered here):
 *   - The container actually runs `echo hello from sandbox`.
 *   - The DO instance is reachable from the Worker class binding.
 *   - The image is the expected version.
 *
 * Those are smoke-tested manually post-deploy by GETting the
 * `/api/admin/sandbox/_smoke` endpoint with service-token auth.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { getSandboxMock, execMock } = vi.hoisted(() => ({
  getSandboxMock: vi.fn(),
  execMock: vi.fn(),
}));

vi.mock("@cloudflare/sandbox", () => ({
  getSandbox: getSandboxMock,
}));

import {
  handleSandboxSmoke,
  runSandboxSmoke,
  type SandboxSmokeEnv,
} from "./sandbox-smoke";

function makeEnv(): SandboxSmokeEnv {
  // The SDK's typed `DurableObjectNamespace<Sandbox>` carries the
  // full RPC surface of the Sandbox class. We never hit any of those
  // methods in tests (getSandbox is mocked above), so a bare cast is
  // enough — but it has to go via `unknown` because the typed
  // namespace is structurally too rich to construct as an object
  // literal.
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Sandbox: {} as unknown as SandboxSmokeEnv["Sandbox"],
  };
}

/** Build a Request that has cleared Cloudflare Access. */
function adminRequest(input: string | URL, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("cf-access-authenticated-user-email", "test@example.com");
  return new Request(input, { ...init, headers });
}

beforeEach(() => {
  getSandboxMock.mockReset();
  execMock.mockReset();
  getSandboxMock.mockReturnValue({ exec: execMock });
});

describe("handleSandboxSmoke — path matching", () => {
  it("returns null for paths outside /api/admin/sandbox/_smoke", async () => {
    const req = adminRequest(
      "https://example.com/api/admin/decks/hello",
    );
    expect(await handleSandboxSmoke(req, makeEnv())).toBeNull();
    expect(getSandboxMock).not.toHaveBeenCalled();
  });

  it("returns null for /api/admin/sandbox/<other-subpath>", async () => {
    // Paranoia check — the matcher uses an exact pathname comparison,
    // not a prefix, so a sibling endpoint can be added later without
    // accidentally hitting this handler.
    const req = adminRequest(
      "https://example.com/api/admin/sandbox/run",
    );
    expect(await handleSandboxSmoke(req, makeEnv())).toBeNull();
  });

  it("returns null for the public /sandbox/_smoke (no /api/admin prefix)", async () => {
    const req = adminRequest("https://example.com/sandbox/_smoke");
    expect(await handleSandboxSmoke(req, makeEnv())).toBeNull();
  });
});

describe("handleSandboxSmoke — method gate", () => {
  it("rejects POST with 405", async () => {
    const req = adminRequest(
      "https://example.com/api/admin/sandbox/_smoke",
      { method: "POST" },
    );
    const res = await handleSandboxSmoke(req, makeEnv());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(405);
    // We must NOT hit the sandbox for a wrong-method request — even
    // if Access cleared, an unexpected method shouldn't spend a
    // container exec on a misrouted call.
    expect(getSandboxMock).not.toHaveBeenCalled();
  });
});

describe("handleSandboxSmoke — auth gate", () => {
  it("returns 403 when the cf-access-authenticated-user-email header is missing", async () => {
    const req = new Request(
      "https://example.com/api/admin/sandbox/_smoke",
    );
    const res = await handleSandboxSmoke(req, makeEnv());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    // Critical: the auth gate must fire BEFORE we touch the
    // expensive container. A misconfigured Access app should fail
    // closed at this layer, not at the Sandbox SDK layer.
    expect(getSandboxMock).not.toHaveBeenCalled();
  });
});

describe("handleSandboxSmoke — happy path", () => {
  it("returns 200 with stdout / stderr / exitCode when sandbox.exec resolves", async () => {
    execMock.mockResolvedValueOnce({
      stdout: "hello from sandbox\n",
      stderr: "",
      exitCode: 0,
      success: true,
    });
    const req = adminRequest(
      "https://example.com/api/admin/sandbox/_smoke",
    );
    const res = await handleSandboxSmoke(req, makeEnv());
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as {
      ok: boolean;
      stdout: string;
      stderr: string;
      exitCode: number;
      success: boolean;
    };
    expect(body).toEqual({
      ok: true,
      stdout: "hello from sandbox\n",
      stderr: "",
      exitCode: 0,
      success: true,
    });
    // The smoke endpoint uses the singleton "_smoke" sandbox ID so
    // the container stays warm across health-check runs.
    expect(getSandboxMock).toHaveBeenCalledWith(expect.anything(), "_smoke");
    expect(execMock).toHaveBeenCalledWith("echo hello from sandbox");
  });
});

describe("handleSandboxSmoke — error surface", () => {
  it("returns 500 with the error message when sandbox.exec throws", async () => {
    // The SDK throws when the container can't be reached — most
    // commonly during the post-deploy provisioning window or after
    // a version mismatch between npm package and Docker image.
    execMock.mockRejectedValueOnce(new Error("Container unreachable"));
    const req = adminRequest(
      "https://example.com/api/admin/sandbox/_smoke",
    );
    const res = await handleSandboxSmoke(req, makeEnv());
    expect(res!.status).toBe(500);
    const body = (await res!.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/Container unreachable/);
  });

  it("returns 500 with the message when getSandbox itself throws", async () => {
    // Defensive — `getSandbox` is generally synchronous and returns
    // a stub, but if a future SDK version validates the binding
    // upfront and throws on a missing one, the catch should still
    // produce a useful 500 rather than letting the error escape.
    getSandboxMock.mockImplementationOnce(() => {
      throw new Error("Missing Sandbox binding");
    });
    const req = adminRequest(
      "https://example.com/api/admin/sandbox/_smoke",
    );
    const res = await handleSandboxSmoke(req, makeEnv());
    expect(res!.status).toBe(500);
    const body = (await res!.json()) as { ok: boolean; error: string };
    expect(body.error).toMatch(/Missing Sandbox binding/);
  });
});

describe("runSandboxSmoke — pure-ish executor", () => {
  it("can be invoked directly without going through the router", async () => {
    // Lets future callers reuse the smoke check from non-HTTP paths
    // (e.g. a scheduled health probe) without re-creating the
    // routing scaffolding.
    execMock.mockResolvedValueOnce({
      stdout: "x\n",
      stderr: "",
      exitCode: 0,
      success: true,
    });
    const res = await runSandboxSmoke(makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
