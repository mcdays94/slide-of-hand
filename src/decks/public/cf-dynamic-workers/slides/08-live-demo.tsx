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
          // TODO(#101 follow-up): wire to real Worker Loader binding when
          // added to wrangler.jsonc. For now we simulate the response so
          // the lifecycle viz still demonstrates the concept.
          const body = await simulateSpawnMany(SPAWN_MANY_COUNT);
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
          // TODO(#101 follow-up): wire to real Worker Loader binding +
          // globe-host endpoint when added to wrangler.jsonc. For now we
          // simulate the spawn so the lifecycle viz reads correctly; the
          // result panel renders a placeholder instead of a live iframe.
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

        // Regular snippets — simulated for static deploy.
        // TODO(#101 follow-up): wire to real Worker Loader binding when
        // added to wrangler.jsonc; for now we hard-code the response so
        // the audience can still see the lifecycle visualisation move.
        void codeOverride;
        const body = await simulateSpawnSnippet(active);
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
 * Simulated spawn responses — Slide of Hand build
 *
 * The source deck is backed by a Cloudflare Worker with a Worker Loader
 * binding that genuinely spawns V8 isolates per click. Slide of Hand
 * doesn't ship that binding (yet), so we simulate the responses with a
 * tiny artificial delay. The lifecycle visualisation, counter, recent-
 * ids ribbon, and result panel all still animate exactly as they do in
 * the original deck — only the "is this real" disclaimer differs.
 *
 * TODO(#101 follow-up): once the platform adds a Worker Loader binding,
 * replace these simulators with real `fetch("/api/spawn", …)` calls.
 * ===================================================================== */

function isolateId(prefix = "iso"): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${rand}`;
}

const SIM_RESULTS: Record<SnippetId, () => unknown> = {
  compute: () => ({
    kind: "compute",
    label: "1000th prime number",
    value: 7919,
    tested: 9100,
    computeMs: 14.62,
  }),
  fetch: () => ({
    kind: "fetch",
    label: "GitHub: cloudflare/workers-sdk",
    url: "https://github.com/cloudflare/workers-sdk",
    stars: 3128,
    openIssues: 412,
    lastPush: "2026-05-08T12:34:56Z",
  }),
  ai: () => ({
    kind: "ai",
    label: "Workers AI · llama-3.1-8b-instruct",
    response:
      "A Cloudflare Dynamic Worker is a piece of code that can be created and run instantly anywhere on Cloudflare's network. It's like having a tiny program that can be summoned on demand to handle a task, then disappear when it's done.",
  }),
  "sandbox-fail": () => ({
    kind: "sandbox-fail",
    label: "Untrusted code · sandbox enforcement",
    error: "ReferenceError: process is not defined",
    note: "The isolate cannot reach Node-only globals; the sandbox held.",
  }),
  "spawn-many": () => ({ kind: "spawn-many" }),
  "globe-app": () => ({ kind: "globe-app" }),
};

async function simulateSpawnSnippet(active: SnippetId): Promise<SpawnResponse> {
  await sleep(380 + Math.random() * 220);
  return {
    id: isolateId(),
    elapsedMs: Math.round(120 + Math.random() * 180),
    memoryKb: Math.round(620 + Math.random() * 240),
    ok: true,
    result: SIM_RESULTS[active](),
  };
}

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

async function simulateSpawnMany(count: number): Promise<ManySpawnResponse> {
  await sleep(460 + Math.random() * 240);
  const isolates: ManyIsolate[] = Array.from({ length: count }).map(() => ({
    id: isolateId(),
    elapsedMs: Math.round(80 + Math.random() * 220),
    ok: true,
    result: { kind: "compute", value: 7919 },
  }));
  const totalElapsedMs = Math.max(...isolates.map((i) => i.elapsedMs)) + 40;
  return { count, totalElapsedMs, ok: true, isolates };
}
