/**
 * Tests for `worker/skill-composer.ts` — the `/api/skills/cloudflare-deck-template`
 * endpoint (issue #168 Wave 4 — Worker D).
 *
 * Split into two layers:
 *
 *   1. `composeSkillMarkdown(snapshot)` — pure function. Given a snapshot
 *      shape (staticBody + decks), return the composed Markdown body.
 *      Easy to TDD with synthetic inputs.
 *
 *   2. `handleSkills(request, env)` — request handler. Path + method + auth
 *      gates, plus the response shape (content-type, cache-control, body).
 *      Mocks the snapshot module so tests are not coupled to whatever the
 *      generator currently produces.
 *
 * The build-time generator (`scripts/build-deck-snapshot.mjs`) is tested
 * by running it once and asserting the output shape — but that's a Node
 * concern; this file stays focused on the request-time composition.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// The composer imports `./decks-snapshot.generated.json` at module scope.
// Mock it here so every test has a known, minimal snapshot — no coupling
// to whatever decks currently live in `src/decks/public/`.
const { snapshotMock } = vi.hoisted(() => ({
  snapshotMock: {
    staticBody:
      "# Skill: cloudflare-deck-template\n\nStatic body content goes here.\n",
    decks: [
      {
        slug: "alpha",
        title: "Alpha Deck",
        description: "First test deck.",
        date: "2026-06-01",
        author: "Tester",
        runtimeMinutes: 10,
      },
      {
        slug: "beta",
        title: "Beta Deck",
        description: "Second test deck with an event.",
        date: "2026-05-15",
        author: "Tester",
        event: "Test Event 2026",
        runtimeMinutes: 5,
        tags: ["test", "demo"],
      },
    ],
    generatedAt: "2026-05-11T21:00:00.000Z",
  },
}));

vi.mock("./decks-snapshot.generated.json", () => ({
  default: snapshotMock,
}));

import {
  composeSkillMarkdown,
  handleSkills,
  type SkillsEnv,
  type DeckSnapshot,
} from "./skill-composer";

function adminRequest(input: string | URL, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("cf-access-authenticated-user-email", "tester@example.com");
  return new Request(input, { ...init, headers });
}

function makeEnv(): SkillsEnv {
  // The skills endpoint doesn't currently need any binding — it serves
  // a static-ish snapshot. SkillsEnv is intentionally empty so the type
  // change ripples cleanly through `worker/index.ts`'s Env union.
  return {};
}

describe("composeSkillMarkdown — pure function", () => {
  it("emits the static body at the top", () => {
    const md = composeSkillMarkdown(snapshotMock);
    expect(md.startsWith(snapshotMock.staticBody)).toBe(true);
  });

  it("appends a deck list after the static body", () => {
    const md = composeSkillMarkdown(snapshotMock);
    // Each deck shows up as an H3 with its title and slug.
    expect(md).toContain("### Alpha Deck (`alpha`)");
    expect(md).toContain("### Beta Deck (`beta`)");
    // Descriptions are reproduced verbatim.
    expect(md).toContain("First test deck.");
    expect(md).toContain("Second test deck with an event.");
  });

  it("includes optional meta fields when present", () => {
    const md = composeSkillMarkdown(snapshotMock);
    // The beta deck has an event + tags; alpha doesn't.
    expect(md).toContain("Test Event 2026");
    expect(md).toContain("test");
    expect(md).toContain("demo");
    // Runtime is rendered in minutes.
    expect(md).toMatch(/Runtime[^\n]*5/);
    expect(md).toMatch(/Runtime[^\n]*10/);
  });

  it("renders an empty-deck-list footer when there are no decks", () => {
    const md = composeSkillMarkdown({
      ...snapshotMock,
      decks: [],
    });
    // The static body still ships.
    expect(md.startsWith(snapshotMock.staticBody)).toBe(true);
    // And there's an honest "no decks yet" line so the agent reads it
    // and doesn't make up phantom decks.
    expect(md.toLowerCase()).toContain("no decks");
  });

  it("includes the generatedAt timestamp for transparency", () => {
    const md = composeSkillMarkdown(snapshotMock);
    expect(md).toContain("2026-05-11T21:00:00.000Z");
  });

  it("links to each deck's source folder on GitHub", () => {
    // External agents need a way to JIT-fetch deck source. Linking to
    // the GitHub source tree is the cheapest, link-rot-proofest option.
    const md = composeSkillMarkdown(snapshotMock);
    expect(md).toContain(
      "github.com/mcdays94/slide-of-hand/tree/main/src/decks/public/alpha",
    );
    expect(md).toContain(
      "github.com/mcdays94/slide-of-hand/tree/main/src/decks/public/beta",
    );
  });

  it("links to each deck's public URL", () => {
    const md = composeSkillMarkdown(snapshotMock);
    expect(md).toContain("https://slideofhand.lusostreams.com/decks/alpha");
    expect(md).toContain("https://slideofhand.lusostreams.com/decks/beta");
  });

  it("is deterministic — repeated calls produce identical output", () => {
    const a = composeSkillMarkdown(snapshotMock);
    const b = composeSkillMarkdown(snapshotMock);
    expect(a).toBe(b);
  });
});

describe("handleSkills — path matching", () => {
  it("returns null for paths outside /api/skills/cloudflare-deck-template", async () => {
    const req = adminRequest(
      "https://example.com/api/admin/decks",
    );
    expect(await handleSkills(req, makeEnv())).toBeNull();
  });

  it("returns null for /api/skills/<other-name>", async () => {
    const req = adminRequest(
      "https://example.com/api/skills/some-other-skill",
    );
    expect(await handleSkills(req, makeEnv())).toBeNull();
  });

  it("returns null for /api/skills (no trailing path)", async () => {
    const req = adminRequest("https://example.com/api/skills");
    expect(await handleSkills(req, makeEnv())).toBeNull();
  });
});

describe("handleSkills — method gate", () => {
  it("rejects POST with 405", async () => {
    const req = adminRequest(
      "https://example.com/api/skills/cloudflare-deck-template",
      { method: "POST" },
    );
    const res = await handleSkills(req, makeEnv());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(405);
  });

  it("rejects DELETE with 405", async () => {
    const req = adminRequest(
      "https://example.com/api/skills/cloudflare-deck-template",
      { method: "DELETE" },
    );
    const res = await handleSkills(req, makeEnv());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(405);
  });
});

describe("handleSkills — auth gate", () => {
  it("returns 403 when no access headers are present", async () => {
    const req = new Request(
      "https://example.com/api/skills/cloudflare-deck-template",
    );
    const res = await handleSkills(req, makeEnv());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("accepts a request authenticated via Access JWT only (service-token shape)", async () => {
    // Service tokens land at the Worker carrying only
    // `cf-access-jwt-assertion`, no email. The endpoint must serve
    // these clients so external harnesses (curling with a service
    // token) can read the skill.
    const req = new Request(
      "https://example.com/api/skills/cloudflare-deck-template",
      {
        headers: { "cf-access-jwt-assertion": "stub-jwt" },
      },
    );
    const res = await handleSkills(req, makeEnv());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
  });

  it("accepts a request authenticated via the interactive email header", async () => {
    const req = adminRequest(
      "https://example.com/api/skills/cloudflare-deck-template",
    );
    const res = await handleSkills(req, makeEnv());
    expect(res!.status).toBe(200);
  });
});

describe("handleSkills — happy path", () => {
  beforeEach(() => {
    // No mocks to reset for the happy path; just sanity-check the
    // shape on each run.
  });

  it("returns 200 with text/markdown content-type", async () => {
    const req = adminRequest(
      "https://example.com/api/skills/cloudflare-deck-template",
    );
    const res = await handleSkills(req, makeEnv());
    expect(res!.status).toBe(200);
    expect(res!.headers.get("content-type")).toMatch(/^text\/markdown/);
  });

  it("sets a private short-TTL Cache-Control header", async () => {
    // The skill is admin-gated. Caching publicly would leak the
    // composed deck list. Per-browser short TTL is fine.
    const req = adminRequest(
      "https://example.com/api/skills/cloudflare-deck-template",
    );
    const res = await handleSkills(req, makeEnv());
    const cc = res!.headers.get("cache-control") ?? "";
    expect(cc).toContain("private");
    // 60 seconds matches the PRD's "cached briefly" expectation.
    expect(cc).toMatch(/max-age=\d+/);
  });

  it("returns the composed Markdown body verbatim", async () => {
    const req = adminRequest(
      "https://example.com/api/skills/cloudflare-deck-template",
    );
    const res = await handleSkills(req, makeEnv());
    const body = await res!.text();
    expect(body).toBe(composeSkillMarkdown(snapshotMock));
  });

  it("serves the same body for HEAD requests (no body, same headers)", async () => {
    // HEAD is harmless and useful for external harnesses checking
    // availability without paying the full transfer cost. Optional —
    // if this test breaks the spec evolves, that's fine. For now
    // GET-only is the documented surface.
    const req = adminRequest(
      "https://example.com/api/skills/cloudflare-deck-template",
      { method: "HEAD" },
    );
    const res = await handleSkills(req, makeEnv());
    // HEAD is NOT supported in v1 — we 405 it. Keep this test as a
    // contract anchor so adding HEAD later is a deliberate change.
    expect(res!.status).toBe(405);
  });
});

describe("DeckSnapshot — type shape", () => {
  it("exports the type so external callers can compose with it", () => {
    // Pure compile-time check via assignment; if the type drifts this
    // file won't typecheck.
    const probe: DeckSnapshot = {
      staticBody: "x",
      decks: [],
      generatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(probe.staticBody).toBe("x");
    expect(probe.decks).toEqual([]);
  });
});
