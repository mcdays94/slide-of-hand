import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { SlideDef } from "@/framework/viewer/types";
import { easeEntrance } from "../lib/motion";
import { Tag } from "../components/primitives/Tag";
import { CornerBrackets } from "../components/primitives/CornerBrackets";
import { CodeBox, type CodeBoxStatus } from "../components/demo/CodeBox";
import {
  IsolateLifecycleViz,
  type IsolateMeta,
  type LifecycleState,
} from "../components/demo/IsolateLifecycleViz";
import { HealthPill } from "../components/demo/HealthPill";
import { SNIPPETS, type SnippetId } from "../lib/snippets";

/**
 * Slide 08 — The live demo (Phase 4 polish).
 *
 * The audience sees a code-in-a-box on the left (CodeBox: 5 tabs +
 * preview + edit + Spawn), an isolate lifecycle visualisation on the
 * upper right (IsolateLifecycleViz: state machine, isolate id,
 * elapsed-ms, memory, counter, recent-ids ribbon), and the result
 * panel on the lower right (JSON for snippets, iframe for globe-app).
 *
 * The slide owns the spawn state machine; CodeBox and
 * IsolateLifecycleViz are dumb-ish components driven by props. This
 * matches the deep-module shape in the PRD: simple interfaces, all
 * the orchestration logic in one place.
 */

interface SnippetSession {
  kind: "snippet";
  status: CodeBoxStatus;
  lifecycle: LifecycleState;
  meta: IsolateMeta;
  result?: unknown;
  errorMessage?: string;
}

interface GlobeSession {
  kind: "globe";
  status: CodeBoxStatus;
  lifecycle: LifecycleState;
  meta: IsolateMeta;
  sessionUrl?: string;
  errorMessage?: string;
}

interface ManyIsolate {
  id: string;
  elapsedMs: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface ManySession {
  kind: "many";
  status: CodeBoxStatus;
  lifecycle: LifecycleState;
  meta: IsolateMeta;
  totalElapsedMs?: number;
  isolates?: ManyIsolate[];
  errorMessage?: string;
}

type Session = SnippetSession | GlobeSession | ManySession;

const TAB_ORDER: SnippetId[] = [
  "compute",
  "fetch",
  "ai",
  "sandbox-fail",
  "spawn-many",
  "globe-app",
];

const SPAWN_MANY_COUNT = 10;

const SNIPPET_LIST = TAB_ORDER.map((id) => SNIPPETS[id]);

interface SpawnResponse {
  id: string;
  elapsedMs: number;
  memoryKb: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface GlobeSpawnResponse {
  id: string;
  elapsedMs: number;
  ok: boolean;
  sessionUrl?: string;
  error?: string;
}

interface ManySpawnResponse {
  count: number;
  totalElapsedMs: number;
  ok: boolean;
  isolates: ManyIsolate[];
  error?: string;
}

/** How long the result state lingers before transitioning to "disposed". */
const DISPOSE_DELAY_MS = 2200;

export const liveDemoSlide: SlideDef = {
  id: "live-demo",
  title: "The Live Demo",
  layout: "default",
  sectionLabel: "LIVE DEMO",
  sectionNumber: "03",
  render: () => <LiveDemoBody />,
};

function LiveDemoBody() {
  const [active, setActive] = useState<SnippetId>("compute");
  const [session, setSession] = useState<Session>(idleSession("snippet"));
  const [counter, setCounter] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const disposeTimer = useRef<number | null>(null);

  // Clean up any pending dispose timer on unmount.
  useEffect(() => {
    return () => {
      if (disposeTimer.current !== null) clearTimeout(disposeTimer.current);
    };
  }, []);

  const onTabChange = useCallback((id: SnippetId) => {
    setActive(id);
    if (disposeTimer.current !== null) clearTimeout(disposeTimer.current);
    setSession(
      idleSession(
        id === "globe-app" ? "globe" : id === "spawn-many" ? "many" : "snippet",
      ),
    );
  }, []);

  const onSpawn = useCallback(
    async (codeOverride?: string) => {
      const isGlobe = active === "globe-app";
      const isMany = active === "spawn-many";
      // Cancel any pending dispose so a fast follow-up click doesn't
      // visually trample the new spawn.
      if (disposeTimer.current !== null) clearTimeout(disposeTimer.current);

      // Move to loading immediately. We don't yet have an isolate id —
      // populate it from the response.
      setSession({
        kind: isGlobe ? "globe" : isMany ? "many" : "snippet",
        status: "loading",
        lifecycle: "loading",
        meta: { label: SNIPPETS[active].label },
      });

      try {
        if (isMany) {
          // Hits the real Worker Loader binding via the platform's
          // /api/cf-dynamic-workers/spawn-many endpoint (issue #167).
          // The endpoint runs 10 dynamic isolates in batches of 4
          // (Worker Loader caps concurrent isolates per parent request
          // at 4) and returns the aggregate timing + per-isolate ids.
          const body = await realSpawnMany(SPAWN_MANY_COUNT);
          if (!body.ok) {
            handleFailure(
              body.error ?? "Multi-spawn returned ok:false",
              isGlobe,
              isMany,
            );
            return;
          }

          // Synthesize an aggregate "swarm" id for the lifecycle viz.
          const swarmId = `swarm_${body.count}`;
          // Brief running beat
          setSession({
            kind: "many",
            status: "loading",
            lifecycle: "running",
            meta: {
              id: swarmId,
              elapsedMs: body.totalElapsedMs,
              label: `${body.count} isolates · in parallel`,
            },
            isolates: body.isolates,
          });
          await sleep(220);
          setSession({
            kind: "many",
            status: "result",
            lifecycle: "result",
            meta: {
              id: swarmId,
              elapsedMs: body.totalElapsedMs,
              label: `${body.count} isolates · in parallel`,
            },
            totalElapsedMs: body.totalElapsedMs,
            isolates: body.isolates,
          });

          // Counter increments by N for multi-spawn so the audience
          // sees the "spawn count" jump. Recent ids list the first 5
          // to fit the ribbon.
          setCounter((c) => c + body.count);
          setRecentIds((prev) =>
            [
              ...body.isolates.slice(0, 5).map((iso) => iso.id),
              ...prev,
            ].slice(0, 5),
          );

          disposeTimer.current = window.setTimeout(() => {
            setSession((prev) => {
              if (prev.kind !== "many" || prev.status !== "result") return prev;
              return { ...prev, lifecycle: "disposed" };
            });
          }, DISPOSE_DELAY_MS);
          return;
        }

        if (isGlobe) {
          // The worker-side endpoint EXISTS at
          // `/api/cf-dynamic-workers/spawn/globe` (issue #167), but the
          // Vite config doesn't yet build the globe-app as a separate
          // HTML entry — calling it would 404 on the upstream fetch
          // from the spawned isolate. Keep the simulator until Vite's
          // multi-entry config lands. The result panel still renders
          // the placeholder branch (no iframe) so the lifecycle viz
          // reads correctly. Follow-up tracked under #167.
          const body = await simulateSpawnGlobe();
          if (!body.ok) {
            handleFailure(
              body.error ?? "Globe spawn failed",
              isGlobe,
              isMany,
              body.id,
            );
            return;
          }
          // Brief "running" beat so the audience sees the lifecycle move.
          setSession({
            kind: "globe",
            status: "loading",
            lifecycle: "running",
            meta: {
              id: body.id,
              elapsedMs: body.elapsedMs,
              label: SNIPPETS[active].label,
            },
          });
          // Tiny delay so "running" reads as a state, then result.
          await sleep(280);
          setSession({
            kind: "globe",
            status: "result",
            lifecycle: "result",
            meta: {
              id: body.id,
              elapsedMs: body.elapsedMs,
              label: SNIPPETS[active].label,
            },
            sessionUrl: body.sessionUrl,
          });
          recordSpawn(body.id);
          // Globe sessions stay live (the iframe is using them); no
          // automatic dispose. The audience can spawn again to bury
          // the previous globe.
          return;
        }

        // Regular snippets — hit the real Worker Loader binding via
        // the platform's /api/cf-dynamic-workers/spawn endpoint (issue
        // #167). The endpoint loads the canonical snippet source (or
        // the speaker's `codeOverride` if the inline editor is open)
        // into a fresh V8 isolate, invokes its fetch handler, and
        // returns the parsed JSON body plus timing.
        const body = await realSpawnSnippet(active, codeOverride);
        if (!body.ok) {
          handleFailure(
            body.error ?? "Spawn returned ok:false",
            isGlobe,
            isMany,
            body.id,
          );
          return;
        }

        // Brief running beat.
        setSession({
          kind: "snippet",
          status: "loading",
          lifecycle: "running",
          meta: {
            id: body.id,
            elapsedMs: body.elapsedMs,
            memoryKb: body.memoryKb,
            label: SNIPPETS[active].label,
          },
        });
        await sleep(220);
        setSession({
          kind: "snippet",
          status: "result",
          lifecycle: "result",
          meta: {
            id: body.id,
            elapsedMs: body.elapsedMs,
            memoryKb: body.memoryKb,
            label: SNIPPETS[active].label,
          },
          result: body.result,
        });
        recordSpawn(body.id);

        // After the result has been on screen long enough, transition
        // the lifecycle to "disposed" — the isolate is gone in real
        // life, so the viz reflects that.
        disposeTimer.current = window.setTimeout(() => {
          setSession((prev) => {
            if (prev.kind !== "snippet" || prev.status !== "result") return prev;
            return { ...prev, lifecycle: "disposed" };
          });
        }, DISPOSE_DELAY_MS);
      } catch (cause) {
        handleFailure(
          cause instanceof Error ? cause.message : String(cause),
          isGlobe,
          isMany,
        );
      }
    },
    [active],
  );

  function handleFailure(
    errorMessage: string,
    isGlobe: boolean,
    isMany: boolean,
    id?: string,
  ) {
    setSession({
      kind: isGlobe ? "globe" : isMany ? "many" : "snippet",
      status: "failed",
      lifecycle: "failed",
      meta: {
        id,
        label: SNIPPETS[active].label,
        errorMessage,
      },
      errorMessage,
    } as Session);
  }

  function recordSpawn(id: string) {
    setCounter((c) => c + 1);
    setRecentIds((prev) => [id, ...prev.filter((x) => x !== id)].slice(0, 5));
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1400px] flex-col gap-4">
      {/* Header — title is the primary element. The 'Live demo' pill sits
          underneath it as a small label/kicker, which is the
          conventional title hierarchy for a deck slide. The HealthPill
          sits in the top-right corner so the speaker can glance at
          backend status without it competing with the title. */}
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="flex flex-col gap-2">
          <h2 className="text-4xl tracking-[-0.035em] sm:text-5xl">
            Spawn a <span className="text-cf-orange">Dynamic Worker</span>.
          </h2>
          <Tag tone="info">Live demo · Spawn on demand</Tag>
        </div>
        <HealthPill />
      </header>

      <motion.div
        className="grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: easeEntrance }}
      >
        {/* Left column — fills full vertical height of the slide. The
            CodeBox is `h-full min-h-0`, which lets its inner code-preview
            div take the remaining vertical space and scroll internally
            instead of expanding the slide past its footer. */}
        <CodeBox
          snippets={SNIPPET_LIST}
          active={active}
          onTabChange={onTabChange}
          onSpawn={onSpawn}
          status={session.status}
          errorMessage={session.errorMessage}
          className="h-full min-h-0"
        />

        {/* Right column: lifecycle viz on top, result panel below.
            min-h-0 ensures the result panel can scroll if its JSON
            payload is large rather than expand the column. */}
        <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
          <IsolateLifecycleViz
            state={session.lifecycle}
            meta={session.meta}
            counter={counter}
            recentIds={recentIds}
          />

          <div className="flex min-h-0 flex-1 flex-col">
            <ResultPanel session={session} />
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function ResultPanel({ session }: { session: Session }) {
  if (session.kind === "many") {
    if (session.status === "result" && session.isolates) {
      return (
        <CornerBrackets className="cf-card relative p-4" inset={-3}>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.16em]">
              <span className="text-cf-text-muted">
                <span className="text-cf-orange normal-case tracking-tight">
                  {session.isolates.length}
                </span>{" "}
                isolates · spawned in parallel
              </span>
              <span className="text-cf-text-subtle tabular-nums">
                total {session.totalElapsedMs} ms
              </span>
            </div>
            <ul className="grid max-h-[280px] grid-cols-2 gap-2 overflow-auto">
              {session.isolates.map((iso) => (
                <li
                  key={iso.id}
                  className={`flex items-baseline justify-between gap-2 rounded-md border px-2.5 py-1.5 font-mono text-[11px] ${
                    iso.ok
                      ? "border-cf-border bg-cf-bg-200"
                      : "border-red-200 bg-red-50"
                  }`}
                >
                  <span
                    className={`tabular-nums ${
                      iso.ok ? "text-cf-text" : "text-red-700"
                    }`}
                  >
                    {iso.id}
                  </span>
                  <span
                    className={`tabular-nums text-[10px] ${
                      iso.ok ? "text-cf-text-subtle" : "text-red-600"
                    }`}
                  >
                    {iso.ok ? `${iso.elapsedMs} ms` : "failed"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </CornerBrackets>
      );
    }
    return (
      <CornerBrackets className="cf-card relative p-6" inset={-3}>
        <p className="text-sm text-cf-text-muted">
          {session.status === "loading"
            ? `Spawning ${SPAWN_MANY_COUNT} isolates in parallel via Promise.all(env.LOADER.load(...))…`
            : session.status === "failed"
              ? session.errorMessage ?? "Multi-spawn failed."
              : `Click Spawn to launch ${SPAWN_MANY_COUNT} brand-new V8 isolates in parallel.`}
        </p>
      </CornerBrackets>
    );
  }

  if (session.kind === "globe") {
    if (session.status === "result" && session.sessionUrl) {
      return (
        <CornerBrackets className="cf-card relative p-4" inset={-3}>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.16em]">
              <span className="text-cf-text-muted">
                Iframe · <span className="text-cf-orange normal-case tracking-tight">{session.sessionUrl}</span>
              </span>
              <a
                href={session.sessionUrl}
                target="_blank"
                rel="noreferrer"
                className="text-cf-text-subtle underline-offset-4 hover:text-cf-orange hover:underline"
                data-interactive
              >
                Open in new tab
              </a>
            </div>
            <iframe
              key={session.meta.id}
              src={session.sessionUrl}
              title={`Globe served by ${session.meta.id}`}
              className="h-[360px] w-full overflow-hidden rounded-md border border-cf-border bg-cf-bg-200"
            />
          </div>
        </CornerBrackets>
      );
    }
    if (session.status === "result") {
      // No sessionUrl — Slide of Hand build doesn't ship a Worker Loader
      // binding yet (see top-of-file TODO), so we render a placeholder
      // that explains the situation rather than a broken iframe.
      return (
        <CornerBrackets className="cf-card relative p-4" inset={-3}>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.16em]">
              <span className="text-cf-text-muted">
                Iframe ·{" "}
                <span className="text-cf-orange normal-case tracking-tight">
                  {session.meta.id}
                </span>
              </span>
              <span className="text-cf-text-subtle">simulated</span>
            </div>
            <div className="flex h-[360px] w-full items-center justify-center overflow-hidden rounded-md border border-dashed border-cf-border bg-cf-bg-200">
              <p className="max-w-[360px] text-center text-xs text-cf-text-muted">
                In the live deck this iframe loads a fresh 3D globe served
                by the Dynamic Worker we just spawned. The static build
                ships without a Worker Loader binding — the lifecycle
                visualisation is real, the iframe is staged.
              </p>
            </div>
          </div>
        </CornerBrackets>
      );
    }
    return (
      <CornerBrackets className="cf-card relative p-6" inset={-3}>
        <p className="text-sm text-cf-text-muted">
          {session.status === "loading"
            ? "Spawning a Dynamic Worker that will serve the globe app at a fresh session URL…"
            : session.status === "failed"
              ? session.errorMessage ?? "Globe spawn failed."
              : "Click Spawn to create a fresh /api/session/:id/ URL — and see the iframe load it live."}
        </p>
      </CornerBrackets>
    );
  }

  // Snippet result
  if (session.status === "idle") {
    return (
      <CornerBrackets className="cf-card relative p-6" inset={-3}>
        <p className="text-sm text-cf-text-muted">
          Pick a snippet, click Spawn. The result of running it inside a fresh
          isolate appears here — JSON for compute / fetch / AI / sandbox-fail,
          a live iframe for globe-app.
        </p>
      </CornerBrackets>
    );
  }
  if (session.status === "loading") {
    return (
      <CornerBrackets className="cf-card relative p-6" inset={-3}>
        <p className="text-sm text-cf-text-muted">
          Birthing isolate · invoking
          <code className="ml-1.5 rounded bg-cf-bg-100 px-1.5 py-0.5 font-mono text-xs">
            env.LOADER.load(&hellip;)
          </code>
        </p>
      </CornerBrackets>
    );
  }
  if (session.status === "failed") {
    return (
      <CornerBrackets className="cf-card relative p-4" inset={-3}>
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-red-700">
            Result · failed
          </span>
          <pre className="overflow-x-auto rounded-md border border-red-200 bg-red-50 p-3 font-mono text-xs text-red-700">
            {session.errorMessage ?? "Unknown error."}
          </pre>
        </div>
      </CornerBrackets>
    );
  }
  return (
    <CornerBrackets className="cf-card relative p-4" inset={-3}>
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-cf-text-muted">
          Result · JSON
        </span>
        <pre className="max-h-[320px] overflow-auto rounded-md border border-cf-border bg-cf-bg-200 p-3 font-mono text-[11px] leading-relaxed text-cf-text">
          {JSON.stringify(session.result, null, 2)}
        </pre>
      </div>
    </CornerBrackets>
  );
}

function idleSession(kind: "snippet" | "globe" | "many"): Session {
  if (kind === "globe") {
    return {
      kind: "globe",
      status: "idle",
      lifecycle: "idle",
      meta: {},
    };
  }
  if (kind === "many") {
    return {
      kind: "many",
      status: "idle",
      lifecycle: "idle",
      meta: {},
    };
  }
  return {
    kind: "snippet",
    status: "idle",
    lifecycle: "idle",
    meta: {},
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* =====================================================================
 * Spawn helpers — Slide of Hand build
 *
 * Two paths:
 *
 *   - `realSpawnSnippet` / `realSpawnMany` hit the real Worker Loader
 *     binding via the platform's `/api/cf-dynamic-workers/*` endpoints
 *     (issue #167). When the audience clicks "Run" the actual V8
 *     isolate spawn happens server-side; the response carries the new
 *     isolate id + timing + result.
 *
 *   - `simulateSpawnGlobe` keeps the lifecycle visualisation moving
 *     for the globe-app snippet. The platform endpoint
 *     `/api/cf-dynamic-workers/spawn/globe` IS wired, but the Vite
 *     config doesn't yet emit a separate `globe-app/index.html` for
 *     the spawned isolate to fetch — calling the real endpoint would
 *     fail at the upstream fetch. Follow-up tracked on issue #167.
 *
 * Each helper returns the same envelope shape regardless of path, so
 * the slide's state machine doesn't know (or care) which it called.
 * ===================================================================== */

function isolateId(prefix = "iso"): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${rand}`;
}

/**
 * POST to `/api/cf-dynamic-workers/spawn` and parse the response. The
 * platform endpoint validates the snippet id against its canonical
 * `SNIPPETS` table and returns `{ ok: false, error }` for unknowns —
 * so we don't need to re-validate here. Network errors translate to
 * an `ok: false` envelope so the slide's error path renders cleanly.
 */
async function realSpawnSnippet(
  snippet: SnippetId,
  codeOverride?: string,
): Promise<SpawnResponse> {
  try {
    const response = await fetch("/api/cf-dynamic-workers/spawn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        snippet,
        ...(codeOverride && codeOverride.trim().length > 0
          ? { code: codeOverride }
          : {}),
      }),
    });
    // Spawn endpoint always returns 200 with a structured envelope
    // (success / failure are both inside the body) — but defensively
    // handle a non-200 (e.g. edge layer rejected the request) so we
    // never leak a raw Response into the UI.
    if (!response.ok) {
      return {
        id: isolateId(),
        elapsedMs: 0,
        memoryKb: 0,
        ok: false,
        error: `spawn endpoint returned status ${response.status}`,
      };
    }
    return (await response.json()) as SpawnResponse;
  } catch (cause) {
    return {
      id: isolateId(),
      elapsedMs: 0,
      memoryKb: 0,
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * POST to `/api/cf-dynamic-workers/spawn-many` and parse the response.
 * The platform endpoint runs the requested count in batches of 4
 * (Worker Loader's per-request concurrent isolate cap) and returns
 * the aggregate timing + per-isolate ids.
 */
async function realSpawnMany(count: number): Promise<ManySpawnResponse> {
  try {
    const response = await fetch("/api/cf-dynamic-workers/spawn-many", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count }),
    });
    if (!response.ok) {
      return {
        count,
        totalElapsedMs: 0,
        ok: false,
        isolates: [],
        error: `spawn-many endpoint returned status ${response.status}`,
      };
    }
    return (await response.json()) as ManySpawnResponse;
  } catch (cause) {
    return {
      count,
      totalElapsedMs: 0,
      ok: false,
      isolates: [],
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * Globe-spawn — kept as a simulator until Vite emits
 * `dist/globe-app/index.html` as a separate entry. See the comment
 * inside `onSpawn` (globe branch) for the rationale.
 */
async function simulateSpawnGlobe(): Promise<GlobeSpawnResponse> {
  await sleep(420 + Math.random() * 220);
  return {
    id: isolateId("globe"),
    elapsedMs: Math.round(180 + Math.random() * 220),
    ok: true,
    // sessionUrl is left undefined so the result panel renders the
    // placeholder branch instead of a broken iframe.
    sessionUrl: undefined,
  };
}
