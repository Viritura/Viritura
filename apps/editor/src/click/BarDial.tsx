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
import { describeClickBar, type ClickBar } from "./barNavigation";
import styles from "./BarDial.module.css";

const BAR_WIDTH = 80;
const SETTLE_MS = 180;

interface BarDialProps {
  readonly bars: readonly ClickBar[];
  readonly index: number;
  readonly enabled: boolean;
  readonly onSelect: (index: number) => void;
  readonly onSettlingChange: (settling: boolean) => void;
}

function boundedIndex(index: number, length: number): number {
  return Math.max(0, Math.min(length - 1, index));
}

function closestStart(bars: readonly ClickBar[], index: number): number {
  const center = boundedIndex(index, bars.length);
  for (let distance = 0; distance < bars.length; distance++) {
    const before = center - distance;
    const after = center + distance;
    if (before >= 0 && bars[before]?.startable) return before;
    if (after < bars.length && bars[after]?.startable) return after;
  }
  throw new Error("The score has no selectable bar");
}

function keyboardTarget(bars: readonly ClickBar[], index: number, key: string): number | undefined {
  if (key === "Home") return closestStart(bars, 0);
  if (key === "End") return closestStart(bars, bars.length - 1);
  const direction = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  if (!direction) return undefined;
  for (let next = index + direction; next >= 0 && next < bars.length; next += direction) {
    if (bars[next]?.startable) return next;
  }
  return index;
}

export function BarDial({ bars, index, enabled, onSelect, onSettlingChange }: BarDialProps) {
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
    const target = index * BAR_WIDTH;
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
    if (node && Math.abs(node.scrollLeft - next * BAR_WIDTH) >= 1) {
      automaticScroll.current = next * BAR_WIDTH;
      node.scrollLeft = automaticScroll.current;
    }
  }

  function settle(): void {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (pointerDown.current) return;
      commit(closestStart(bars, Math.round((viewport.current?.scrollLeft ?? 0) / BAR_WIDTH)));
    }, SETTLE_MS);
  }

  function scroll(event: UIEvent<HTMLDivElement>): void {
    const left = event.currentTarget.scrollLeft;
    setScrollLeft(left);
    if (!enabled) {
      const target = index * BAR_WIDTH;
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
    const next = keyboardTarget(bars, index, event.key);
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

  const visibleWidth = Math.max(width, BAR_WIDTH);
  const inset = (visibleWidth - BAR_WIDTH) / 2;
  const center = browsing ? boundedIndex(Math.round(scrollLeft / BAR_WIDTH), bars.length) : index;
  const radius = Math.ceil(visibleWidth / (2 * BAR_WIDTH)) + 4;
  const first = Math.max(0, center - radius);
  const last = Math.min(bars.length, center + radius + 1);
  const trackStyle = { width: bars.length * BAR_WIDTH + inset * 2 };

  return (
    <div className={styles.dial}>
      <div className={styles.marker} aria-hidden="true" />
      <div
        ref={viewport}
        className={styles.viewport}
        role="listbox"
        aria-label="Start bar"
        aria-readonly={!enabled}
        aria-activedescendant={`${id}-${center}`}
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
          {bars.slice(first, last).map((bar, offset) => {
            const barIndex = first + offset;
            const rehearsal = bar.rehearsal ? `, rehearsal ${bar.rehearsal}` : "";
            const barStyle = { left: inset + barIndex * BAR_WIDTH, width: BAR_WIDTH };
            return (
              <Button
                key={`${bar.measureIndex}-${bar.visit}`}
                id={`${id}-${barIndex}`}
                role="option"
                aria-selected={barIndex === center}
                ariaLabel={`${describeClickBar(bar)}${rehearsal}`}
                tabIndex={-1}
                variant="ghost"
                className={styles.bar}
                style={barStyle}
                disabled={!enabled || !bar.startable}
                onClick={() => commit(barIndex)}
              >
                <span className={styles.rehearsal} aria-hidden="true">
                  {bar.rehearsal}
                </span>
                <span className={styles.number} aria-hidden="true">
                  {bar.number}
                </span>
                <span className={styles.visit} aria-hidden="true">
                  {bar.visitCount > 1 ? `${bar.visit}/${bar.visitCount}` : ""}
                  {!bar.startable ? " partial" : ""}
                </span>
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
