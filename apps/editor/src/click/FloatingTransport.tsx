import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import styles from "./ClickView.module.css";

interface Position {
  readonly right: number;
  readonly bottom: number;
}

interface FloatingTransportProps {
  readonly busy: boolean;
  readonly compact?: boolean;
  readonly background?: ReactNode;
  readonly children: ReactNode;
}

const DIRECTIONS: Readonly<Record<string, Position>> = {
  ArrowLeft: { right: 1, bottom: 0 },
  ArrowRight: { right: -1, bottom: 0 },
  ArrowUp: { right: 0, bottom: 1 },
  ArrowDown: { right: 0, bottom: -1 },
};

function bounded(position: Position, element: HTMLElement): Position {
  const parent = element.parentElement!;
  const maxBottom = Math.max(8, parent.clientHeight - element.offsetHeight - 8);
  const statusHeight =
    Number.parseFloat(getComputedStyle(element).getPropertyValue("--workspace-status-zone-height")) || 0;
  const minBottom = Math.min(maxBottom, Math.max(8, statusHeight + 8));
  return {
    right: Math.max(8, Math.min(Math.max(8, parent.clientWidth - element.offsetWidth - 8), position.right)),
    bottom: Math.max(minBottom, Math.min(maxBottom, position.bottom)),
  };
}

export function FloatingTransport({ busy, compact, background, children }: FloatingTransportProps) {
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ pointerId: number; offset: Position } | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const screenEdges = useRef<{ right: number; bottom: number } | null>(null);
  const previousCompact = useRef(compact);

  // Entering or leaving playback can move the parent (the Click view goes full-screen), so keep the
  // transport's on-screen edges where they were and Stop stays under the performer's finger.
  useLayoutEffect(() => {
    const element = ref.current;
    const edges = screenEdges.current;
    if (previousCompact.current === compact || !element?.parentElement || !edges) return;
    previousCompact.current = compact;
    const parent = element.parentElement.getBoundingClientRect();
    setPosition(bounded({ right: parent.right - edges.right, bottom: parent.bottom - edges.bottom }, element));
  }, [compact]);

  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) screenEdges.current = { right: rect.right, bottom: rect.bottom };
  });

  useEffect(() => {
    const element = ref.current;
    if (!element?.parentElement) return;
    const observer = new ResizeObserver(() => {
      setPosition((previous) => {
        if (!previous) return previous;
        const next = bounded(previous, element);
        return next.right === previous.right && next.bottom === previous.bottom ? previous : next;
      });
    });
    observer.observe(element);
    observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={ref}
      className={styles.floatingTransport}
      data-compact={compact || undefined}
      aria-label="Click player"
      aria-busy={busy}
      aria-description="Drag to move, or use arrow keys when focused. Hold Shift for larger steps."
      tabIndex={0}
      style={position ? { right: position.right, bottom: position.bottom } : undefined}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current || !ref.current) return;
        const interactive =
          event.target instanceof Element
            ? event.target.closest(
                'button, input, select, textarea, a, label, [role="listbox"], [contenteditable="true"], [tabindex]',
              )
            : null;
        if (interactive && interactive !== event.currentTarget) return;
        const rect = ref.current.getBoundingClientRect();
        drag.current = {
          pointerId: event.pointerId,
          offset: { right: rect.right - event.clientX, bottom: rect.bottom - event.clientY },
        };
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        const element = ref.current;
        if (!current || current.pointerId !== event.pointerId || !element) return;
        const parent = element.parentElement!.getBoundingClientRect();
        setPosition(
          bounded(
            {
              right: parent.right - event.clientX - current.offset.right,
              bottom: parent.bottom - event.clientY - current.offset.bottom,
            },
            element,
          ),
        );
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const direction = DIRECTIONS[event.key];
        const element = ref.current;
        if (!direction || !element) return;
        event.preventDefault();
        const rect = element.getBoundingClientRect();
        const parent = element.parentElement!.getBoundingClientRect();
        const step = event.shiftKey ? 40 : 10;
        setPosition(
          bounded(
            {
              right: parent.right - rect.right + direction.right * step,
              bottom: parent.bottom - rect.bottom + direction.bottom * step,
            },
            element,
          ),
        );
      }}
    >
      {background}
      <div className={styles.dragSurface} aria-hidden="true" />
      <div className={styles.transportContent}>{children}</div>
    </section>
  );
}
