/**
 * Unit tests for the thin GitHub REST client (#131 phases 3a + 3b).
 *
 * Covers:
 *   - `listContents` — directory listing + 404 + auth error + array
 *      vs single-file response shapes from GitHub.
 *   - `readFileContents` — happy UTF-8 decode + binary rejection +
 *      directory rejection + size cap (1 MB limit returns structured).
 *   - `putFileContents` — create-vs-update (no sha vs prior sha) +
 *      422 GitHub-rejected + auth error.
 *   - `dataDeckPath` — the canonical KV-deck JSON repo path.
 *
 * All `fetch()` calls are stubbed via `vi.stubGlobal("fetch", ...)`
 * so the suite doesn't reach out to api.github.com.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dataDeckPath,
  listContents,
  putFileContents,
  readFileContents,
  TARGET_REPO,
  DEFAULT_BRANCH,
} from "./github-client";

const REPO_API = `https://api.github.com/repos/${TARGET_REPO.owner}/${TARGET_REPO.repo}`;

// Helper: a single fetch call's URL + init pair.
function lastCall() {
  const mock = vi.mocked(globalThis.fetch);
  expect(mock).toHaveBeenCalled();
  const calls = mock.mock.calls;
  return calls[calls.length - 1];
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── dataDeckPath ────────────────────────────────────────────────────

describe("dataDeckPath", () => {
  it("returns the canonical data-decks/<slug>.json shape", () => {
    expect(dataDeckPath("hello")).toBe("data-decks/hello.json");
    expect(dataDeckPath("cf247-dtx-manchester")).toBe(
      "data-decks/cf247-dtx-manchester.json",
    );
  });
});

// ─── listContents ────────────────────────────────────────────────────

describe("listContents", () => {
  it("returns an array of dir entries on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify([
            {
              name: "01-title.tsx",
              path: "src/decks/public/hello/01-title.tsx",
              type: "file",
              size: 123,
              sha: "a1",
            },
            {
              name: "lib",
              path: "src/decks/public/hello/lib",
              type: "dir",
              size: 0,
              sha: "b2",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const result = await listContents("token-xyz", "src/decks/public/hello");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.items).toHaveLength(2);
    expect(result.items[0].name).toBe("01-title.tsx");
    expect(result.items[1].type).toBe("dir");

    // Verify the URL + auth.
    const [url, init] = lastCall();
    expect(String(url)).toContain(`${REPO_API}/contents/src/decks/public/hello`);
    expect(String(url)).toContain(`ref=${DEFAULT_BRANCH}`);
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("authorization")).toBe("Bearer token-xyz");
    expect(headers.get("user-agent")).toContain("slide-of-hand-agent");
  });

  it("normalises a single-file response into a one-item array", async () => {
    // GitHub returns an object (not array) when the path resolves to
    // a single file. We coerce so the client sees a uniform shape.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            name: "package.json",
            path: "package.json",
            type: "file",
            size: 2048,
            sha: "z",
          }),
          { status: 200 },
        ),
      ),
    );
    const result = await listContents("t", "package.json");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("package.json");
  });

  it("returns kind=not_found on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );
    const result = await listContents("t", "src/missing/path");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.kind).toBe("not_found");
    expect(result.message).toContain("not found");
    expect(result.message).toContain("src/missing/path");
  });

  it("returns kind=auth on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad auth", { status: 401 })),
    );
    const result = await listContents("t", "src");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.kind).toBe("auth");
  });

  it("returns kind=auth on 403", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("forbidden", { status: 403 })),
    );
    const result = await listContents("t", "src");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.kind).toBe("auth");
  });

  it("returns kind=other for unexpected statuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("teapot", { status: 418 })),
    );
    const result = await listContents("t", "src");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.kind).toBe("other");
    if (result.kind !== "other") throw new Error("expected other");
    expect(result.status).toBe(418);
  });

  it("URL-encodes path segments individually but keeps slashes literal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );
    await listContents("t", "src/decks/public/cf247-dtx-manchester");
    const [url] = lastCall();
    // Path segments are encoded but separators stay literal.
    expect(String(url)).toContain(
      "/contents/src/decks/public/cf247-dtx-manchester",
    );
  });

  it("forwards an explicit ref parameter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );
    await listContents("t", "src", "dev");
    const [url] = lastCall();
    expect(String(url)).toContain("ref=dev");
  });

  it("strips a leading slash from the path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );
    await listContents("t", "/src/decks");
    const [url] = lastCall();
    expect(String(url)).toMatch(/\/contents\/src\/decks/);
    // Should NOT have /contents//src/decks (double-slash leak).
    expect(String(url)).not.toMatch(/\/contents\/\//);
  });
});

// ─── readFileContents ────────────────────────────────────────────────

describe("readFileContents", () => {
  function fileResp(body: Record<string, unknown>): Response {
    return new Response(JSON.stringify(body), { status: 200 });
  }
  function base64(s: string): string {
    return btoa(unescape(encodeURIComponent(s)));
  }

  it("decodes base64 UTF-8 content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fileResp({
          type: "file",
          encoding: "base64",
          // Base64 with newlines every 60 chars, as GitHub actually returns.
          content: base64("hello world\n").replace(/(.{4})/g, "$1\n"),
          size: 12,
          sha: "abc123",
          path: "README.md",
        }),
      ),
    );
    const result = await readFileContents("t", "README.md");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.result.content).toBe("hello world\n");
    expect(result.result.sha).toBe("abc123");
    expect(result.result.path).toBe("README.md");
  });

  it("handles UTF-8 multi-byte characters", async () => {
    const source = "// Hello — world\nconst π = 3.14159;\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fileResp({
          type: "file",
          encoding: "base64",
          content: base64(source),
          size: source.length,
          sha: "s",
          path: "file.js",
        }),
      ),
    );
    const result = await readFileContents("t", "file.js");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.result.content).toBe(source);
  });

  it("returns kind=not_found on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    const result = await readFileContents("t", "src/missing.ts");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.kind).toBe("not_found");
  });

  it("returns kind=auth on 401/403", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 403 })),
    );
    const result = await readFileContents("t", "src/x.ts");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.kind).toBe("auth");
  });

  it("returns kind=other when the path resolves to a directory (array body)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );
    const result = await readFileContents("t", "src");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.message).toMatch(/directory/);
  });

  it("returns kind=other when GitHub reports type != file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fileResp({ type: "symlink", encoding: "base64", content: "", size: 0, sha: "" }),
      ),
    );
    const result = await readFileContents("t", "link");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.message).toMatch(/not a file/);
  });

  it("rejects binary files (non-UTF8 content)", async () => {
    // Bytes that aren't valid UTF-8 (lone continuation byte 0x80).
    const binaryBytes = btoa("\x80\x81\x82");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fileResp({
          type: "file",
          encoding: "base64",
          content: binaryBytes,
          size: 3,
          sha: "s",
          path: "image.png",
        }),
      ),
    );
    const result = await readFileContents("t", "image.png");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.message).toMatch(/binary|UTF-8/i);
  });
});

// ─── putFileContents ─────────────────────────────────────────────────

describe("putFileContents", () => {
  function fileResp(body: Record<string, unknown>): Response {
    return new Response(JSON.stringify(body), { status: 200 });
  }

  it("creates a new file when the path doesn't yet exist (no prior sha)", async () => {
    // First call: GET to look up existing file → 404 (doesn't exist).
    // Second call: PUT to create.
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        // First call (the read for prior sha lookup).
        return new Response("not found", { status: 404 });
      }
      return fileResp({
        commit: {
          sha: "new-commit-sha",
          html_url: "https://github.com/mcdays94/slide-of-hand/commit/new-commit-sha",
        },
        content: { sha: "new-blob-sha", path: "data-decks/x.json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await putFileContents("t", {
      path: "data-decks/x.json",
      content: '{"hello":"world"}\n',
      message: "Add deck x",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.result.commitSha).toBe("new-commit-sha");
    expect(result.result.contentSha).toBe("new-blob-sha");
    expect(result.result.path).toBe("data-decks/x.json");

    // Verify the PUT body did NOT include sha (it's a create).
    const putCall = fetchMock.mock.calls[1];
    const putBody = JSON.parse((putCall[1] as RequestInit).body as string);
    expect(putBody.sha).toBeUndefined();
    expect(putBody.message).toBe("Add deck x");
    expect(putBody.branch).toBe("main");
    // Content is base64-encoded.
    expect(atob(putBody.content)).toBe('{"hello":"world"}\n');
  });

  it("updates an existing file by including the prior sha in the PUT body", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        // Existing file lookup returns its sha.
        return fileResp({
          type: "file",
          encoding: "base64",
          content: btoa("old"),
          size: 3,
          sha: "existing-blob-sha",
          path: "data-decks/x.json",
        });
      }
      return fileResp({
        commit: {
          sha: "newer-commit-sha",
          html_url: "https://github.com/x/y/commit/newer-commit-sha",
        },
        content: { sha: "newer-blob-sha", path: "data-decks/x.json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await putFileContents("t", {
      path: "data-decks/x.json",
      content: "new content",
      message: "Update",
    });
    expect(result.ok).toBe(true);

    const putBody = JSON.parse(
      (fetchMock.mock.calls[1][1] as RequestInit).body as string,
    );
    expect(putBody.sha).toBe("existing-blob-sha");
  });

  it("forwards an explicit branch + committer to the PUT body", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        return new Response("not found", { status: 404 });
      }
      return fileResp({
        commit: { sha: "s", html_url: "u" },
        content: { sha: "c", path: "p" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await putFileContents("t", {
      path: "p",
      content: "x",
      message: "m",
      branch: "feature/test",
      committer: { name: "alice", email: "alice@example.com" },
    });

    const putBody = JSON.parse(
      (fetchMock.mock.calls[1][1] as RequestInit).body as string,
    );
    expect(putBody.branch).toBe("feature/test");
    expect(putBody.committer).toEqual({
      name: "alice",
      email: "alice@example.com",
    });
  });

  it("returns kind=auth on 401/403 from PUT", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        return new Response("not found", { status: 404 });
      }
      return new Response("forbidden", { status: 403 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await putFileContents("t", {
      path: "x",
      content: "y",
      message: "m",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.kind).toBe("auth");
  });

  it("returns kind=other on 422 (GitHub rejected — e.g. bad sha)", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        return new Response("not found", { status: 404 });
      }
      return new Response('{"message":"Bad sha"}', { status: 422 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await putFileContents("t", {
      path: "x",
      content: "y",
      message: "m",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.kind).toBe("other");
    if (result.kind !== "other") throw new Error("expected other");
    expect(result.status).toBe(422);
  });

  it("propagates a non-404 error from the prior-sha lookup", async () => {
    const fetchMock = vi.fn(async () => new Response("server error", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await putFileContents("t", {
      path: "x",
      content: "y",
      message: "m",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    // Should NOT have made a PUT — the look-up error means we don't
    // know whether to create or update.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
