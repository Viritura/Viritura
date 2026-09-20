import type React from "react";

type Ref<T> = { current: T };

export function releaseMiddlePointer(e: React.PointerEvent<HTMLCanvasElement>, pointerIdRef: Ref<number | null>): void {
  if (pointerIdRef.current !== e.pointerId) return;
  if (e.currentTarget?.hasPointerCapture?.(e.pointerId)) {
    e.currentTarget.releasePointerCapture(e.pointerId);
  }
  pointerIdRef.current = null;
}
