/**
 * Cross-window state sync via `BroadcastChannel`.
 *
 * The viewer and presenter window agree on a single channel name per deck:
 *   `slide-of-hand-deck-<slug>`
 *
 * Either side can post a `BroadcastMessage` and receive messages from the
 * other. The hook owns one channel per `deckSlug`, exposes a stable `send`
 * function via callback ref, and reconnects automatically if the channel
 * errors. SSR-safe: when `BroadcastChannel` is undefined, `send` is a no-op
 * and no listener is attached.
 *
 * The hook intentionally does NOT include any deck-specific business logic
 * (no slide/phase reasoning, no notion of "presenter" vs "viewer"). Both
 * sides use it identically; they just send/receive different message types.
 */
import { useCallback, useEffect, useRef } from "react";
import type { BroadcastMessage } from "@/framework/viewer/types";

/** Stable channel name for a given deck slug. */
export function deckChannelName(slug: string): string {
  return `slide-of-hand-deck-${slug}`;
}

export interface DeckBroadcast {
  /** Post a message to the channel. No-op if the channel isn't open yet. */
  send: (msg: BroadcastMessage) => void;
}

/**
 * Open a `BroadcastChannel` scoped to a single deck, optionally subscribing
 * to incoming messages. The `onMessage` callback is captured via ref so it
 * can change between renders without closing/reopening the channel.
 *
 * Reconnection: if the channel emits `messageerror` (rare but possible —
 * usually a structured-clone failure on the other side), we close and
 * reopen on the next tick so subsequent posts continue to work.
 */
export function useDeckBroadcast(
  deckSlug: string,
  onMessage?: (msg: BroadcastMessage) => void,
): DeckBroadcast {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let channel: BroadcastChannel | null = null;

    const open = () => {
      if (cancelled) return;
      channel = new BroadcastChannel(deckChannelName(deckSlug));
      channelRef.current = channel;
      channel.onmessage = (e: MessageEvent) => {
        onMessageRef.current?.(e.data as BroadcastMessage);
      };
      channel.onmessageerror = () => {
        // Structured-clone failure — drop and reconnect.
        try {
          channel?.close();
        } catch {
          /* no-op */
        }
        channelRef.current = null;
        channel = null;
        reconnectTimer = setTimeout(open, 50);
      };
    };

    open();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        channel?.close();
      } catch {
        /* no-op */
      }
      channelRef.current = null;
    };
  }, [deckSlug]);

  const send = useCallback((msg: BroadcastMessage) => {
    try {
      channelRef.current?.postMessage(msg);
    } catch {
      /* channel may have closed mid-send; the next reconnect cycle handles it */
    }
  }, []);

  return { send };
}
