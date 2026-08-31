/**
 * PictureWindow — the pop-out the composer actually watches.
 *
 * Two hosts, one surface. Where Document Picture-in-Picture exists the surface
 * goes into a real always-on-top OS window, which is the thing a composer wants:
 * visible while the editor is behind other windows, movable to a second
 * monitor, and not stealing space from the score. Where it does not, the same
 * surface is portalled to `document.body` as a floating panel the composer can
 * drag and resize — bound to the viewport rather than to any one activity, so
 * it stays put while they move between Write and Picture.
 *
 * Both hosts render identical children, so the cue overlay, the controls and
 * the styling are written once and there is no second implementation to drift.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { closePictureWindow, isDocumentPipSupported, openPictureWindow } from "./documentPictureInPicture";
import styles from "./PictureWindow.module.css";

export interface PictureWindowProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
}

export function PictureWindow({ open, onClose, title, children }: PictureWindowProps) {
  const [pipBody, setPipBody] = useState<HTMLElement | null>(null);
  const [pipFailed, setPipFailed] = useState(false);

  useEffect(() => {
    if (!open || !isDocumentPipSupported() || pipFailed) return;

    let cancelled = false;
    let win: Window | null = null;

    void openPictureWindow({ width: 520, height: 320 })
      .then((opened) => {
        if (cancelled) {
          opened.close();
          return;
        }
        win = opened;
        // The user can close the window from its own chrome, so the app has to
        // learn about the exit from the window rather than assume its own call
        // was the only way out.
        opened.addEventListener("pagehide", onClose);
        setPipBody(opened.document.body);
      })
      .catch(() => {
        // Blocked, or not from a gesture. Fall through to the floating panel
        // rather than leaving the composer with nothing.
        if (!cancelled) setPipFailed(true);
      });

    return () => {
      cancelled = true;
      setPipBody(null);
      win?.removeEventListener("pagehide", onClose);
      closePictureWindow();
    };
  }, [open, pipFailed, onClose]);

  if (!open) return null;
  if (pipBody) return createPortal(<div className={styles.pipRoot}>{children}</div>, pipBody);
  if (isDocumentPipSupported() && !pipFailed) return null;
  return (
    <FloatingPanel title={title} onClose={onClose}>
      {children}
    </FloatingPanel>
  );
}

interface FloatingPanelProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/** Smallest usable size; below this the cue overlay stops being readable. */
const MIN_SIZE = { width: 240, height: 160 };

/**
 * The in-page fallback.
 *
 * Portalled to `document.body` so it is not clipped by, or scrolled with, the
 * activity underneath it.
 */
function FloatingPanel({ title, onClose, children }: FloatingPanelProps) {
  const [rect, setRect] = useState({ x: 32, y: 96, width: 420, height: 260 });
  const dragRef = useRef<{ mode: "move" | "resize"; x: number; y: number; rect: typeof rect } | null>(null);

  const onPointerMove = useCallback((event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (drag.mode === "move") {
      setRect({ ...drag.rect, x: drag.rect.x + dx, y: drag.rect.y + dy });
    } else {
      setRect({
        ...drag.rect,
        width: Math.max(MIN_SIZE.width, drag.rect.width + dx),
        height: Math.max(MIN_SIZE.height, drag.rect.height + dy),
      });
    }
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  const begin = useCallback(
    (mode: "move" | "resize") => (event: React.PointerEvent) => {
      dragRef.current = { mode, x: event.clientX, y: event.clientY, rect };
    },
    [rect],
  );

  // Position and size are genuinely per-instance and change on every pointer
  // move; a stylesheet cannot express them.
  const frame: CSSProperties = {
    transform: `translate(${rect.x}px, ${rect.y}px)`,
    width: rect.width,
    height: rect.height,
  };

  return createPortal(
    <div className={styles.floating} style={frame} data-testid="picture-window">
      <div className={styles.titlebar} onPointerDown={begin("move")}>
        <span className={styles.title}>{title}</span>
        <button className={styles.close} onClick={onClose} aria-label="Close picture window">
          ×
        </button>
      </div>
      <div className={styles.body}>{children}</div>
      <div className={styles.resize} onPointerDown={begin("resize")} aria-hidden="true" />
    </div>,
    document.body,
  );
}
