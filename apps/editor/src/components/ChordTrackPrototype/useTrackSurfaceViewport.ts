import { useEffect, useState, type RefObject } from "react";

export function useTrackSurfaceViewport(
  root: RefObject<HTMLDivElement | null>,
  viewport: RefObject<HTMLDivElement | null>,
  zoom: number,
) {
  const [geometry, setGeometry] = useState({ offsetY: 0, height: 0 });
  useEffect(() => {
    const element = root.current;
    const view = viewport.current;
    if (!element || !view) return;
    function measure() {
      const offsetY = element!.getBoundingClientRect().top - view!.getBoundingClientRect().top;
      const height = view!.clientHeight;
      setGeometry((previous) =>
        previous.offsetY === offsetY && previous.height === height ? previous : { offsetY, height },
      );
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(view);
    view.addEventListener("scroll", measure);
    return () => {
      observer.disconnect();
      view.removeEventListener("scroll", measure);
    };
  }, [root, viewport, zoom]);
  return geometry;
}
