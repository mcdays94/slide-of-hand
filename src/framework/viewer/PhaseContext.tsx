/**
 * Phase context.
 *
 * Slides advance with `→` / `Space`. If a slide declares `phases: N`, each
 * keypress advances the per-slide phase from 0 → N before moving to the next
 * slide. The active phase is published via this context so any descendant
 * (component or hook consumer) can reveal incrementally.
 *
 * Two consumption patterns coexist:
 *   - `<Reveal at={N}>` — mount/unmount; clean for distinct blocks.
 *   - `usePhase()` — hook for inline / animation-driven reveals where you
 *     want layout to stay stable.
 */

import { createContext, useContext, type ReactNode } from "react";

const PhaseCtx = createContext<number>(0);

export interface PhaseProviderProps {
  phase: number;
  children: ReactNode;
}

export function PhaseProvider({ phase, children }: PhaseProviderProps) {
  return <PhaseCtx.Provider value={phase}>{children}</PhaseCtx.Provider>;
}

export function usePhase(): number {
  return useContext(PhaseCtx);
}
