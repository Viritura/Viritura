import { useEffect, type RefObject } from "react";

interface InputCursorPointerOptions {
  active: boolean;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  mouseRef: RefObject<{ x: number; y: number } | null>;
  altKeyRef: RefObject<boolean>;
  rafRef: RefObject<number>;
  scheduleRepaint: () => void;
}

export function useInputCursorPointer({
  active,
  canvasRef,
  mouseRef,
  altKeyRef,
  rafRef,
  scheduleRepaint,
}: InputCursorPointerOptions): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    const clearHover = () => {
      mouseRef.current = null;
      altKeyRef.current = false;
      scheduleRepaint();
    };
    clearHover();
    if (!canvas || !active) return () => cancelAnimationFrame(rafRef.current);

    const onMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      // Pointer modifiers are authoritative even if the host lost an Alt keyup.
      altKeyRef.current = event.altKey;
      scheduleRepaint();
    };
    const onKey = (event: KeyboardEvent) => {
      if (!mouseRef.current) return;
      const altKey = event.key === "Alt" ? event.type === "keydown" : event.altKey;
      if (altKeyRef.current === altKey) return;
      altKeyRef.current = altKey;
      scheduleRepaint();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") clearHover();
    };

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", clearHover);
    canvas.addEventListener("pointercancel", clearHover);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", clearHover);
    // Observe before bubbling handlers, without consuming shortcuts or native menus.
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("blur", clearHover);
    window.addEventListener("focus", clearHover);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", clearHover);
      canvas.removeEventListener("pointercancel", clearHover);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", clearHover);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("blur", clearHover);
      window.removeEventListener("focus", clearHover);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      mouseRef.current = null;
      altKeyRef.current = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [active, canvasRef, mouseRef, altKeyRef, rafRef, scheduleRepaint]);
}
