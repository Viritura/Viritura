import { useCallback, useEffect, useRef } from "react";

interface HoverRefs {
  /** Ref bag: which adornments are currently hovered. */
  engraveEyeHoverIdRef: { current: string | null };
  engraveGhostRailHoverIdRef: { current: string | null };
  /** Mutable fade target `t` ∈ [0,1] read by paintEngraveAdornments. */
  engraveHoverFadeTRef: { current: number };
  /** Repaint trigger — typically `repaintRef.current`. */
  repaint: () => void;
}

interface UseEngraveHoverFadeReturn {
  /** Start (or no-op if already running) the rAF loop animating the fade. */
  startEngraveHoverFade: () => void;
}

/**
 * Animates the engrave-mode hover-fade `t` from current toward 1 (when any
 * adornment is hovered) or 0 (when none). Runs at ~150 ms full transition.
 * Auto-cancels the rAF on unmount.
 */
export function useEngraveHoverFade(refs: HoverRefs): UseEngraveHoverFadeReturn {
  const { engraveEyeHoverIdRef, engraveGhostRailHoverIdRef, engraveHoverFadeTRef, repaint } = refs;
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  const tick = useCallback(() => {
    const target = engraveEyeHoverIdRef.current || engraveGhostRailHoverIdRef.current ? 1 : 0;
    const now = performance.now();
    const last = lastTsRef.current ?? now;
    const dt = Math.min(0.064, (now - last) / 1000);
    lastTsRef.current = now;
    const speed = 7; // ~150ms full transition
    const diff = target - engraveHoverFadeTRef.current;
    if (Math.abs(diff) < 0.01) {
      engraveHoverFadeTRef.current = target;
      rafRef.current = null;
      lastTsRef.current = null;
      repaint();
      return;
    }
    engraveHoverFadeTRef.current += diff * Math.min(1, dt * speed);
    repaint();
    rafRef.current = requestAnimationFrame(tick);
  }, [engraveEyeHoverIdRef, engraveGhostRailHoverIdRef, engraveHoverFadeTRef, repaint]);

  const startEngraveHoverFade = useCallback(() => {
    if (rafRef.current !== null) return;
    lastTsRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    },
    [],
  );

  return { startEngraveHoverFade };
}
