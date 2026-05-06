/**
 * P-key listener + presenter-window orchestrator for the MAIN viewer.
 *
 * Mounted by `<PresenterAffordances />` whenever presenter mode is on. It:
 *
 *   - listens for the `P` key and `window.open()`s a sibling tab pointed at
 *     `/decks/<slug>?presenter=1`, where the deck route swaps in
 *     `<PresenterWindow />` instead of the live `<Deck />`;
 *   - broadcasts the current cursor whenever the slide-shell DOM updates,
 *     so the presenter window stays in sync with the main viewer;
 *   - handles `navigate` requests from the presenter window by dispatching
 *     synthetic Arrow keydowns until the cursor matches the requested
 *     target. Slow path, but the deck reducer is the only public API and
 *     Arrow keys are how `<Deck>` already accepts navigation.
 *
 * Why DOM observation instead of a hook: we cannot edit `<Deck>` from this
 * slice (orchestrator constraint), so the trigger reads cursor state from
 * the `data-slide-index` / `data-slide-phase` attributes the slide shell
 * already publishes. This stays loosely-coupled — a future slice can
 * replace observation with a context without breaking the trigger.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BroadcastMessage } from "@/framework/viewer/types";
import { useDeckBroadcast } from "./broadcast";

interface DeckCursorReadout {
  slide: number;
  phase: number;
}

const PRESENTER_QUERY_FLAG = "presenter";

/** Pull the deck slug out of the live DOM. Set by `<Deck>`'s root. */
function readDeckSlug(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const el = document.querySelector<HTMLElement>("[data-deck-slug]");
  return el?.dataset.deckSlug;
}

/** Read the current cursor from the slide-shell's data-* attributes. */
function readCursor(): DeckCursorReadout | undefined {
  if (typeof document === "undefined") return undefined;
  const el = document.querySelector<HTMLElement>(
    "[data-testid='slide-shell']",
  );
  if (!el) return undefined;
  const slide = Number(el.dataset.slideIndex);
  const phase = Number(el.dataset.slidePhase);
  if (!Number.isInteger(slide) || !Number.isInteger(phase)) return undefined;
  return { slide, phase };
}

/** Open the presenter window for a given deck slug. Reuses the named tab. */
function openPresenterWindow(slug: string): void {
  if (typeof window === "undefined") return;
  const url = `${window.location.pathname.replace(/\/+$/, "")}?${PRESENTER_QUERY_FLAG}=1`;
  // Use a stable name so a second `P` press focuses the existing window
  // rather than spawning a stack of duplicates.
  const features = "popup=yes,width=1280,height=800,resizable=yes,scrollbars=yes";
  const handle = window.open(url, `slide-of-hand-presenter-${slug}`, features);
  try {
    handle?.focus();
  } catch {
    /* focus may be blocked; not fatal */
  }
}

/**
 * Walk the deck cursor toward `target` by dispatching synthetic Arrow keys
 * on `document.body` (the event bubbles up to the window-level handler Deck
 * installs; we use `body` rather than `window` so listeners that call
 * `target.closest(...)` don't trip on a non-Element target).
 *
 * Each step waits for the data-* cursor attributes to actually change
 * before issuing the next dispatch — React renders are async, so polling
 * after a single animation frame is not enough; firing faster than commit
 * would overshoot the target. We also bail out of any wait that takes
 * longer than ~250 ms to avoid hangs if a slide refuses to advance.
 */
async function walkTo(target: DeckCursorReadout): Promise<void> {
  const MAX_STEPS = 200;
  for (let i = 0; i < MAX_STEPS; i++) {
    const cur = readCursor();
    if (!cur) return;
    if (cur.slide === target.slide && cur.phase === target.phase) return;

    const ahead =
      cur.slide < target.slide ||
      (cur.slide === target.slide && cur.phase < target.phase);
    const key = ahead ? "ArrowRight" : "ArrowLeft";
    const before = `${cur.slide}:${cur.phase}`;

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true }),
    );

    await waitForCursorChange(before, 250);
  }
}

/**
 * Resolve once the slide-shell's data-* cursor attrs differ from `before`,
 * or after `timeoutMs`. Used by `walkTo` to stay in lockstep with React
 * commit instead of dispatching faster than the reducer can absorb.
 */
function waitForCursorChange(before: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const root = document.querySelector("[data-deck-slug]") ?? document.body;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    };
    const observer = new MutationObserver(() => {
      const cur = readCursor();
      if (cur && `${cur.slide}:${cur.phase}` !== before) finish();
    });
    // childList is required because `<AnimatePresence mode="wait">` REMOUNTS
    // the slide-shell on slide change — the new node arrives via childList,
    // not attribute mutation.
    observer.observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-slide-index", "data-slide-phase"],
      childList: true,
    });
    const timer = setTimeout(finish, timeoutMs);
  });
}

export function PresenterWindowTrigger() {
  // Resolve slug after mount; querying during render returns null because
  // the deck root sits in the same commit as this component but the DOM
  // isn't observable until effects run.
  const [slug, setSlug] = useState<string>("");
  useEffect(() => {
    const read = readDeckSlug();
    if (read && read !== slug) setSlug(read);
  }, [slug]);
  const lastSentRef = useRef<string>("");

  // Forward-ref into broadcastCurrent so handleMessage (which `useDeckBroadcast`
  // captures) doesn't need an init-time reference.
  const broadcastCurrentRef = useRef<() => void>(() => undefined);

  const handleMessage = useCallback((msg: BroadcastMessage) => {
    if (msg.type === "navigate") {
      void walkTo({ slide: msg.slide, phase: msg.phase });
    } else if (msg.type === "request-state") {
      broadcastCurrentRef.current();
    }
  }, []);

  const { send } = useDeckBroadcast(slug, handleMessage);

  const broadcastCurrent = useCallback((): void => {
    if (!slug) return;
    const cur = readCursor();
    if (!cur) return;
    const key = `${cur.slide}:${cur.phase}`;
    if (key === lastSentRef.current) return;
    lastSentRef.current = key;
    send({ type: "state", slide: cur.slide, phase: cur.phase, deckSlug: slug });
  }, [slug, send]);
  broadcastCurrentRef.current = broadcastCurrent;

  // Observe the slide-shell for cursor changes and broadcast on each change.
  useEffect(() => {
    if (typeof document === "undefined" || !slug) return;
    // Send an initial state so a presenter window opened mid-deck syncs.
    broadcastCurrent();

    const root = document.querySelector("[data-deck-slug]") ?? document.body;
    const observer = new MutationObserver(() => broadcastCurrent());
    observer.observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-slide-index", "data-slide-phase"],
      childList: true,
    });
    return () => observer.disconnect();
  }, [slug, broadcastCurrent]);

  // P key spawns the presenter window. Mirrors the modifier / interactive-
  // element rules of `<Deck>`'s own keydown handler.
  useEffect(() => {
    if (typeof window === "undefined" || !slug) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as Element | null;
      if (
        target?.closest(
          "[data-interactive], input, select, textarea, [contenteditable=true]",
        )
      ) {
        return;
      }
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        openPresenterWindow(slug);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slug]);

  return null;
}
