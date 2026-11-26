import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@viritura/ui";
import type { ClickDialEntry } from "./barNavigation";
import styles from "./NavigationDial.module.css";

const ITEM_WIDTH = 80;
const SETTLE_MS = 180;
const DRAG_THRESHOLD = 6;
const VELOCITY_WINDOW_MS = 100;
const MOMENTUM_MS = 280;

interface NavigationDialProps {
  readonly entries: readonly ClickDialEntry[];
  readonly label: string;
  readonly index: number;
  readonly enabled: boolean;
  readonly onSelect: (index: number) => void;
  readonly onSettlingChange: (settling: boolean) => void;
}

interface DragSample {
  readonly time: number;
  readonly x: number;
}

interface DragState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startOffset: number;
  active: boolean;
  samples: DragSample[];
}

function boundedIndex(index: number, length: number): number {
  return Math.max(0, Math.min(length - 1, index));
}

function closestStart(entries: readonly ClickDialEntry[], index: number): number {
  const center = boundedIndex(index, entries.length);
  for (let distance = 0; distance < entries.length; distance++) {
    const before = center - distance;
    const after = center + distance;
    if (before >= 0 && entries[before]?.startable) return before;
    if (after < entries.length && entries[after]?.startable) return after;
  }
  throw new Error("The navigation track has no selectable entry");
}

function keyboardTarget(entries: readonly ClickDialEntry[], index: number, key: string): number | undefined {
  if (key === "Home") return closestStart(entries, 0);
  if (key === "End") return closestStart(entries, entries.length - 1);
  const direction = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  if (!direction) return undefined;
  for (let next = index + direction; next >= 0 && next < entries.length; next += direction) {
    if (entries[next]?.startable) return next;
  }
  return index >= 0 ? index : undefined;
}

/** Offset velocity in px/ms; dragging left moves the dial forward. */
function releaseVelocity(samples: readonly DragSample[]): number {
  const last = samples.at(-1);
  const first = samples.find((sample) => last && last.time - sample.time <= VELOCITY_WINDOW_MS);
  if (!first || !last || last.time <= first.time) return 0;
  return -(last.x - first.x) / (last.time - first.time);
}

function settleDuration(distance: number): number {
  return Math.round(Math.max(120, Math.min(450, Math.sqrt(distance) * 14)));
}

/** Either wheel axis turns the dial; line and page deltas are converted to pixels. */
function wheelDistance(event: WheelEvent, pageWidth: number): number {
  const scale =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? pageWidth : 1;
  const delta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  return delta * scale;
}

export function NavigationDial({ entries, label, index, enabled, onSelect, onSettlingChange }: NavigationDialProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | undefined>(undefined);
  const suppressClick = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const offsetRef = useRef(0);
  const browsingRef = useRef(false);
  const [width, setWidth] = useState(0);
  const [browseOffset, setBrowseOffset] = useState(0);
  const [browsing, setBrowsing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [duration, setDuration] = useState(0);
  const id = useId();
  const maxOffset = Math.max(0, entries.length - 1) * ITEM_WIDTH;
  const restingOffset = Math.max(0, index) * ITEM_WIDTH;
  const offset = browsing ? browseOffset : restingOffset;

  function currentOffset(): number {
    return browsingRef.current ? offsetRef.current : restingOffset;
  }

  function setOffset(next: number): void {
    const bounded = Math.max(0, Math.min(maxOffset, next));
    offsetRef.current = bounded;
    setBrowseOffset(bounded);
  }

  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    // The dial may be hosted in a picture-in-picture window; observe resizes in that window's realm.
    const view = (node.ownerDocument.defaultView ?? window) as Window & typeof globalThis;
    const resize = () => setWidth(node.clientWidth);
    resize();
    const observer = typeof view.ResizeObserver === "undefined" ? undefined : new view.ResizeObserver(resize);
    observer?.observe(node);
    view.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      view.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  function commit(next: number): void {
    clearTimeout(timer.current);
    drag.current = undefined;
    setDragging(false);
    setDuration(settleDuration(Math.abs(currentOffset() - next * ITEM_WIDTH)));
    browsingRef.current = false;
    setBrowsing(false);
    onSelect(next);
    onSettlingChange(false);
  }

  function settle(): void {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (drag.current?.active) return;
      commit(closestStart(entries, Math.round(offsetRef.current / ITEM_WIDTH)));
    }, SETTLE_MS);
  }

  function beginBrowsing(): void {
    clearTimeout(timer.current);
    if (!browsingRef.current) setOffset(restingOffset);
    browsingRef.current = true;
    setBrowsing(true);
    onSettlingChange(true);
  }

  useEffect(() => {
    const node = viewport.current;
    if (!node || !enabled) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || (!event.deltaX && !event.deltaY)) return;
      event.preventDefault();
      beginBrowsing();
      setOffset(offsetRef.current + wheelDistance(event, node.clientWidth));
      settle();
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  });

  function keyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!enabled) return;
    const next = keyboardTarget(entries, index, event.key);
    if (next === undefined) return;
    event.preventDefault();
    commit(next);
  }

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!enabled || (event.pointerType === "mouse" && event.button !== 0)) return;
    suppressClick.current = false;
    beginBrowsing();
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startOffset: offsetRef.current,
      active: false,
      samples: [{ time: performance.now(), x: event.clientX }],
    };
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    if (!state.active) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      state.active = true;
      setDragging(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    const time = performance.now();
    state.samples = [...state.samples, { time, x: event.clientX }].filter(
      (sample) => time - sample.time <= VELOCITY_WINDOW_MS,
    );
    setOffset(state.startOffset - dx);
  }

  function pointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = undefined;
    if (!state.active) {
      settle();
      return;
    }
    suppressClick.current = true;
    const samples = [...state.samples, { time: performance.now(), x: event.clientX }];
    const projected = offsetRef.current + releaseVelocity(samples) * MOMENTUM_MS;
    commit(closestStart(entries, Math.round(projected / ITEM_WIDTH)));
  }

  function pointerCancel(event: ReactPointerEvent<HTMLDivElement>): void {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = undefined;
    setDragging(false);
    settle();
  }

  const visibleWidth = Math.max(width, ITEM_WIDTH);
  const inset = (visibleWidth - ITEM_WIDTH) / 2;
  const center = browsing ? boundedIndex(Math.round(offset / ITEM_WIDTH), entries.length) : Math.max(0, index);
  const radius = Math.ceil(visibleWidth / (2 * ITEM_WIDTH)) + 4;
  const first = Math.max(0, center - radius);
  const last = Math.min(entries.length, center + radius + 1);
  const trackStyle = {
    transform: `translateX(${inset - offset}px)`,
    transitionDuration: browsing ? "0ms" : `${duration}ms`,
  };

  return (
    <div className={styles.dial}>
      <div className={styles.marker} aria-hidden="true" hidden={index < 0 && !browsing} />
      <div
        ref={viewport}
        className={styles.viewport}
        role="listbox"
        aria-label={label}
        aria-readonly={!enabled}
        aria-activedescendant={index >= 0 || browsing ? `${id}-${center}` : undefined}
        data-dragging={dragging || undefined}
        tabIndex={0}
        onKeyDown={keyDown}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerCancel}
        onClickCapture={(event) => {
          if (!suppressClick.current) return;
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <div className={styles.track} style={trackStyle}>
          {entries.slice(first, last).map((entry, offsetIndex) => {
            const entryIndex = first + offsetIndex;
            const entryStyle = { left: entryIndex * ITEM_WIDTH, width: ITEM_WIDTH };
            return (
              <Button
                key={entry.id}
                id={`${id}-${entryIndex}`}
                role="option"
                aria-selected={entryIndex === center && (index >= 0 || browsing)}
                ariaLabel={entry.description}
                tabIndex={-1}
                variant="ghost"
                className={styles.entry}
                style={entryStyle}
                disabled={!enabled || !entry.startable}
                onClick={() => commit(entryIndex)}
              >
                <span className={styles.label} data-kind={entry.kind} aria-hidden="true">
                  {entry.label}
                </span>
                <span className={styles.visit} aria-hidden="true">
                  {entry.detail}
                </span>
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
