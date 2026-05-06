/**
 * Keyboard shortcut overlay. Toggled with `?` or `H`.
 */

import { AnimatePresence, motion } from "framer-motion";
import { easeEntrance } from "@/lib/motion";

export interface KeyboardHelpProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: Array<[string, string]> = [
  ["→ / Space / Enter / PageDown", "Next phase / slide"],
  ["← / Backspace / PageUp", "Previous phase / slide"],
  ["Home / End", "First / last slide"],
  ["O", "Overview (slide grid)"],
  ["? / H", "Toggle this help"],
  ["F", "Fullscreen"],
  ["D", "Toggle dark mode"],
  ["P", "Open presenter window (slice #5)"],
  ["Q / W / E", "Laser / magnifier / marker (slice #7)"],
  ["T", "Theme overrides (admin only)"],
  ["Esc", "Close overlays / exit tool"],
];

export function KeyboardHelp({ open, onClose }: KeyboardHelpProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="kbd-help"
          data-testid="keyboard-help"
          data-no-advance
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: easeEntrance }}
          className="absolute inset-0 z-50 flex items-center justify-center bg-cf-bg-100/95 px-6 py-12 backdrop-blur-sm"
        >
          <button
            type="button"
            aria-label="Close keyboard help"
            data-interactive
            onClick={onClose}
            className="absolute right-6 top-6 cf-btn-ghost"
          >
            Esc
          </button>
          <div className="cf-card w-full max-w-xl p-8">
            <p className="cf-tag mb-3">Keyboard</p>
            <h2 className="mb-6 text-2xl font-medium tracking-[-0.025em]">
              Shortcuts
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
              {SHORTCUTS.map(([key, label]) => (
                <div key={key} className="contents">
                  <dt className="font-mono text-xs uppercase tracking-[0.2em] text-cf-text-subtle">
                    {key}
                  </dt>
                  <dd className="text-cf-text">{label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
