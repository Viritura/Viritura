import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type UIEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Button } from "@viritura/ui";
import type { ClickDialEntry } from "./barNavigation";
import styles from "./NavigationDial.module.css";

const ITEM_WIDTH = 80;
const SETTLE_MS = 180;

interface NavigationDialProps {
  readonly entries: readonly ClickDialEntry[];
  readonly label: string;
  readonly index: number;
  readonly enabled: boolean;
  readonly onSelect: (index: number) => void;
  readonly onSettlingChange: (settling: boolean) => void;
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

export function NavigationDial({ entries, label, index, enabled, onSelect, onSettlingChange }: NavigationDialProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const pointerDown = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const automaticScroll = useRef<number | undefined>(undefined);
  const [width, setWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [browsing, setBrowsing] = useState(false);
  const id = useId();

  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const resize = () => setWidth(node.clientWidth);
    resize();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize);
    observer?.observe(node);
    window.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    const node = viewport.current;
    if (!node || !enabled) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      event.preventDefault();
      const scale =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? node.clientWidth
            : 1;
      node.scrollLeft += event.deltaY * scale;
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [enabled]);

  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node || browsing) return;
    const target = Math.max(0, index) * ITEM_WIDTH;
    if (Math.abs(node.scrollLeft - target) < 1) return;
    automaticScroll.current = target;
    node.scrollLeft = target;
  }, [browsing, index, width]);

  function commit(next: number): void {
    clearTimeout(timer.current);
    pointerDown.current = false;
    setBrowsing(false);
    onSelect(next);
    onSettlingChange(false);
    const node = viewport.current;
    if (node && Math.abs(node.scrollLeft - next * ITEM_WIDTH) >= 1) {
      automaticScroll.current = next * ITEM_WIDTH;
      node.scrollLeft = automaticScroll.current;
    }
  }

  function settle(): void {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (pointerDown.current) return;
      commit(closestStart(entries, Math.round((viewport.current?.scrollLeft ?? 0) / ITEM_WIDTH)));
    }, SETTLE_MS);
  }

  function scroll(event: UIEvent<HTMLDivElement>): void {
    const left = event.currentTarget.scrollLeft;
    setScrollLeft(left);
    if (!enabled) {
      const target = Math.max(0, index) * ITEM_WIDTH;
      if (Math.abs(left - target) >= 1) {
        automaticScroll.current = target;
        event.currentTarget.scrollLeft = target;
      }
      return;
    }
    if (automaticScroll.current !== undefined) {
      const target = automaticScroll.current;
      automaticScroll.current = undefined;
      if (Math.abs(left - target) < 1) return;
    }
    setBrowsing(true);
    onSettlingChange(true);
    settle();
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!enabled) return;
    const next = keyboardTarget(entries, index, event.key);
    if (next === undefined) return;
    event.preventDefault();
    commit(next);
  }

  function wheelActivity(event: ReactWheelEvent<HTMLDivElement>): void {
    if (!enabled || event.ctrlKey || (!event.deltaX && !event.deltaY)) return;
    setScrollLeft(event.currentTarget.scrollLeft);
    setBrowsing(true);
    onSettlingChange(true);
    settle();
  }

  const visibleWidth = Math.max(width, ITEM_WIDTH);
  const inset = (visibleWidth - ITEM_WIDTH) / 2;
  const center = browsing ? boundedIndex(Math.round(scrollLeft / ITEM_WIDTH), entries.length) : Math.max(0, index);
  const radius = Math.ceil(visibleWidth / (2 * ITEM_WIDTH)) + 4;
  const first = Math.max(0, center - radius);
  const last = Math.min(entries.length, center + radius + 1);
  const trackStyle = { width: entries.length * ITEM_WIDTH + inset * 2 };

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
        tabIndex={0}
        onKeyDown={keyDown}
        onScroll={scroll}
        onWheel={wheelActivity}
        onPointerDown={(event) => {
          if (!enabled) return;
          pointerDown.current = true;
          clearTimeout(timer.current);
          setScrollLeft(event.currentTarget.scrollLeft);
          setBrowsing(true);
          onSettlingChange(true);
        }}
        onPointerUp={() => {
          if (!pointerDown.current) return;
          pointerDown.current = false;
          settle();
        }}
        onPointerCancel={() => {
          if (!pointerDown.current) return;
          pointerDown.current = false;
          settle();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "mouse" || !pointerDown.current) return;
          pointerDown.current = false;
          settle();
        }}
      >
        <div className={styles.track} style={trackStyle}>
          {entries.slice(first, last).map((entry, offset) => {
            const entryIndex = first + offset;
            const entryStyle = { left: inset + entryIndex * ITEM_WIDTH, width: ITEM_WIDTH };
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
                <span className={styles.label} aria-hidden="true">
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
