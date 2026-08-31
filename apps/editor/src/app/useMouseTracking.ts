import { useEffect, useRef, useState } from "react";

export interface MouseTracking {
  statusVisible: boolean;
  mousePositionRef: React.RefObject<{ x: number; y: number }>;
}

/**
 * Tracks the cursor for two pieces of UI state:
 * - `statusVisible`: status pill reveals when the cursor approaches the
 *    bottom of the viewport (same UX as PublishView).
 * - `mousePositionRef`: latest mouse position used by the radial menu and
 *    other floating overlays to anchor near the pointer.
 */
export function useMouseTracking(): MouseTracking {
  const [statusVisible, setStatusVisible] = useState(false);
  const mousePositionRef = useRef<{ x: number; y: number }>({
    x: typeof window !== "undefined" ? window.innerWidth / 2 : 0,
    y: typeof window !== "undefined" ? window.innerHeight / 2 : 0,
  });

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mousePositionRef.current = { x: e.clientX, y: e.clientY };
      setStatusVisible(window.innerHeight - e.clientY < 120);
    };
    const onLeave = () => setStatusVisible(false);
    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return { statusVisible, mousePositionRef };
}
