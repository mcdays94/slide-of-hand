/**
 * Cover slide for the legacy demo archived deck (issue #243).
 *
 * Intentionally minimal — the deck only exists to demonstrate the
 * archived read model end-to-end.
 */
import type { SlideDef } from "@/framework/viewer/types";

export const coverSlide: SlideDef = {
  id: "cover",
  title: "Legacy demo",
  layout: "cover",
  render: () => (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cf-orange">
        Archived
      </p>
      <h1 className="text-6xl font-medium tracking-[-0.04em] text-cf-text">
        Legacy demo
      </h1>
      <p className="max-w-xl text-base text-cf-text-muted">
        This deck has been retired. Public links return not found; admins can
        preview it read-only from the Studio.
      </p>
    </div>
  ),
};
