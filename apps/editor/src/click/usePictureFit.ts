import { useLayoutEffect, useRef, type RefObject } from "react";

const PADDING = 12;

interface Size {
  readonly width: number;
  readonly height: number;
}

/** Window delta that makes the viewport exactly hold the padded content. */
function pictureResizeDelta(viewport: Size, content: Size): Size {
  return {
    width: Math.ceil(content.width + 2 * PADDING - viewport.width),
    height: Math.ceil(content.height + 2 * PADDING - viewport.height),
  };
}

/**
 * Resizes the Picture-in-Picture window to its content: it shrinks to the compact
 * playback controls on Start and returns to the navigation panel's size on Stop.
 * Browsers only allow this during user activation, which a Start/Stop press inside
 * the window provides; without it (for example, playback ending on its own) the
 * window keeps its size.
 */
export function usePictureFit(win: Window | null, content: RefObject<HTMLElement | null>, compact: boolean): void {
  const stopped = useRef<{ readonly win: Window; readonly size: Size } | null>(null);
  useLayoutEffect(() => {
    const node = content.current;
    if (!win || !node) return;
    const viewport = { width: win.innerWidth, height: win.innerHeight };
    let target: Size;
    if (compact) {
      stopped.current = { win, size: viewport };
      node.style.width = "max-content";
      target = { width: node.offsetWidth, height: node.offsetHeight };
      node.style.removeProperty("width");
    } else {
      // The opening request already sized the window for the navigation panel.
      if (stopped.current?.win !== win) return;
      const { size } = stopped.current;
      target = { width: size.width - 2 * PADDING, height: size.height - 2 * PADDING };
    }
    const delta = pictureResizeDelta(viewport, target);
    if (delta.width === 0 && delta.height === 0) return;
    try {
      win.resizeBy(delta.width, delta.height);
    } catch {
      // NotAllowedError without user activation; the content still fits by scrolling.
    }
  }, [win, content, compact]);
}
