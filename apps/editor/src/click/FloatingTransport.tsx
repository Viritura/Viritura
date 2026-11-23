import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./ClickPage.module.css";

interface Position {
  readonly x: number;
  readonly y: number;
}

interface FloatingTransportProps {
  readonly busy: boolean;
  readonly compact?: boolean;
  readonly children: ReactNode;
}

const DIRECTIONS: Readonly<Record<string, Position>> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

function bounded(position: Position, element: HTMLElement): Position {
  const parent = element.parentElement!;
  return {
    x: Math.max(8, Math.min(Math.max(8, parent.clientWidth - element.offsetWidth - 8), position.x)),
    y: Math.max(8, Math.min(Math.max(8, parent.clientHeight - element.offsetHeight - 8), position.y)),
  };
}

export function FloatingTransport({ busy, compact, children }: FloatingTransportProps) {
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ pointerId: number; offset: Position } | null>(null);
  const [position, setPosition] = useState<Position | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element?.parentElement) return;
    const observer = new ResizeObserver(() => {
      setPosition((previous) => {
        if (!previous) return previous;
        const next = bounded(previous, element);
        return next.x === previous.x && next.y === previous.y ? previous : next;
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
      style={position ? { left: position.x, top: position.y, bottom: "auto", transform: "none" } : undefined}
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
          offset: { x: event.clientX - rect.left, y: event.clientY - rect.top },
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
              x: event.clientX - parent.left - current.offset.x,
              y: event.clientY - parent.top - current.offset.y,
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
              x: rect.left - parent.left + direction.x * step,
              y: rect.top - parent.top + direction.y * step,
            },
            element,
          ),
        );
      }}
    >
      <div className={styles.dragSurface} aria-hidden="true" />
      <div className={styles.transportContent}>{children}</div>
    </section>
  );
}
