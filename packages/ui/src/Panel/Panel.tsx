/**
 * Panel — the single docked side-panel primitive used by every workspace
 * activity (Write, Engrave, Play, Review, Perform, Publish).
 *
 * Positioning: when rendered as a direct child of <WorkspaceShell>, the
 * shell scans Panel children, groups them by `side`, and injects the
 * computed `left` / `right` style so panels stack automatically without
 * any per-callsite offset math. When rendered standalone, the panel
 * falls back to `position: relative; height: 100%` and the caller is
 * responsible for placement.
 *
 * Header / body / footer: pass `title`/`subtitle`/`actions`/`onClose` to
 * render the standard header strip. Body content is `children`. Optional
 * `footer` slot. Set `scrollBody` to wrap children in an overflow:auto
 * column container — the canonical recipe for scrollable side panels.
 *
 * Resizing: pass `width` + `onResize` + `min`/`max`. The panel renders
 * an internal edge-drag handle on the inboard edge (`side="left"`
 * panels get a right-edge handle; `side="right"` panels get a left-edge
 * handle). Drop `onResize` for a fixed-width panel.
 *
 * Visual reference: was `WorkspacePanel` in
 * apps/editor/src/components/WorkspacePanel.tsx.
 */
import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import styles from "./Panel.module.css";

const COLLAPSE_DRAG_THRESHOLD = 32;

export type PanelSide = "left" | "right";

export interface PanelProps {
  /** Which edge of the workspace this panel docks to. Read by WorkspaceShell. */
  side: PanelSide;
  /** Panel width in pixels. */
  width: number;
  /** Resize callback. When provided, an edge drag handle is rendered. */
  onResize?: (width: number) => void;
  /** Minimum width when resizing. Defaults to 200. */
  min?: number;
  /** Maximum width when resizing. Defaults to 500. */
  max?: number;
  /** Collapses the panel when its resize handle is dragged below the minimum width. */
  onCollapse?: () => void;

  /** Header title text. Triggers header render when set. */
  title?: ReactNode;
  /** Optional second-line description / status. */
  subtitle?: ReactNode;
  /** Optional small icon shown left of the title. */
  icon?: ReactNode;
  /** Optional right-aligned action buttons in the header. */
  actions?: ReactNode;
  /** Close handler — when set, renders a ✕ button on the header right. */
  onClose?: () => void;
  /** Override the default ✕ glyph. */
  closeIcon?: ReactNode;

  /** Optional footer content. */
  footer?: ReactNode;
  /** When true, wrap children in an overflow:auto column body. */
  scrollBody?: boolean;

  /** Stack order. Default 2. */
  zIndex?: number;
  /** Extra class names appended after the base panel class. */
  className?: string;
  /** Inline style overrides — merged last (after shell-injected positioning). */
  style?: CSSProperties;

  /**
   * Positioning style injected by <WorkspaceShell>. Do not set manually
   * when rendering inside a shell — the shell computes this from the
   * panel's `side`, `width`, and sibling widths.
   */
  shellStyle?: CSSProperties;

  children?: ReactNode;
}

export function Panel({
  side,
  width,
  onResize,
  min = 200,
  max = 500,
  onCollapse,
  title,
  subtitle,
  icon,
  actions,
  onClose,
  closeIcon,
  footer,
  scrollBody = false,
  zIndex = 2,
  className,
  style,
  shellStyle,
  children,
}: PanelProps) {
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const hasHeader = title !== undefined || onClose !== undefined;
  const bodyClass = scrollBody ? `${styles.body} ${styles.bodyScroll} viritura-scroll` : styles.body;
  const rootStyle: CSSProperties = { width: dragWidth ?? width, zIndex, ...shellStyle, ...style };
  // Resize handle sits on the inboard edge — opposite of the docked side.
  const handleSide: PanelSide = side === "left" ? "right" : "left";
  return (
    <div className={className ? `${styles.panel} ${className}` : styles.panel} style={rootStyle}>
      <div className={styles.chrome}>
        {hasHeader && (
          <div className={styles.header}>
            <div className={styles.headerRow}>
              <span className={styles.titleGroup}>
                {icon !== undefined && <span className={styles.icon}>{icon}</span>}
                {title !== undefined && <span className={styles.title}>{title}</span>}
              </span>
              {(actions !== undefined || onClose !== undefined) && (
                <span className={styles.headerActions}>
                  {actions}
                  {onClose !== undefined && (
                    <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close panel">
                      {closeIcon ?? "✕"}
                    </button>
                  )}
                </span>
              )}
            </div>
            {subtitle !== undefined && <div className={styles.subtitle}>{subtitle}</div>}
          </div>
        )}
        {hasHeader || footer !== undefined || scrollBody ? <div className={bodyClass}>{children}</div> : children}
        {footer !== undefined && <div className={styles.footer}>{footer}</div>}
      </div>
      {onResize !== undefined && (
        <ResizeHandle
          side={handleSide}
          startWidth={width}
          onDrag={onResize}
          onDragPreview={setDragWidth}
          onCollapse={onCollapse}
          min={min}
          max={max}
        />
      )}
    </div>
  );
}

interface ResizeHandleProps {
  side: PanelSide;
  startWidth: number;
  onDrag: (w: number) => void;
  onDragPreview: (w: number | null) => void;
  onCollapse?: () => void;
  min: number;
  max: number;
}

function ResizeHandle({ side, startWidth, onDrag, onDragPreview, onCollapse, min, max }: ResizeHandleProps) {
  const dragRef = useRef<{ startX: number; startW: number; rawWidth: number } | null>(null);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { startX: e.clientX, startW: startWidth, rawWidth: startWidth };
    },
    [startWidth],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const s = dragRef.current;
      if (!s) return;
      const dx = e.clientX - s.startX;
      // "right" handle = right edge of a left-anchored panel; drag right grows.
      // "left"  handle = left  edge of a right-anchored panel; drag left  grows.
      const next = side === "right" ? s.startW + dx : s.startW - dx;
      s.rawWidth = next;
      if (onCollapse && next <= min - COLLAPSE_DRAG_THRESHOLD) {
        dragRef.current = null;
        onDragPreview(null);
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        onCollapse();
        return;
      }
      onDragPreview(Math.max(min - COLLAPSE_DRAG_THRESHOLD, Math.min(max, next)));
      if (next >= min) onDrag(Math.min(max, next));
    },
    [side, onDrag, onDragPreview, onCollapse, min, max],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const drag = dragRef.current;
      dragRef.current = null;
      onDragPreview(null);
      if (drag && drag.rawWidth < min) {
        onDrag(min);
      }
    },
    [min, onDrag, onDragPreview],
  );

  const onPointerCancel = useCallback(() => {
    dragRef.current = null;
    onDragPreview(null);
  }, [onDragPreview]);

  return (
    <div
      className={styles.resize}
      data-side={side}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    />
  );
}
