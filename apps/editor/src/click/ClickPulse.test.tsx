import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClickProgramEvent } from "@viritura/audio";
import { ClickPulse } from "./ClickPulse";

const events: ClickProgramEvent[] = [
  { time: 0, level: "accent" },
  { time: 0.1, level: "subdivision" },
  { time: 0.5, level: "beat" },
  { time: 0.6, level: "subdivision" },
  { time: 1, level: "accent" },
  { time: 1, level: "beat" },
];

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
let time: number | undefined;
const readTime = () => time;

function paint(timeValue: number | undefined, element: HTMLElement): number {
  time = timeValue;
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach((frame) => frame(0)));
  return Number.parseFloat(element.parentElement!.style.getPropertyValue("--click-pulse"));
}

beforeEach(() => {
  frames.clear();
  nextFrame = 0;
  time = undefined;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => frames.delete(id)),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("click pulse", () => {
  it("follows beat events from the audio clock, fading without retriggering on subdivisions", () => {
    const view = render(<ClickPulse events={events} mode="beat" readTime={readTime} />);
    const pulse = view.container.querySelector<HTMLElement>("[data-click-flash]")!;
    expect(paint(undefined, pulse)).toBe(0);
    expect(paint(-0.01, pulse)).toBe(0);
    const downbeat = paint(0, pulse);
    const fading = paint(0.09, pulse);
    const subdivision = paint(0.1, pulse);
    expect(downbeat).toBeGreaterThan(fading);
    expect(fading).toBeGreaterThan(subdivision);
    expect(subdivision).toBeGreaterThan(0);
    expect(paint(0.2, pulse)).toBe(0);
    const beat = paint(0.5, pulse);
    expect(beat).toBeGreaterThan(0);
    expect(beat).toBeLessThan(downbeat);
    expect(paint(0.6, pulse)).toBeLessThan(beat);
    expect(paint(0.7, pulse)).toBe(0);
    expect(paint(1, pulse)).toBe(downbeat);
    const host = pulse.parentElement!;
    view.unmount();
    expect(frames.size).toBe(0);
    expect(host.style.getPropertyValue("--click-pulse")).toBe("");
  });

  it("only pulses on downbeats in measure-only mode", () => {
    const view = render(<ClickPulse events={events} mode="measure" readTime={readTime} />);
    const pulse = view.container.querySelector<HTMLElement>("[data-click-flash]")!;
    expect(paint(0, pulse)).toBeGreaterThan(0);
    expect(paint(0.5, pulse)).toBe(0);
    expect(paint(0.6, pulse)).toBe(0);
    expect(paint(1, pulse)).toBeGreaterThan(0);
  });

  it("stops and resumes painting when reduced motion changes", () => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = false;
    Object.defineProperty(media, "matches", { configurable: true, get: () => reduced });
    vi.spyOn(window, "matchMedia").mockReturnValue(media);
    const view = render(<ClickPulse events={events} mode="beat" readTime={readTime} />);
    const pulse = view.container.querySelector<HTMLElement>("[data-click-flash]")!;
    expect(paint(0, pulse)).toBeGreaterThan(0);

    reduced = true;
    act(() => media.dispatchEvent(new Event("change")));
    expect(pulse.parentElement!.style.getPropertyValue("--click-pulse")).toBe("0%");
    expect(frames.size).toBe(0);

    reduced = false;
    act(() => media.dispatchEvent(new Event("change")));
    expect(paint(0.5, pulse)).toBeGreaterThan(0);
  });
});
