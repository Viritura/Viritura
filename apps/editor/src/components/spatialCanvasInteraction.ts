/**
 * Helpers + hooks extracted from SpatialCanvas to keep the component lean.
 *
 * Pure hit-test/hover logic plus the wheel-zoom effect live here so the
 * component body stays under the lint complexity threshold.
 */

import { useEffect, type RefObject } from "react";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;

export type DragTarget =
  | { type: "part"; index: number }
  | { type: "listener"; index: number }
  | { type: "child"; childId: string };

interface ChildNode {
  id: string;
  position: { x: number; y: number };
}

interface SpatialHitData {
  childNodes: readonly ChildNode[];
  positions: readonly ({ x: number; y: number } | undefined)[];
  listener: { x: number; y: number };
}

/**
 * Hit-test world coordinates against children (priority), listener, then parts.
 * Returns the drag target or null if nothing was hit.
 */
export function findHitTarget(wx: number, wy: number, spatial: SpatialHitData): DragTarget | null {
  for (let i = spatial.childNodes.length - 1; i >= 0; i--) {
    const cn = spatial.childNodes[i]!;
    if (Math.hypot(wx - cn.position.x, wy - cn.position.y) < 0.4) {
      return { type: "child", childId: cn.id };
    }
  }
  if (Math.hypot(wx - spatial.listener.x, wy - spatial.listener.y) < 0.6) {
    return { type: "listener", index: -1 };
  }
  for (let i = spatial.positions.length - 1; i >= 0; i--) {
    const pos = spatial.positions[i];
    if (!pos) continue;
    if (Math.hypot(wx - pos.x, wy - pos.y) < 0.5) {
      return { type: "part", index: i };
    }
  }
  return null;
}

/**
 * Determine which part / child node (if any) is under the world point for hover.
 */
export function findHoverTarget(
  wx: number,
  wy: number,
  spatial: Pick<SpatialHitData, "childNodes" | "positions">,
): { hovered: number | null; hoveredChild: string | null } {
  for (let i = spatial.childNodes.length - 1; i >= 0; i--) {
    const cn = spatial.childNodes[i]!;
    if (Math.hypot(wx - cn.position.x, wy - cn.position.y) < 0.4) {
      return { hovered: null, hoveredChild: cn.id };
    }
  }
  for (let i = spatial.positions.length - 1; i >= 0; i--) {
    const pos = spatial.positions[i];
    if (!pos) continue;
    if (Math.hypot(wx - pos.x, wy - pos.y) < 0.5) {
      return { hovered: i, hoveredChild: null };
    }
  }
  return { hovered: null, hoveredChild: null };
}

/**
 * Attach a Ctrl/Cmd+wheel zoom listener that keeps the world point under the
 * cursor stationary. Reads/writes via refs and notifies via `apply`.
 */
export function useWheelZoom(
  containerRef: RefObject<HTMLElement | null>,
  zoomRef: RefObject<number>,
  panRef: RefObject<{ x: number; y: number }>,
  apply: (zoom: number, pan: { x: number; y: number }) => void,
) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const prevZ = zoomRef.current;
      const prevP = panRef.current;
      const nextZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prevZ * factor));
      // Keep the world point under cursor stationary:
      // screen = (base + pan) * zoom  →  pan_new = mx/nextZ - (mx/prevZ - pan_old)
      const nextP = {
        x: mx / nextZ - (mx / prevZ - prevP.x),
        y: my / nextZ - (my / prevZ - prevP.y),
      };
      apply(nextZ, nextP);
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [containerRef, zoomRef, panRef, apply]);
}
