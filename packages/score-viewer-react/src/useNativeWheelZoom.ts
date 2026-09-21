import { useEffect, useEffectEvent, type RefObject } from "react";

interface NativeWheelZoomOptions {
  readonly viewerRef: RefObject<HTMLDivElement | null>;
  readonly enabled: boolean;
  readonly zoom: number;
  readonly zoomStep: number;
  readonly setZoom: (zoom: number) => void;
}

export function useNativeWheelZoom({ viewerRef, enabled, zoom, zoomStep, setZoom }: NativeWheelZoomOptions): void {
  const handleWheel = useEffectEvent((event: WheelEvent) => {
    if (!enabled || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1 - zoomStep : 1 + zoomStep;
    setZoom(zoom * factor);
  });

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const onWheel = (event: WheelEvent) => handleWheel(event);
    viewer.addEventListener("wheel", onWheel, { passive: false });
    return () => viewer.removeEventListener("wheel", onWheel);
  }, [viewerRef]);
}
