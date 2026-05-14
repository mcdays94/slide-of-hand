/**
 * Tests for `worker/diag-artifacts.ts` — the Cloudflare Artifacts
 * diagnostic endpoint.
 *
 * Originally untested; this file lands alongside the #182 probe
 * enhancement that adds:
 *
 *   - An UNCONDITIONAL ghost-probe `get(${forkTestName})` after the
 *     fork step (was previously skipped on fork failure). Detects the
 *     "fork returned 500 but actually created a repo server-side"
 *     pattern documented in `artifacts-client.ts`.
 *
 *   - A direct `Artifacts.create(${createTestName})` probe that
 *     exercises the repo-creation API without going through fork.
 *     Gives us a definitive read on whether the `create()` path is
 *     a viable workaround for the broken `fork()`.
 *
 *   - A ghost-probe `get(${createTestName})` after the create step,
 *     symmetric with the fork ghost probe.
 *
 *   - An `Artifacts.list({ limit: 50 })` step that enumerates the
 *     namespace so we can see what's actually present (drafts, diag
 *     repos, ghosts) without writing additional code.
 *
 * Mocks the `ARTIFACTS` binding's `get` / `create` / `list` / `fork`
 * surface so we can assert orchestration without hitting the real
 * service. Mirrors the stub style from `artifacts-client.test.ts`.
 */

import { describe, it, expect, vi } from "vitest";
import { handleDiagArtifacts, type DiagArtifactsEnv } from "./diag-artifacts";

// ── Stubs ────────────────────────────────────────────────────────────

/**
 * Default repo handle stub. Each method throws "not stubbed" so a test
 * that triggers an unexpected method call fails loudly.
 */
function makeRepoStub(overrides: Partial<ArtifactsRepo> = {}): ArtifactsRepo {
  const notStubbed = (method: string) => () => {
    throw new Error(`ArtifactsRepo.${method} not stubbed in this test`);
  };
  return {
    id: "repo-id-deck-starter",
    name: "deck-starter",
    description: null,
    remote: "https://x.artifacts.cloudflare.net/git/x/deck-starter.git",
    defaultBranch: "main",
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    lastPushAt: null,
    source: null,
    readOnly: false,
    createToken: vi.fn(notStubbed("createToken")),
    listTokens: vi.fn(notStubbed("listTokens")),
    revokeToken: vi.fn(notStubbed("revokeToken")),
    fork: vi.fn(notStubbed("fork")),
    ...overrides,
  } as unknown as ArtifactsRepo;
}

function makeArtifactsStub(overrides: Partial<Artifacts> = {}): Artifacts {
  const notStubbed = (method: string) => () => {
    throw new Error(`Artifacts.${method} not stubbed in this test`);
  };
  const stub = {
    create: vi.fn(notStubbed("create")),
    get: vi.fn(notStubbed("get")),
    list: vi.fn(notStubbed("list")),
    import: vi.fn(notStubbed("import")),
    delete: vi.fn(notStubbed("delete")),
    ...overrides,
  };
  return stub as unknown as Artifacts;
}

/** Build an Access-authenticated GET to the diag path. */
function authedRequest(): Request {
  return new Request("https://example.com/api/admin/_diag/artifacts", {
    method: "GET",
    headers: {
      // The simplest of `requireAccessAuth`'s three accepted signals;
      // a non-empty JWT assertion clears the gate.
      "cf-access-jwt-assertion": "fake.jwt.for.test",
    },
  });
}

type DiagResponse = {
  forkTestRepoName: string;
  createTestRepoName: string;
  steps: Array<{
    step: string;
    ok: boolean;
    durationMs: number;
    result?: Record<string, unknown>;
    error?: { name: string; message: string };
  }>;
  allOk: boolean;
  failedSteps: string[];
  derivedSignals: {
    forkApiHealthy: boolean;
    forkCreatedGhostRepo: boolean;
    createApiHealthy: boolean;
    createCreatedGhostRepo: boolean;
    listApiHealthy: boolean;
    listedRepoCount: number | null;
  };
};

// ── Route guards ─────────────────────────────────────────────────────

describe("handleDiagArtifacts — route guards", () => {
  it("returns null for non-matching paths so the main fetch chain falls through", async () => {
    const env: DiagArtifactsEnv = { ARTIFACTS: makeArtifactsStub() };
    const req = new Request("https://example.com/not/the/diag");
    expect(await handleDiagArtifacts(req, env)).toBeNull();
  });

  it("returns 405 for non-GET methods", async () => {
    const env: DiagArtifactsEnv = { ARTIFACTS: makeArtifactsStub() };
    const req = new Request("https://example.com/api/admin/_diag/artifacts", {
      method: "POST",
    });
    const res = await handleDiagArtifacts(req, env);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(405);
  });

  it("rejects unauthenticated requests with a 403", async () => {
    const env: DiagArtifactsEnv = { ARTIFACTS: makeArtifactsStub() };
    const req = new Request("https://example.com/api/admin/_diag/artifacts");
    const res = await handleDiagArtifacts(req, env);
    expect(res?.status).toBe(403);
  });
});

// ── Happy path: everything works ─────────────────────────────────────

describe("handleDiagArtifacts — happy path (all APIs healthy)", () => {
  it("runs get, fork, ghost-probe, createToken, create, create-ghost-probe, list and reports allOk", async () => {
    const forkResult = {
      id: "forked-id",
      name: "diag-fork-1-abc",
      description: null,
      defaultBranch: "main",
      remote: "https://x/diag-fork-1-abc.git",
      token: "art_v1_fork_initial",
      tokenExpiresAt: "2026-06-01T00:00:00Z",
    };
    const tokenResult = {
      id: "token-id",
      plaintext: "art_v1_test",
      scope: "read" as const,
      expiresAt: "2026-05-13T18:00:00Z",
    };
    const createResult = {
      id: "created-id",
      name: "diag-create-1-xyz",
      description: null,
      defaultBranch: "main",
      remote: "https://x/diag-create-1-xyz.git",
      token: "art_v1_create",
      tokenExpiresAt: "2026-06-01T00:00:00Z",
    };
    const listResult = {
      repos: [
        {
          id: "r1",
          name: "deck-starter",
          description: "Baseline",
          defaultBranch: "main",
          createdAt: "2026-05-01T00:00:00Z",
          updatedAt: "2026-05-01T00:00:00Z",
          lastPushAt: null,
          source: null,
          readOnly: false,
        },
      ],
      total: 1,
    };

    const starter = makeRepoStub({
      fork: vi.fn(async () => forkResult) as ArtifactsRepo["fork"],
    });
    const forked = makeRepoStub({
      id: forkResult.id,
      name: forkResult.name,
      remote: forkResult.remote,
      createToken: vi.fn(async () => tokenResult) as ArtifactsRepo["createToken"],
    });
    const created = makeRepoStub({
      id: createResult.id,
      name: createResult.name,
      remote: createResult.remote,
    });

    const getMock = vi.fn(async (name: string) => {
      if (name === "deck-starter") return starter;
      if (name.startsWith("diag-fork-")) return forked;
      if (name.startsWith("diag-create-")) return created;
      throw new Error(`Unexpected get(${name})`);
    });
    const createMock = vi.fn(async () => createResult);
    const listMock = vi.fn(async () => listResult);

    const env: DiagArtifactsEnv = {
      ARTIFACTS: makeArtifactsStub({
        get: getMock as Artifacts["get"],
        create: createMock as Artifacts["create"],
        list: listMock as Artifacts["list"],
      }),
    };

    const res = await handleDiagArtifacts(authedRequest(), env);
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as DiagResponse;

    expect(body.allOk).toBe(true);
    expect(body.failedSteps).toEqual([]);
    expect(body.steps.map((s) => s.step.split("(")[0])).toEqual([
      "get",
      "fork",
      "get",
      "createToken",
      "create",
      "get",
      "list",
    ]);
    expect(body.derivedSignals).toMatchObject({
      forkApiHealthy: true,
      forkCreatedGhostRepo: false,
      createApiHealthy: true,
      createCreatedGhostRepo: false,
      listApiHealthy: true,
      listedRepoCount: 1,
    });

    // `list` was called with the documented bound (limit 50).
    expect(listMock).toHaveBeenCalledWith({ limit: 50 });

    // `create()` was called with the right shape (the new probe must
    // exercise setDefaultBranch so the resulting repo is usable).
    expect(createMock).toHaveBeenCalledWith(
      expect.stringMatching(/^diag-create-/),
      expect.objectContaining({
        setDefaultBranch: "main",
        readOnly: false,
      }),
    );
  });
});

// ── Fork failure: ghost-probe detects server-side success ────────────

describe("handleDiagArtifacts — fork fails but repo IS created server-side", () => {
  it("reports forkCreatedGhostRepo: true when get(forkTestName) succeeds after fork failure", async () => {
    const starter = makeRepoStub({
      fork: vi.fn(async () => {
        throw new Error("ArtifactsError: An internal error occurred.");
      }) as ArtifactsRepo["fork"],
    });
    // The ghost: a get(forkTestName) call resolves a real handle.
    const ghost = makeRepoStub({
      id: "ghost-id",
      name: "diag-fork-ghost",
      remote: "https://x/diag-fork-ghost.git",
    });
    const created = makeRepoStub({
      id: "created-id",
      name: "diag-create-ok",
      remote: "https://x/diag-create-ok.git",
    });
    const getMock = vi.fn(async (name: string) => {
      if (name === "deck-starter") return starter;
      if (name.startsWith("diag-fork-")) return ghost;
      if (name.startsWith("diag-create-")) return created;
      throw new Error(`Unexpected get(${name})`);
    });
    const createMock = vi.fn(async () => ({
      id: "created-id",
      name: "diag-create-ok",
      description: null,
      defaultBranch: "main",
      remote: "https://x/diag-create-ok.git",
      token: "art_v1_x",
      tokenExpiresAt: "2026-06-01T00:00:00Z",
    }));
    const listMock = vi.fn(async () => ({ repos: [], total: 0 }));

    const env: DiagArtifactsEnv = {
      ARTIFACTS: makeArtifactsStub({
        get: getMock as Artifacts["get"],
        create: createMock as Artifacts["create"],
        list: listMock as Artifacts["list"],
      }),
    };

    const res = await handleDiagArtifacts(authedRequest(), env);
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as DiagResponse;

    // The fork step itself failed.
    const forkStep = body.steps.find((s) => s.step.startsWith("fork("));
    expect(forkStep?.ok).toBe(false);
    expect(forkStep?.error?.message).toMatch(/internal error/i);

    // But the ghost probe found the repo — meaning the fork did
    // succeed server-side despite the misleading 500.
    expect(body.derivedSignals.forkApiHealthy).toBe(false);
    expect(body.derivedSignals.forkCreatedGhostRepo).toBe(true);

    // Critical: the ghost-probe step must run UNCONDITIONALLY now.
    // Pre-#182 behaviour was to skip step 3 when step 2 failed; the
    // whole point of the new probe is to NOT skip it.
    const ghostProbe = body.steps.find(
      (s) => s.step.startsWith("get(") && s.step.includes("diag-fork-"),
    );
    expect(ghostProbe).toBeDefined();
    expect(ghostProbe?.ok).toBe(true);
  });

  it("reports forkCreatedGhostRepo: false when both fork() and the follow-up get() fail", async () => {
    const starter = makeRepoStub({
      fork: vi.fn(async () => {
        throw new Error("ArtifactsError: An internal error occurred.");
      }) as ArtifactsRepo["fork"],
    });
    const created = makeRepoStub({
      id: "created-id",
      name: "diag-create-ok",
      remote: "https://x/diag-create-ok.git",
    });
    const getMock = vi.fn(async (name: string) => {
      if (name === "deck-starter") return starter;
      if (name.startsWith("diag-create-")) return created;
      // Ghost probe also fails — the fork didn't create anything.
      throw new Error("ArtifactsError: Repository not found");
    });
    const createMock = vi.fn(async () => ({
      id: "created-id",
      name: "diag-create-ok",
      description: null,
      defaultBranch: "main",
      remote: "https://x/diag-create-ok.git",
      token: "art_v1_x",
      tokenExpiresAt: "2026-06-01T00:00:00Z",
    }));
    const listMock = vi.fn(async () => ({ repos: [], total: 0 }));

    const env: DiagArtifactsEnv = {
      ARTIFACTS: makeArtifactsStub({
        get: getMock as Artifacts["get"],
        create: createMock as Artifacts["create"],
        list: listMock as Artifacts["list"],
      }),
    };

    const res = await handleDiagArtifacts(authedRequest(), env);
    const body = (await res!.json()) as DiagResponse;

    expect(body.derivedSignals.forkApiHealthy).toBe(false);
    expect(body.derivedSignals.forkCreatedGhostRepo).toBe(false);
  });
});

// ── Create() also broken ─────────────────────────────────────────────

describe("handleDiagArtifacts — create() also returns generic 500", () => {
  it("reports createApiHealthy: false when create() throws", async () => {
    const starter = makeRepoStub({
      fork: vi.fn(async () => {
        throw new Error("ArtifactsError: An internal error occurred.");
      }) as ArtifactsRepo["fork"],
    });
    const getMock = vi.fn(async (name: string) => {
      if (name === "deck-starter") return starter;
      throw new Error("not found");
    });
    const createMock = vi.fn(async () => {
      throw new Error("ArtifactsError: An internal error occurred.");
    });
    const listMock = vi.fn(async () => ({ repos: [], total: 0 }));

    const env: DiagArtifactsEnv = {
      ARTIFACTS: makeArtifactsStub({
        get: getMock as Artifacts["get"],
        create: createMock as Artifacts["create"],
        list: listMock as Artifacts["list"],
      }),
    };

    const res = await handleDiagArtifacts(authedRequest(), env);
    const body = (await res!.json()) as DiagResponse;

    expect(body.derivedSignals.createApiHealthy).toBe(false);
    expect(body.derivedSignals.forkApiHealthy).toBe(false);
    // list is independent — it should still run and report.
    expect(body.derivedSignals.listApiHealthy).toBe(true);
  });
});

// ── list() surfaces what's in the namespace ──────────────────────────

describe("handleDiagArtifacts — list step", () => {
  it("returns the full names + descriptions of repos in the namespace", async () => {
    const starter = makeRepoStub({
      fork: vi.fn(async () => ({
        id: "forked-id",
        name: "diag-fork-ok",
        description: null,
        defaultBranch: "main",
        remote: "https://x/diag-fork-ok.git",
        token: "art_v1_fork_initial",
        tokenExpiresAt: "2026-06-01T00:00:00Z",
      })) as ArtifactsRepo["fork"],
    });
    const forked = makeRepoStub({
      createToken: vi.fn(async () => ({
        id: "t",
        plaintext: "x",
        scope: "read" as const,
        expiresAt: "2026-06-01T00:00:00Z",
      })) as ArtifactsRepo["createToken"],
    });
    const created = makeRepoStub();
    const getMock = vi.fn(async (name: string) => {
      if (name === "deck-starter") return starter;
      if (name.startsWith("diag-fork-")) return forked;
      if (name.startsWith("diag-create-")) return created;
      throw new Error(`Unexpected get(${name})`);
    });
    const createMock = vi.fn(async () => ({
      id: "c",
      name: "diag-create-ok",
      description: null,
      defaultBranch: "main",
      remote: "https://x.git",
      token: "x",
      tokenExpiresAt: "2026-06-01T00:00:00Z",
    }));
    const listMock = vi.fn(async () => ({
      repos: [
        {
          id: "r1",
          name: "deck-starter",
          description: "Baseline",
          defaultBranch: "main",
          createdAt: "2026-05-01T00:00:00Z",
          updatedAt: "2026-05-01T00:00:00Z",
          lastPushAt: null,
          source: null,
          readOnly: false,
        },
        {
          id: "r2",
          name: "mdias-cloudflare-com-crdt-collab",
          description: "Draft deck for crdt-collab by mdias@cloudflare.com",
          defaultBranch: "main",
          createdAt: "2026-05-12T14:30:00Z",
          updatedAt: "2026-05-12T14:30:00Z",
          lastPushAt: null,
          source: "artifacts:slide-of-hand-drafts/deck-starter",
          readOnly: false,
        },
      ],
      total: 2,
    }));

    const env: DiagArtifactsEnv = {
      ARTIFACTS: makeArtifactsStub({
        get: getMock as Artifacts["get"],
        create: createMock as Artifacts["create"],
        list: listMock as Artifacts["list"],
      }),
    };

    const res = await handleDiagArtifacts(authedRequest(), env);
    const body = (await res!.json()) as DiagResponse;

    const listStep = body.steps.find((s) => s.step.startsWith("list("));
    expect(listStep?.ok).toBe(true);
    expect(listStep?.result).toMatchObject({
      total: 2,
      repos: expect.arrayContaining([
        expect.objectContaining({ name: "deck-starter" }),
        expect.objectContaining({
          name: "mdias-cloudflare-com-crdt-collab",
        }),
      ]),
    });
    expect(body.derivedSignals.listedRepoCount).toBe(2);
  });

  it("reports listApiHealthy: false when list() throws, leaving listedRepoCount null", async () => {
    const starter = makeRepoStub({
      fork: vi.fn(async () => {
        throw new Error("ArtifactsError: An internal error occurred.");
      }) as ArtifactsRepo["fork"],
    });
    const getMock = vi.fn(async (name: string) => {
      if (name === "deck-starter") return starter;
      throw new Error("not found");
    });
    const createMock = vi.fn(async () => {
      throw new Error("create boom");
    });
    const listMock = vi.fn(async () => {
      throw new Error("list boom");
    });

    const env: DiagArtifactsEnv = {
      ARTIFACTS: makeArtifactsStub({
        get: getMock as Artifacts["get"],
        create: createMock as Artifacts["create"],
        list: listMock as Artifacts["list"],
      }),
    };

    const res = await handleDiagArtifacts(authedRequest(), env);
    const body = (await res!.json()) as DiagResponse;

    expect(body.derivedSignals.listApiHealthy).toBe(false);
    expect(body.derivedSignals.listedRepoCount).toBeNull();
  });
});

// ── Baseline failure short-circuits ──────────────────────────────────

describe("handleDiagArtifacts — baseline lookup fails", () => {
  it("skips fork + ghost + token but still runs create() and list()", async () => {
    const getMock = vi.fn(async () => {
      throw new Error("ArtifactsError: deck-starter not found");
    });
    const createMock = vi.fn(async () => ({
      id: "c",
      name: "diag-create-ok",
      description: null,
      defaultBranch: "main",
      remote: "https://x.git",
      token: "x",
      tokenExpiresAt: "2026-06-01T00:00:00Z",
    }));
    const listMock = vi.fn(async () => ({ repos: [], total: 0 }));

    const env: DiagArtifactsEnv = {
      ARTIFACTS: makeArtifactsStub({
        get: getMock as Artifacts["get"],
        create: createMock as Artifacts["create"],
        list: listMock as Artifacts["list"],
      }),
    };

    const res = await handleDiagArtifacts(authedRequest(), env);
    const body = (await res!.json()) as DiagResponse;

    // Baseline get failed, so no fork attempt.
    const stepNames = body.steps.map((s) => s.step);
    expect(stepNames[0]).toBe("get(deck-starter)");
    expect(stepNames.some((n) => n.startsWith("fork("))).toBe(false);

    // But the independent probes (create + list) still ran.
    expect(stepNames.some((n) => n.startsWith("create("))).toBe(true);
    expect(stepNames.some((n) => n.startsWith("list("))).toBe(true);
  });
});
