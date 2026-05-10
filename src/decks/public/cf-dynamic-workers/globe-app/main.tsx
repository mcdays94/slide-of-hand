/**
 * Globe-app entry — the React mount point for the standalone globe page.
 *
 * Built as a separate Vite entry (`globe-app/index.html`) so it produces
 * its own asset bundle under `dist/globe-app/`. The Dynamic Worker
 * spawned by `POST /api/spawn/globe` returns minimal HTML that pulls
 * these built assets back from the parent worker via the session
 * forwarder. Audience sees a fresh URL serve a brand-new 3D globe; the
 * spawn really happened, and the spawned isolate really handled the
 * inbound request — it just delegates static-asset loading to the
 * parent's ASSETS binding, exactly as a production multi-tenant
 * platform would.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SimpleGlobe } from "./SimpleGlobe";

const isolateId = document.body.getAttribute("data-isolate-id") ?? "unknown";

function App() {
  return (
    <>
      <SimpleGlobe />

      {/* Tiny corner watermark so the audience sees that THIS specific
          isolate is what served the page. The id is rendered into the
          HTML by the spawned dynamic worker — we just read it back. */}
      <div
        style={{
          position: "fixed",
          bottom: 18,
          left: 22,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 11,
          color: "rgba(82, 16, 0, 0.55)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          pointerEvents: "none",
        }}
      >
        <span>Served by Dynamic Worker</span>
        <span
          style={{
            color: "#FF4801",
            letterSpacing: "0.06em",
            fontWeight: 500,
          }}
        >
          {isolateId}
        </span>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
