import { useEffect, useState } from "react";
import type { TocEntry } from "./renderDoc";

export interface TocHeadingPosition {
  id: string;
  top: number;
}

export function findActiveTocHeading(
  headings: readonly TocHeadingPosition[],
  activationOffset: number,
): string | undefined {
  let activeId = headings[0]?.id;

  for (const heading of headings) {
    if (heading.top > activationOffset) break;
    activeId = heading.id;
  }

  return activeId;
}

export function useActiveTocHeading(toc: readonly TocEntry[]): string | undefined {
  const [activeId, setActiveId] = useState<string | undefined>(toc[0]?.id);

  useEffect(() => {
    const headings = toc
      .map((entry) => document.getElementById(entry.id))
      .filter((heading): heading is HTMLElement => heading !== null);

    if (headings.length === 0) {
      setActiveId(undefined);
      return;
    }

    const activationOffset = Number.parseFloat(getComputedStyle(headings[0]!).scrollMarginTop) || 0;
    let frame: number | undefined;

    const updateActiveHeading = () => {
      frame = undefined;
      const positions = headings.map((heading) => ({
        id: heading.id,
        top: heading.getBoundingClientRect().top,
      }));
      setActiveId(findActiveTocHeading(positions, activationOffset));
    };

    const scheduleUpdate = () => {
      if (frame === undefined) frame = window.requestAnimationFrame(updateActiveHeading);
    };

    updateActiveHeading();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [toc]);

  return activeId;
}
