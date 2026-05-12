/**
 * Tests for `worker/artifacts-client.ts` (issue #168 Wave 1 / Worker A).
 *
 * Covers:
 *   - The pure helpers (`draftRepoName`, `stripExpiresSuffix`,
 *     `parseTokenExpiry`, `buildAuthenticatedRemoteUrl`).
 *   - The Artifacts-backed helpers (`forkDeckStarter`,
 *     `forkDeckStarterIdempotent`, `getDraftRepo`, `mintWriteToken`,
 *     `mintReadToken`, `ensureDeckStarterRepo`) against a stubbed
 *     `Artifacts` binding surface.
 *
 * The `Artifacts` type comes from the wrangler-generated
 * `worker-configuration.d.ts`. Tests pass a structurally-compatible
 * stub object cast via `as unknown as Artifacts` — full type fidelity
 * isn't worth the line count for a discriminated-union mock.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  DECK_STARTER_REPO,
  DEFAULT_WRITE_TOKEN_TTL_SECONDS,
  buildAuthenticatedRemoteUrl,
  draftRepoName,
  ensureDeckStarterRepo,
  forkDeckStarter,
  forkDeckStarterIdempotent,
  getDraftRepo,
  isDuplicateNameError,
  mintReadToken,
  mintWriteToken,
  parseTokenExpiry,
  stripExpiresSuffix,
} from "./artifacts-client";

const FAKE_TOKEN_BARE = "art_v1_0123456789abcdef0123456789abcdef01234567";
const FAKE_EXPIRES = 1_800_000_000; // 2027-01-15ish — far enough not to be confused with today
const FAKE_TOKEN_WITH_EXPIRES = `${FAKE_TOKEN_BARE}?expires=${FAKE_EXPIRES}`;
const FAKE_REMOTE =
  "https://1bcef46c.artifacts.cloudflare.net/git/slide-of-hand-drafts/deck-starter.git";

describe("draftRepoName", () => {
  it("concatenates sanitised email and slug with a hyphen", () => {
    expect(draftRepoName("alice@example.com", "my-deck")).toBe(
      "alice-example-com-my-deck",
    );
  });

  it("lowercases input", () => {
    expect(draftRepoName("ALICE@Example.COM", "MyDeck")).toBe(
      "alice-example-com-mydeck",
    );
  });

  it("collapses repeated hyphens", () => {
    expect(draftRepoName("a.b.c@x.com", "foo-bar")).toBe(
      "a-b-c-x-com-foo-bar",
    );
  });

  it("strips leading and trailing hyphens", () => {
    expect(draftRepoName("--alice--@example.com--", "--slug--")).toBe(
      "alice-example-com-slug",
    );
  });

  it("throws on empty email after sanitisation", () => {
    expect(() => draftRepoName("@@@", "deck")).toThrow(/email/i);
  });

  it("throws on empty slug after sanitisation", () => {
    expect(() => draftRepoName("alice@example.com", "$$$")).toThrow(/slug/i);
  });
});

describe("stripExpiresSuffix", () => {
  it("strips the ?expires=N suffix when present", () => {
    expect(stripExpiresSuffix(FAKE_TOKEN_WITH_EXPIRES)).toBe(FAKE_TOKEN_BARE);
  });

  it("returns the token unchanged when no suffix is present", () => {
    expect(stripExpiresSuffix(FAKE_TOKEN_BARE)).toBe(FAKE_TOKEN_BARE);
  });

  it("only strips the first ?expires= occurrence (rare edge case)", () => {
    const odd = `${FAKE_TOKEN_BARE}?expires=1?expires=2`;
    expect(stripExpiresSuffix(odd)).toBe(FAKE_TOKEN_BARE);
  });
});

describe("parseTokenExpiry", () => {
  it("returns the expiry as a Date when present", () => {
    const expected = new Date(FAKE_EXPIRES * 1000);
    expect(parseTokenExpiry(FAKE_TOKEN_WITH_EXPIRES)).toEqual(expected);
  });

  it("returns null when the ?expires= suffix is missing", () => {
    expect(parseTokenExpiry(FAKE_TOKEN_BARE)).toBeNull();
  });

  it("returns null when the suffix value is not numeric", () => {
    expect(parseTokenExpiry(`${FAKE_TOKEN_BARE}?expires=abc`)).toBeNull();
  });

  it("returns null when the suffix value is zero or negative", () => {
    expect(parseTokenExpiry(`${FAKE_TOKEN_BARE}?expires=0`)).toBeNull();
    expect(parseTokenExpiry(`${FAKE_TOKEN_BARE}?expires=-1`)).toBeNull();
  });
});

describe("buildAuthenticatedRemoteUrl", () => {
  it("embeds the stripped token in the URL with placeholder username 'x'", () => {
    const url = buildAuthenticatedRemoteUrl(
      FAKE_REMOTE,
      FAKE_TOKEN_WITH_EXPIRES,
    );
    expect(url).toBe(
      `https://x:${FAKE_TOKEN_BARE}@1bcef46c.artifacts.cloudflare.net/git/slide-of-hand-drafts/deck-starter.git`,
    );
  });

  it("works with a bare token (no expires suffix)", () => {
    const url = buildAuthenticatedRemoteUrl(FAKE_REMOTE, FAKE_TOKEN_BARE);
    expect(url).toContain(`x:${FAKE_TOKEN_BARE}@`);
  });

  it("throws if the remote URL isn't HTTPS", () => {
    expect(() =>
      buildAuthenticatedRemoteUrl(
        "http://artifacts.cloudflare.net/git/x.git",
        FAKE_TOKEN_BARE,
      ),
    ).toThrow(/HTTPS/);
  });
});

// ── Artifacts-backed helpers ─────────────────────────────────────────

/**
 * Build a fluent stubbed Artifacts surface with per-test overrides.
 * Methods default to throwing "not stubbed" so accidental coverage
 * gaps surface as clear failures.
 */
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

function makeRepoStub(overrides: Partial<ArtifactsRepo> = {}): ArtifactsRepo {
  const notStubbed = (method: string) => () => {
    throw new Error(`ArtifactsRepo.${method} not stubbed in this test`);
  };
  return {
    id: "repo-id-default",
    name: "deck-starter",
    description: null,
    remote: FAKE_REMOTE,
    defaultBranch: "main",
    status: "ready",
    createToken: vi.fn(notStubbed("createToken")),
    listTokens: vi.fn(notStubbed("listTokens")),
    revokeToken: vi.fn(notStubbed("revokeToken")),
    fork: vi.fn(notStubbed("fork")),
    ...overrides,
  } as unknown as ArtifactsRepo;
}

describe("forkDeckStarter", () => {
  it("gets the deck-starter handle then forks it with the sanitised name", async () => {
    const forkResult = {
      id: "new-id",
      name: "alice-example-com-my-deck",
      description: null,
      remote: "https://x.artifacts.cloudflare.net/git/.../alice-example-com-my-deck.git",
      defaultBranch: "main",
      status: "ready" as const,
      token: FAKE_TOKEN_WITH_EXPIRES,
    };
    const forkMock = vi.fn().mockResolvedValue(forkResult);
    const starter = makeRepoStub({ fork: forkMock as ArtifactsRepo["fork"] });
    const getMock = vi.fn().mockResolvedValue(starter);
    const artifacts = makeArtifactsStub({
      get: getMock as Artifacts["get"],
    });

    const result = await forkDeckStarter(
      artifacts,
      "alice@example.com",
      "my-deck",
    );
    expect(result).toEqual(forkResult);
    expect(getMock).toHaveBeenCalledWith(DECK_STARTER_REPO);
    expect(forkMock).toHaveBeenCalledWith(
      "alice-example-com-my-deck",
      expect.objectContaining({
        readOnly: false,
        defaultBranchOnly: true,
      }),
    );
  });

  it("includes a default description when none is supplied", async () => {
    const forkMock = vi.fn().mockResolvedValue({
      id: "x",
      name: "alice-my",
      description: null,
      remote: "https://x.artifacts.cloudflare.net/x.git",
      defaultBranch: "main",
      status: "ready",
      token: FAKE_TOKEN_WITH_EXPIRES,
    });
    const starter = makeRepoStub({ fork: forkMock as ArtifactsRepo["fork"] });
    const artifacts = makeArtifactsStub({
      get: vi.fn().mockResolvedValue(starter) as Artifacts["get"],
    });
    await forkDeckStarter(artifacts, "alice@example.com", "my");
    const [, opts] = forkMock.mock.calls[0];
    expect(opts.description).toMatch(/Draft deck/i);
  });

  it("forwards a custom description when supplied", async () => {
    const forkMock = vi.fn().mockResolvedValue({
      id: "x",
      name: "alice-my",
      description: null,
      remote: "https://x.artifacts.cloudflare.net/x.git",
      defaultBranch: "main",
      status: "ready",
      token: FAKE_TOKEN_WITH_EXPIRES,
    });
    const starter = makeRepoStub({ fork: forkMock as ArtifactsRepo["fork"] });
    const artifacts = makeArtifactsStub({
      get: vi.fn().mockResolvedValue(starter) as Artifacts["get"],
    });
    await forkDeckStarter(artifacts, "alice@example.com", "my", {
      description: "custom description",
    });
    expect(forkMock).toHaveBeenCalledWith(
      "alice-example-com-my",
      expect.objectContaining({ description: "custom description" }),
    );
  });

  // Duplicate-name recovery (post-#179 production fix). The Artifacts
  // beta sometimes surfaces a generic "An internal error occurred"
  // on a fork that actually succeeded; the model's auto-retry then
  // trips a "repo already exists" error. forkDeckStarter recovers by
  // fetching a handle for the existing repo + minting a fresh write
  // token, returning the same shape as a successful fork.
  it("recovers from 'repo already exists' by fetching the existing repo + minting a write token", async () => {
    const existingRepo = makeRepoStub({
      id: "existing-id",
      name: "alice-example-com-my-deck",
      description: null,
      defaultBranch: "main",
      remote: FAKE_REMOTE,
    });
    const freshToken = {
      id: "tok-2",
      plaintext: FAKE_TOKEN_WITH_EXPIRES,
      scope: "write" as const,
      expiresAt: "2027-01-15T00:00:00.000Z",
    };
    existingRepo.createToken = vi
      .fn()
      .mockResolvedValue(freshToken) as ArtifactsRepo["createToken"];

    // Starter handle: fork throws with "already exists" the FIRST
    // (and only) time. The recovery path then calls artifacts.get
    // for the existing repo.
    const forkMock = vi
      .fn()
      .mockRejectedValue(
        new Error("repo already exists: alice-example-com-my-deck"),
      );
    const starter = makeRepoStub({
      fork: forkMock as ArtifactsRepo["fork"],
    });
    const getMock = vi
      .fn()
      // First call: deck-starter (to fork from).
      .mockResolvedValueOnce(starter)
      // Second call: the existing duplicate (recovery path).
      .mockResolvedValueOnce(existingRepo);
    const artifacts = makeArtifactsStub({
      get: getMock as Artifacts["get"],
    });

    const result = await forkDeckStarter(
      artifacts,
      "alice@example.com",
      "my-deck",
    );
    expect(result.id).toBe("existing-id");
    expect(result.name).toBe("alice-example-com-my-deck");
    expect(result.remote).toBe(FAKE_REMOTE);
    expect(result.token).toBe(FAKE_TOKEN_WITH_EXPIRES);
    expect(result.tokenExpiresAt).toBe("2027-01-15T00:00:00.000Z");
    // Verify we DID call artifacts.get twice — once for starter,
    // once for the existing duplicate — and createToken on the
    // recovered repo.
    expect(getMock).toHaveBeenNthCalledWith(1, DECK_STARTER_REPO);
    expect(getMock).toHaveBeenNthCalledWith(2, "alice-example-com-my-deck");
    expect(existingRepo.createToken).toHaveBeenCalled();
  });

  it("recovers from a generic 'internal error occurred' if the message hints at duplication", async () => {
    // We don't auto-recover from EVERY internal error (false-positive
    // cost = wasted getDraftRepo call which throws). But the
    // matcher is generous about 'duplicate'/'conflict' phrasing —
    // the Artifacts beta has been observed to use 'already exists'
    // in some 5xx responses too. This test pins the broader-match
    // behaviour against drift.
    const existingRepo = makeRepoStub({
      id: "x",
      name: "alice-my",
      remote: FAKE_REMOTE,
    });
    existingRepo.createToken = vi.fn().mockResolvedValue({
      id: "t",
      plaintext: FAKE_TOKEN_WITH_EXPIRES,
      scope: "write",
      expiresAt: "2027-01-15T00:00:00.000Z",
    }) as ArtifactsRepo["createToken"];
    const starter = makeRepoStub({
      fork: vi
        .fn()
        .mockRejectedValue(
          new Error("ArtifactsError: conflict — name already exists"),
        ) as ArtifactsRepo["fork"],
    });
    const artifacts = makeArtifactsStub({
      get: vi
        .fn()
        .mockResolvedValueOnce(starter)
        .mockResolvedValueOnce(existingRepo) as Artifacts["get"],
    });

    const result = await forkDeckStarter(artifacts, "alice@example.com", "my");
    expect(result.remote).toBe(FAKE_REMOTE);
  });

  it("rethrows non-duplicate errors unchanged", async () => {
    // Quota errors, auth errors, etc. must NOT be silently swallowed
    // by the recovery path — only the duplicate-name case is
    // recoverable. We verify by asserting the original error
    // bubbles up.
    const starter = makeRepoStub({
      fork: vi
        .fn()
        .mockRejectedValue(
          new Error("ArtifactsError: quota exceeded"),
        ) as ArtifactsRepo["fork"],
    });
    const getMock = vi.fn().mockResolvedValue(starter);
    const artifacts = makeArtifactsStub({ get: getMock as Artifacts["get"] });

    await expect(
      forkDeckStarter(artifacts, "alice@example.com", "my"),
    ).rejects.toThrow(/quota exceeded/);
    // No recovery attempt — get called once for the starter only.
    expect(getMock).toHaveBeenCalledTimes(1);
  });
});

describe("isDuplicateNameError", () => {
  it("matches 'already exists' (case-insensitive)", () => {
    expect(isDuplicateNameError(new Error("repo already exists: foo"))).toBe(
      true,
    );
    expect(isDuplicateNameError(new Error("REPO ALREADY EXISTS"))).toBe(true);
    expect(isDuplicateNameError(new Error("Already Exists"))).toBe(true);
  });

  it("matches 'duplicate' phrasing", () => {
    expect(isDuplicateNameError(new Error("duplicate name"))).toBe(true);
    expect(isDuplicateNameError(new Error("Duplicate repository"))).toBe(true);
  });

  it("matches 'conflict' phrasing", () => {
    expect(isDuplicateNameError(new Error("name conflict"))).toBe(true);
    expect(isDuplicateNameError(new Error("HTTP 409 Conflict"))).toBe(true);
  });

  it("does NOT match unrelated error phrasing", () => {
    // The matcher must be specific enough that ordinary errors
    // don't trip the recovery path.
    expect(isDuplicateNameError(new Error("quota exceeded"))).toBe(false);
    expect(isDuplicateNameError(new Error("unauthorized"))).toBe(false);
    expect(isDuplicateNameError(new Error("network timeout"))).toBe(false);
    expect(isDuplicateNameError(new Error("An internal error occurred"))).toBe(
      false,
    );
  });

  it("handles non-Error inputs gracefully (defensive against thrown strings)", () => {
    expect(isDuplicateNameError("repo already exists")).toBe(true);
    expect(isDuplicateNameError(null)).toBe(false);
    expect(isDuplicateNameError(undefined)).toBe(false);
    // Plain objects fall through to `String(err) = "[object Object]"`
    // — which does NOT match. We don't fish into arbitrary
    // `message` properties because we have no contract on shape.
    expect(isDuplicateNameError({ message: "already exists" })).toBe(false);
  });
});

describe("forkDeckStarterIdempotent", () => {
  it("returns kind:existed + a fresh write token when the fork already exists", async () => {
    const existingFork = makeRepoStub({
      name: "alice-my",
      remote: FAKE_REMOTE,
    });
    const freshToken = {
      plaintext: FAKE_TOKEN_WITH_EXPIRES,
      expiresAt: "2027-01-15T00:00:00.000Z",
    };
    existingFork.createToken = vi
      .fn()
      .mockResolvedValue(freshToken) as ArtifactsRepo["createToken"];
    const artifacts = makeArtifactsStub({
      get: vi.fn().mockResolvedValue(existingFork) as Artifacts["get"],
    });

    const result = await forkDeckStarterIdempotent(
      artifacts,
      "alice@example.com",
      "my",
    );
    expect(result.kind).toBe("existed");
    if (result.kind === "existed") {
      expect(result.repo).toBe(existingFork);
      expect(result.freshWriteToken).toEqual(freshToken);
    }
  });

  it("returns kind:created when the fork did not exist yet", async () => {
    const forkResult = {
      id: "new-id",
      name: "alice-my",
      description: null,
      remote: "https://x.artifacts.cloudflare.net/x.git",
      defaultBranch: "main",
      status: "ready" as const,
      token: FAKE_TOKEN_WITH_EXPIRES,
    };
    const starter = makeRepoStub({
      fork: vi.fn().mockResolvedValue(forkResult) as ArtifactsRepo["fork"],
    });
    const getMock = vi
      .fn()
      // First call: lookup of the fork → throws (not found).
      .mockRejectedValueOnce(new Error("repo not found"))
      // Second call: lookup of the starter to fork from → resolves.
      .mockResolvedValueOnce(starter);
    const artifacts = makeArtifactsStub({ get: getMock as Artifacts["get"] });

    const result = await forkDeckStarterIdempotent(
      artifacts,
      "alice@example.com",
      "my",
    );
    expect(result.kind).toBe("created");
    if (result.kind === "created") {
      expect(result.result).toEqual(forkResult);
    }
    expect(getMock).toHaveBeenCalledTimes(2);
  });
});

describe("getDraftRepo", () => {
  it("looks up the repo by sanitised draftRepoName", async () => {
    const repo = makeRepoStub({ name: "alice-my" });
    const getMock = vi.fn().mockResolvedValue(repo);
    const artifacts = makeArtifactsStub({ get: getMock as Artifacts["get"] });
    const result = await getDraftRepo(artifacts, "alice@example.com", "my");
    expect(result).toBe(repo);
    expect(getMock).toHaveBeenCalledWith("alice-example-com-my");
  });
});

describe("mintWriteToken / mintReadToken", () => {
  it("mints a write-scoped token with the default TTL", async () => {
    const createTokenMock = vi.fn().mockResolvedValue({
      plaintext: FAKE_TOKEN_WITH_EXPIRES,
      expiresAt: "2027-01-15T00:00:00Z",
    });
    const repo = makeRepoStub({
      createToken: createTokenMock as ArtifactsRepo["createToken"],
    });
    await mintWriteToken(repo);
    expect(createTokenMock).toHaveBeenCalledWith(
      "write",
      DEFAULT_WRITE_TOKEN_TTL_SECONDS,
    );
  });

  it("accepts an explicit TTL", async () => {
    const createTokenMock = vi.fn().mockResolvedValue({
      plaintext: FAKE_TOKEN_WITH_EXPIRES,
      expiresAt: "2027-01-15T00:00:00Z",
    });
    const repo = makeRepoStub({
      createToken: createTokenMock as ArtifactsRepo["createToken"],
    });
    await mintWriteToken(repo, 600);
    expect(createTokenMock).toHaveBeenCalledWith("write", 600);
  });

  it("mintReadToken mints a read-scoped token", async () => {
    const createTokenMock = vi.fn().mockResolvedValue({
      plaintext: FAKE_TOKEN_WITH_EXPIRES,
      expiresAt: "2027-01-15T00:00:00Z",
    });
    const repo = makeRepoStub({
      createToken: createTokenMock as ArtifactsRepo["createToken"],
    });
    await mintReadToken(repo);
    expect(createTokenMock).toHaveBeenCalledWith(
      "read",
      DEFAULT_WRITE_TOKEN_TTL_SECONDS,
    );
  });
});

describe("ensureDeckStarterRepo", () => {
  beforeEach(() => {
    // Silence the info log when the test exercises the "not found"
    // path — keeps the test output clean.
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("returns kind:existed when the baseline already exists", async () => {
    const baseline = makeRepoStub({ name: DECK_STARTER_REPO });
    const artifacts = makeArtifactsStub({
      get: vi.fn().mockResolvedValue(baseline) as Artifacts["get"],
    });
    const result = await ensureDeckStarterRepo(artifacts);
    expect(result.kind).toBe("existed");
    if (result.kind === "existed") {
      expect(result.repo).toBe(baseline);
    }
  });

  it("creates the baseline when get() throws", async () => {
    const created = {
      id: "starter-id",
      name: DECK_STARTER_REPO,
      description: "Baseline...",
      remote: FAKE_REMOTE,
      defaultBranch: "main",
      status: "ready" as const,
      token: FAKE_TOKEN_WITH_EXPIRES,
    };
    const artifacts = makeArtifactsStub({
      get: vi.fn().mockRejectedValue(new Error("not found")) as Artifacts["get"],
      create: vi.fn().mockResolvedValue(created) as Artifacts["create"],
    });
    const result = await ensureDeckStarterRepo(artifacts);
    expect(result.kind).toBe("created");
    if (result.kind === "created") {
      expect(result.result).toEqual(created);
    }
  });

  it("passes a default description when none is supplied", async () => {
    const createMock = vi.fn().mockResolvedValue({
      id: "x",
      name: DECK_STARTER_REPO,
      description: null,
      remote: FAKE_REMOTE,
      defaultBranch: "main",
      status: "ready",
      token: FAKE_TOKEN_WITH_EXPIRES,
    });
    const artifacts = makeArtifactsStub({
      get: vi.fn().mockRejectedValue(new Error("nf")) as Artifacts["get"],
      create: createMock as Artifacts["create"],
    });
    await ensureDeckStarterRepo(artifacts);
    const [name, opts] = createMock.mock.calls[0];
    expect(name).toBe(DECK_STARTER_REPO);
    expect(opts).toEqual(
      expect.objectContaining({
        readOnly: false,
        setDefaultBranch: "main",
      }),
    );
    expect(opts.description).toMatch(/Baseline/i);
  });
});
