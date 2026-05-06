/**
 * `useDeckBroadcast` round-trip tests, with a mock `BroadcastChannel`.
 *
 * happy-dom doesn't ship a `BroadcastChannel` polyfill; we install our own
 * intra-process bus that supports multiple instances bound to the same
 * channel name (mirroring the real spec's same-origin fan-out).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { BroadcastMessage } from "@/framework/viewer/types";
import { deckChannelName, useDeckBroadcast } from "./broadcast";

interface BCInstance {
  name: string;
  onmessage: ((e: { data: unknown }) => void) | null;
  onmessageerror: (() => void) | null;
  closed: boolean;
}

let bus: Map<string, Set<BCInstance>>;

class MockBroadcastChannel {
  name: string;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  closed = false;
  private _self: BCInstance;

  constructor(name: string) {
    this.name = name;
    this._self = this as unknown as BCInstance;
    let peers = bus.get(name);
    if (!peers) {
      peers = new Set();
      bus.set(name, peers);
    }
    peers.add(this._self);
  }

  postMessage(data: unknown) {
    if (this.closed) return;
    const peers = bus.get(this.name);
    if (!peers) return;
    for (const peer of peers) {
      if (peer === this._self || peer.closed) continue;
      peer.onmessage?.({ data });
    }
  }

  close() {
    this.closed = true;
    const peers = bus.get(this.name);
    peers?.delete(this._self);
  }
}

beforeEach(() => {
  bus = new Map();
  // @ts-expect-error — install a lab-quality polyfill on the global.
  globalThis.BroadcastChannel = MockBroadcastChannel;
});

afterEach(() => {
  // @ts-expect-error — teardown.
  delete globalThis.BroadcastChannel;
  vi.restoreAllMocks();
});

describe("deckChannelName", () => {
  it("uses the canonical slide-of-hand-deck-<slug> prefix", () => {
    expect(deckChannelName("hello")).toBe("slide-of-hand-deck-hello");
  });
});

describe("useDeckBroadcast", () => {
  it("delivers messages from one hook to another on the same channel", () => {
    const received: BroadcastMessage[] = [];
    const a = renderHook(() => useDeckBroadcast("hello"));
    const b = renderHook(() =>
      useDeckBroadcast("hello", (msg) => received.push(msg)),
    );

    act(() => {
      a.result.current.send({
        type: "state",
        slide: 2,
        phase: 1,
        deckSlug: "hello",
      });
    });

    expect(received).toEqual([
      { type: "state", slide: 2, phase: 1, deckSlug: "hello" },
    ]);
    a.unmount();
    b.unmount();
  });

  it("does not deliver to senders on the same channel (no echo)", () => {
    const received: BroadcastMessage[] = [];
    const a = renderHook(() =>
      useDeckBroadcast("hello", (msg) => received.push(msg)),
    );

    act(() => {
      a.result.current.send({ type: "request-state" });
    });

    expect(received).toEqual([]);
    a.unmount();
  });

  it("isolates channels by deck slug", () => {
    const aReceived: BroadcastMessage[] = [];
    const bReceived: BroadcastMessage[] = [];
    const a = renderHook(() =>
      useDeckBroadcast("alpha", (msg) => aReceived.push(msg)),
    );
    const b = renderHook(() =>
      useDeckBroadcast("beta", (msg) => bReceived.push(msg)),
    );

    act(() => {
      a.result.current.send({ type: "request-state" });
      b.result.current.send({ type: "request-state" });
    });

    // No cross-talk: each hook only hears the OTHER hook on its own channel.
    // Both senders post to themselves which doesn't echo, and neither reaches
    // the other's channel.
    expect(aReceived).toEqual([]);
    expect(bReceived).toEqual([]);
    a.unmount();
    b.unmount();
  });

  it("disconnects on unmount so a second send is silent", () => {
    const received: BroadcastMessage[] = [];
    const listener = renderHook(() =>
      useDeckBroadcast("hello", (msg) => received.push(msg)),
    );
    const sender = renderHook(() => useDeckBroadcast("hello"));

    listener.unmount();
    act(() => {
      sender.result.current.send({ type: "request-state" });
    });
    expect(received).toEqual([]);
    sender.unmount();
  });

  it("send() is a no-op before the channel opens (e.g. during SSR)", () => {
    // @ts-expect-error — simulate SSR by removing BC.
    delete globalThis.BroadcastChannel;
    const a = renderHook(() => useDeckBroadcast("hello"));
    expect(() =>
      a.result.current.send({ type: "request-state" }),
    ).not.toThrow();
    a.unmount();
  });
});
