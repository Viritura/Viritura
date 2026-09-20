import { afterEach, expect, it, vi } from "vitest";
import type { ChordSymbol, Score } from "@viritura/core";
import { createPublishedChordPreview } from "./chordPreview";
import { nativeTransport } from "./chordTestDevice";

const chord: ChordSymbol = { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major" };
const score: Score = { mnx: { version: 1 }, global: { measures: [{ chordSymbols: [chord] }] }, parts: [] };
function browser() {
  return {
    context: { currentTime: 10 } as AudioContext,
    sampler: {
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      allNotesOff: vi.fn(),
      cancelScheduledNotes: vi.fn(),
      sendControl: vi.fn(),
    },
  };
}

afterEach(() => vi.useRealTimers());

it("schedules finite polyphonic releases, not a short channel panic", async () => {
  vi.useFakeTimers();
  const preview = createPublishedChordPreview();
  const voice = browser();
  await preview.preview(chord, { partIndex: 0, browser: async () => voice }, () => true);
  expect(voice.sampler.noteOn.mock.calls.map(([pitch]) => pitch)).toEqual([36, 60, 64, 67]);
  expect(voice.sampler.noteOff.mock.calls).toEqual([36, 60, 64, 67].map((pitch) => [pitch, 13]));
  expect(voice.sampler.sendControl).toHaveBeenCalledWith(64, 0);
  await vi.advanceTimersByTimeAsync(3500);
  expect(voice.sampler.allNotesOff).not.toHaveBeenCalled();
  await preview.cancel();
  expect(voice.sampler.cancelScheduledNotes).toHaveBeenCalledWith(-Infinity);
});

it("does not abort an audition when an equivalent immutable score is republished", async () => {
  const preview = createPublishedChordPreview();
  const voice = browser();
  const audition = (symbol: ChordSymbol) =>
    preview.preview(symbol, { partIndex: 0, browser: async () => voice }, () => true);
  preview.publish({ score, mode: "web", transport: undefined, audition });
  await preview.request(chord);
  preview.publish({ score: structuredClone(score), mode: "web", transport: undefined, audition });
  expect(voice.sampler.allNotesOff).not.toHaveBeenCalled();
  await preview.cancel();
});

it("awaits cancelled native release before preparing a newer audition on another channel", async () => {
  const preview = createPublishedChordPreview();
  const host = nativeTransport();
  let finishStop!: () => void;
  host.stop.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishStop = resolve;
      }),
  );
  const voice = browser();
  const prepare = vi.fn(async () => {});
  const target = { partIndex: 0, browser: async () => voice, native: { transport: host, prepare } };
  await preview.preview(chord, target, () => true);
  const stopped = preview.cancel();
  const next = preview.preview(chord, { ...target, partIndex: 1 }, () => true);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(prepare).toHaveBeenCalledTimes(1);
  finishStop();
  await Promise.all([stopped, next]);
  expect(host.previewChord.mock.calls.map(([part]) => part)).toEqual([0, 1]);
  await preview.cancel();
});

it("retains a failed native release for retry without poisoning future cancellation barriers", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const preview = createPublishedChordPreview();
  const host = nativeTransport();
  const target = {
    partIndex: 0,
    browser: async () => browser(),
    native: { transport: host, prepare: async () => {} },
  };
  const error = new Error("device stop failed");
  try {
    await preview.preview(chord, target, () => true);
    host.stop.mockRejectedValueOnce(error);
    await preview.cancel();
    expect(warning).toHaveBeenCalledExactlyOnceWith("[Audio] Chord preview cancellation failed:", error);
    expect(preview.isActive()).toBe(true);
    await preview.cancel();
    expect(preview.isActive()).toBe(false);
    expect(host.stop).toHaveBeenCalledTimes(2);
    await preview.preview(chord, target, () => true);
    expect(host.previewChord).toHaveBeenCalledTimes(2);
    await preview.cancel();
  } finally {
    warning.mockRestore();
  }
});
