import { describe, expect, it } from "vitest";
import { handlePreview, type PreviewEnv } from "./preview-route";

const env = { ARTIFACTS: {} as Artifacts } satisfies PreviewEnv;

function req(path: string, init: RequestInit = {}) {
  return new Request(`https://slideofhand.lusostreams.com${path}`, init);
}

function authed(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-access-authenticated-user-email", "tester@example.test");
  return req(path, { ...init, headers });
}

describe("handlePreview", () => {
  it("returns null for non-preview paths", async () => {
    await expect(handlePreview(req("/decks/hello"), env)).resolves.toBeNull();
  });

  it("rejects preview paths without Access auth", async () => {
    const res = await handlePreview(req("/preview/draft/sha/index.html"), env);

    expect(res?.status).toBe(403);
    await expect(res?.json()).resolves.toMatchObject({
      error: expect.stringMatching(/Cloudflare Access/i),
    });
  });

  it("returns the deterministic 501 stub for Access-authenticated preview paths", async () => {
    const res = await handlePreview(
      authed("/preview/draft/sha/index.html"),
      env,
    );

    expect(res?.status).toBe(501);
    await expect(res?.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/not implemented/i),
    });
  });

  it("keeps preview 501 responses no-store", async () => {
    const res = await handlePreview(
      authed("/preview/draft/sha/index.html"),
      env,
    );

    expect(res?.headers.get("cache-control")).toBe("no-store");
  });
});
