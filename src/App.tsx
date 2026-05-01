/**
 * Slice 1 placeholder homepage.
 *
 * Future slices replace this with a real router (`/`, `/decks/<slug>`,
 * `/admin/*`) and the deck registry. For now it simply proves the toolchain
 * end-to-end: Vite builds it, Wrangler ships it, the Worker serves it.
 */
export default function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-cf-text-subtle">
        ReAction
      </p>
      <h1 className="text-5xl font-medium tracking-[-0.04em] text-cf-text sm:text-7xl">
        Coming soon.
      </h1>
      <p className="max-w-xl text-base text-cf-text-muted sm:text-lg">
        A JSX-first deck platform. Each deck is a folder of TypeScript files;
        slides are React components; the framework stays out of the way.
      </p>
      <p className="text-sm text-cf-text-subtle">
        Scaffold landed. Framework primitives + first deck arriving in
        subsequent slices.
      </p>
    </main>
  );
}
