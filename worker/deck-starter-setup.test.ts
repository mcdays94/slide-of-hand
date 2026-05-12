/**
 * Tests for `worker/deck-starter-setup.ts` (issue #168 Wave 1 / Worker E).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  handleDeckStarterSetup,
  type DeckStarterSetupEnv,
} from "./deck-starter-setup";

function makeArtifactsStub(overrides: Partial<Artifacts> = {}): Artifacts {
  const notStubbed = (method: string) => () => {
    throw new Error(`Artifacts.${method} not stubbed`);
  };
  return {
    create: vi.fn(notStubbed("create")),
    get: vi.fn(notStubbed("get")),
    list: vi.fn(notStubbed("list")),
    import: vi.fn(notStubbed("import")),
    delete: vi.fn(notStubbed("delete")),
    ...overrides,
  } as unknown as Artifacts;
}

function makeRepoStub(overrides: Partial<ArtifactsRepo> = {}): ArtifactsRepo {
  return {
    id: "starter-id",
    name: "deck-starter",
    description: "...",
    remote: "https://x.artifacts.cloudflare.net/git/x/deck-starter.git",
    defaultBranch: "main",
    status: "ready",
    createToken: vi.fn(),
    listTokens: vi.fn(),
    revokeToken: vi.fn(),
    fork: vi.fn(),
    ...overrides,
  } as unknown as ArtifactsRepo;
}

function adminRequest(input: string | URL, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("cf-access-authenticated-user-email", "test@example.com");
  return new Request(input, { ...init, headers });
}

beforeEach(() => {
  // Silence info logs from the artifacts-client when the test hits the
  // "not found, creating" branch.
  vi.spyOn(console, "info").mockImplementation(() => {});
});

// Cast-helper for tests that simulate a missing ARTIFACTS binding —
// the production type marks it required, but the runtime check
// guards against misconfiguration drift.
const emptyEnv = {} as unknown as DeckStarterSetupEnv;

describe("handleDeckStarterSetup — path / method gates", () => {
  it("returns null for paths outside /api/admin/setup/deck-starter", async () => {
    const req = adminRequest("https://example.com/api/admin/decks");
    expect(
      await handleDeckStarterSetup(req, emptyEnv),
    ).toBeNull();
  });

  it("returns 405 for GET", async () => {
    const req = adminRequest(
      "https://example.com/api/admin/setup/deck-starter",
      { method: "GET" },
    );
    const res = await handleDeckStarterSetup(req, emptyEnv);
    expect(res!.status).toBe(405);
  });
});

describe("handleDeckStarterSetup — auth gate", () => {
  it("returns 403 when access auth is missing", async () => {
    const req = new Request(
      "https://example.com/api/admin/setup/deck-starter",
      { method: "POST" },
    );
    const res = await handleDeckStarterSetup(req, emptyEnv);
    expect(res!.status).toBe(403);
  });
});

describe("handleDeckStarterSetup — binding gate", () => {
  it("returns 503 when ARTIFACTS is not bound", async () => {
    const req = adminRequest(
      "https://example.com/api/admin/setup/deck-starter",
      { method: "POST" },
    );
    const res = await handleDeckStarterSetup(req, emptyEnv);
    expect(res!.status).toBe(503);
    const body = await res!.json();
    expect((body as { error: string }).error).toMatch(/ARTIFACTS/);
  });
});

describe("handleDeckStarterSetup — happy paths", () => {
  it("returns kind:existed when the baseline already exists", async () => {
    const baseline = makeRepoStub();
    const env: DeckStarterSetupEnv = {
      ARTIFACTS: makeArtifactsStub({
        get: vi.fn().mockResolvedValue(baseline) as Artifacts["get"],
      }),
    };

    const req = adminRequest(
      "https://example.com/api/admin/setup/deck-starter",
      { method: "POST" },
    );
    const res = await handleDeckStarterSetup(req, env);
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as {
      ok: boolean;
      kind: string;
      name: string;
    };
    expect(body.ok).toBe(true);
    expect(body.kind).toBe("existed");
    // We return only `name` on the existed branch (the SDK's repo
    // handle doesn't serialize the metadata fields reliably — see
    // the implementation comment).
    expect(body.name).toBe("deck-starter");
  });

  it("returns kind:created when the baseline did not exist yet", async () => {
    const env: DeckStarterSetupEnv = {
      ARTIFACTS: makeArtifactsStub({
        get: vi.fn().mockRejectedValue(new Error("not found")) as Artifacts["get"],
        create: vi.fn().mockResolvedValue({
          id: "new-id",
          name: "deck-starter",
          description: "...",
          remote: "https://x.artifacts.cloudflare.net/git/x/deck-starter.git",
          defaultBranch: "main",
          status: "ready",
          token: "art_v1_xxxx?expires=999",
        }) as Artifacts["create"],
      }),
    };

    const req = adminRequest(
      "https://example.com/api/admin/setup/deck-starter",
      { method: "POST" },
    );
    const res = await handleDeckStarterSetup(req, env);
    expect(res!.status).toBe(201);
    const body = (await res!.json()) as {
      ok: boolean;
      kind: string;
      repo: Record<string, unknown>;
    };
    expect(body.ok).toBe(true);
    expect(body.kind).toBe("created");
    // The initial token is NOT exposed — it lives in the response
    // from artifacts.create but the endpoint deliberately drops it
    // so curling this endpoint doesn't walk away with creds.
    expect(JSON.stringify(body.repo)).not.toContain("art_v1");
  });

  it("returns 500 when ensureDeckStarterRepo throws unexpectedly", async () => {
    const env: DeckStarterSetupEnv = {
      ARTIFACTS: makeArtifactsStub({
        // `get` AND `create` both fail — simulates a transient
        // backend error or misconfiguration.
        get: vi.fn().mockRejectedValue(new Error("backend down")) as Artifacts["get"],
        create: vi
          .fn()
          .mockRejectedValue(new Error("create failed")) as Artifacts["create"],
      }),
    };
    const req = adminRequest(
      "https://example.com/api/admin/setup/deck-starter",
      { method: "POST" },
    );
    const res = await handleDeckStarterSetup(req, env);
    expect(res!.status).toBe(500);
    const body = (await res!.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/create failed/);
  });
});
