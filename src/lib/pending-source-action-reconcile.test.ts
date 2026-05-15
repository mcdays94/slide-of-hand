/**
 * Tests for the pure reconciliation helpers (issue #250 / PRD #242).
 *
 * Two functions under test:
 *
 *   - `sourceStateForSlug` — collapses the merged admin entry list
 *     into one of three deployed-source states for a given slug.
 *   - `shouldReconcile` — returns true iff the source state matches
 *     the pending action's expected state.
 *
 * No I/O, no Worker, no hook. Reconciliation policy lives here and
 * gets exercised by the worker + admin tests via the higher layers.
 */
import { describe, expect, it } from "vitest";
import {
  sourceStateForSlug,
  shouldReconcile,
  type ReconcileRegistryEntry,
} from "./pending-source-action-reconcile";
import type { PendingSourceAction } from "./pending-source-actions";

function sourceEntry(slug: string, archived = false): ReconcileRegistryEntry {
  return {
    meta: { slug, archived: archived ? true : undefined },
    source: "source",
  };
}

function kvEntry(slug: string, archived = false): ReconcileRegistryEntry {
  return {
    meta: { slug, archived: archived ? true : undefined },
    source: "kv",
  };
}

function pending(
  expectedState: PendingSourceAction["expectedState"],
): Pick<PendingSourceAction, "expectedState"> {
  return { expectedState };
}

describe("sourceStateForSlug", () => {
  it('returns "active" for a source entry without meta.archived', () => {
    const entries = [sourceEntry("hello"), sourceEntry("world", true)];
    expect(sourceStateForSlug("hello", entries)).toBe("active");
  });

  it('returns "archived" for a source entry with meta.archived === true', () => {
    const entries = [sourceEntry("hello"), sourceEntry("world", true)];
    expect(sourceStateForSlug("world", entries)).toBe("archived");
  });

  it('returns "deleted" when the slug is absent from the entry list', () => {
    const entries = [sourceEntry("hello"), sourceEntry("world", true)];
    expect(sourceStateForSlug("missing", entries)).toBe("deleted");
  });

  it('returns "deleted" for a KV-only entry (source folder is gone)', () => {
    // A KV entry alone cannot satisfy a pending SOURCE action — from
    // the source-repo perspective the slug is deleted.
    const entries = [kvEntry("hello")];
    expect(sourceStateForSlug("hello", entries)).toBe("deleted");
  });

  it("defaults missing source field to source (back-compat with older fixtures)", () => {
    const entries: ReconcileRegistryEntry[] = [
      { meta: { slug: "hello" } },
    ];
    expect(sourceStateForSlug("hello", entries)).toBe("active");
  });

  it("treats an empty entry list as all-deleted", () => {
    expect(sourceStateForSlug("anything", [])).toBe("deleted");
  });
});

describe("shouldReconcile", () => {
  it("pending archive + source archived => true", () => {
    expect(shouldReconcile(pending("archived"), "archived")).toBe(true);
  });

  it("pending archive + source active => false", () => {
    expect(shouldReconcile(pending("archived"), "active")).toBe(false);
  });

  it("pending archive + source deleted => false", () => {
    // The PR opens an archive but the deck has gone missing — don't
    // touch the marker; the admin author needs to notice + clear.
    expect(shouldReconcile(pending("archived"), "deleted")).toBe(false);
  });

  it("pending restore + source active => true", () => {
    expect(shouldReconcile(pending("active"), "active")).toBe(true);
  });

  it("pending restore + source archived => false", () => {
    expect(shouldReconcile(pending("active"), "archived")).toBe(false);
  });

  it("pending delete + source deleted => true", () => {
    expect(shouldReconcile(pending("deleted"), "deleted")).toBe(true);
  });

  it("pending delete + source active => false", () => {
    expect(shouldReconcile(pending("deleted"), "active")).toBe(false);
  });

  it("pending delete + source archived => false", () => {
    expect(shouldReconcile(pending("deleted"), "archived")).toBe(false);
  });
});
