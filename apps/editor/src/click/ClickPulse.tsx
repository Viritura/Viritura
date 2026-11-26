import { useEffect, useMemo, useRef } from "react";
import type { ClickProgramEvent } from "@viritura/audio";
import type { ClickFlashMode } from "../store/clickSettingsStore";

interface ClickPulseProps {
  readonly events: readonly ClickProgramEvent[];
  readonly mode: Exclude<ClickFlashMode, "off">;
  readonly readTime: () => number | undefined;
}

const PULSE_SECONDS = 0.18;

function pulseEvents(events: readonly ClickProgramEvent[], mode: ClickPulseProps["mode"]): ClickProgramEvent[] {
  const pulses: ClickProgramEvent[] = [];
  for (const event of events) {
    if (event.level === "subdivision" || (mode === "measure" && event.level !== "accent")) continue;
    const previous = pulses.at(-1);
    if (previous && Math.abs(previous.time - event.time) < 1e-9) {
      if (event.level === "accent") pulses[pulses.length - 1] = event;
    } else {
      pulses.push(event);
    }
  }
  return pulses;
}

function pulseStrengthAtTime(events: readonly ClickProgramEvent[], time: number | undefined): number {
  if (time === undefined) return 0;
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (events[middle]!.time <= time) low = middle + 1;
    else high = middle;
  }
  const event = events[low - 1];
  if (!event) return 0;
  const remaining = Math.max(0, 1 - (time - event.time) / PULSE_SECONDS);
  return (event.level === "accent" ? 100 : 50) * remaining;
}

/** Repaints from the audio clock in the window hosting this surface, even when the opener is hidden. */
export function ClickPulse({ events, mode, readTime }: ClickPulseProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const pulses = useMemo(() => pulseEvents(events, mode), [events, mode]);

  useEffect(() => {
    const element = ref.current;
    const view = element?.ownerDocument.defaultView;
    const host = element?.parentElement;
    if (!host || !view) return;
    const reducedMotion = view.matchMedia?.("(prefers-reduced-motion: reduce)");
    let frame: number | undefined;
    let previousStrength = Number.NaN;
    const setStrength = (value: number) => {
      if (value === previousStrength) return;
      previousStrength = value;
      host.style.setProperty("--click-pulse", `${value}%`);
    };
    const paint = () => {
      setStrength(pulseStrengthAtTime(pulses, readTime()));
      frame = view.requestAnimationFrame(paint);
    };
    const updateMotion = () => {
      if (reducedMotion?.matches) {
        if (frame !== undefined) view.cancelAnimationFrame(frame);
        frame = undefined;
        setStrength(0);
      } else if (frame === undefined) {
        frame = view.requestAnimationFrame(paint);
      }
    };
    reducedMotion?.addEventListener("change", updateMotion);
    updateMotion();
    return () => {
      reducedMotion?.removeEventListener("change", updateMotion);
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      host.style.removeProperty("--click-pulse");
    };
  }, [pulses, readTime]);

  return <span ref={ref} data-click-flash="" hidden />;
}
