// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sf2Synth } from "@viritura/audio";
import type { Score } from "@viritura/core";
import { PlaybackProvider } from "./PlaybackContext";
import { SCORE_CHANGE_DEBOUNCE_MS } from "./playbackReducer";
import { getPlaybackSnapshot } from "./usePlayback";
import { ChordTestDevice, nativeTransport, recordingSynth } from "./chordTestDevice";

function score(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: Array.from({ length: 3 }, () => ({
        time: { count: 4, unit: 4 },
        tempos: [{ bpm: 120, value: { base: "quarter" as const } }],
      })),
    },
    soundProfile: {
      profileId: "viritura-sounds",
      profileVersion: 1,
      parts: { wind: { sourceId: "brass.tuba-primary" } },
    },
    parts: [
      {
        id: "wind",
        name: "Player",
        _x: {
          viritura: {
            initialInstrument: "flute",
            instruments: {
              flute: { instrumentId: "wind.flutes.flute", midiProgram: 73 },
              piccolo: { instrumentId: "wind.flutes.flute.piccolo", midiProgram: 72 },
              violin: { instrumentId: "strings.violin", midiProgram: 40 },
            },
          },
        },
        measures: Array.from({ length: 3 }, (_, index) => ({
          instrumentChanges: index > 0 ? [{ instrument: index === 1 ? "piccolo" : "violin" }] : undefined,
          sequences: [
            {
              content: Array.from({ length: 4 }, () => ({
                type: "event" as const,
                duration: { base: "quarter" as const },
                notes: [{ pitch: { step: "C" as const, octave: 5 } }],
              })),
            },
          ],
        })),
      },
    ],
  };
}

let root: Root;
let container: HTMLDivElement;
const synths: ReturnType<typeof recordingSynth>[] = [];
const buffer = new TextEncoder().encode("RIFF0000sfbk").buffer;
const actions = () => getPlaybackSnapshot().actions;

async function publish(input: Score, host?: ReturnType<typeof nativeTransport>) {
  await act(async () => {
    root.render(
      <PlaybackProvider
        score={input}
        audioRenderMode={host ? "native" : "web"}
        vstTransport={host}
        soundfontLoader={{ load: async () => buffer }}
      >
        {null}
      </PlaybackProvider>,
    );
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SCORE_CHANGE_DEBOUNCE_MS);
  });
}

function soundingPrograms() {
  return synths.flatMap(({ synth }) =>
    synth.noteOn.mock.calls.map(([channel, note]) => ({
      program: synth.programChange.mock.calls.find(([ch]) => ch === channel)?.[1],
      note,
    })),
  );
}

function clearNotes() {
  for (const { synth } of synths) synth.noteOn.mockClear();
}

beforeEach(() => {
  vi.useFakeTimers();
  synths.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("AudioContext", ChordTestDevice);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(buffer)),
  );
  vi.spyOn(Sf2Synth, "create").mockImplementation(async (context) => {
    const synth = recordingSynth(context);
    synths.push(synth);
    return synth as unknown as Sf2Synth;
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    actions().stop();
    root.unmount();
  });
  container.remove();
  try {
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

describe("published instrument changes", () => {
  it("previews the selected bar's timbre and layers while preserving sounding MIDI", async () => {
    await publish(score());
    await act(async () => {
      await actions().previewNote(72, 0, 80, 400, undefined, { measureIndex: 1 });
    });
    expect(soundingPrograms()).toContainEqual({ program: 72, note: 72 });
    clearNotes();
    await act(async () => {
      await actions().previewNote(72, 0, 80, 400, undefined, { measureIndex: 2 });
    });
    expect(soundingPrograms()).toContainEqual({ program: 40, note: 72 });
    expect(soundingPrograms().length).toBeGreaterThan(1);
    clearNotes();
    await act(async () => {
      await actions().previewNote(72, 0, 80, 400, undefined, { measureIndex: 0 });
    });
    expect(soundingPrograms()).toContainEqual({ program: 58, note: 72 });
  });

  it("uses a selected bar's default program for held entry previews", async () => {
    await publish(score());
    await act(async () => {
      await actions().previewPartNoteOn(72, 0, 80, { measureIndex: 1 });
    });
    expect(soundingPrograms()).toContainEqual({ program: 72, note: 72 });
    act(() => actions().previewInstrumentNoteOff(72));
    await act(async () => {
      await actions().previewPartNoteOn(72, 0, 80, { measureIndex: 0 });
    });
    expect(soundingPrograms()).toContainEqual({ program: 58, note: 72 });
    act(() => actions().previewInstrumentNoteOff(72));
  });
  it("preloads assigned initial sound and defaults/layers, then routes seeks and rewinds", async () => {
    await publish(score());
    act(() => {
      actions().stop();
      actions().setSelectionPartIds(null);
      if (getPlaybackSnapshot().state.countInEnabled) actions().toggleCountIn();
      if (getPlaybackSnapshot().state.metronomeEnabled) actions().toggleMetronome();
    });
    await act(async () => {
      await actions().play();
    });
    expect(soundingPrograms()).toMatchObject([{ program: 58, note: 72 }]);
    clearNotes();
    act(() => actions().seek(2));
    expect(soundingPrograms().every(({ program, note }) => program === 72 && note === 72)).toBe(true);
    expect(soundingPrograms().length).toBeGreaterThan(0);
    clearNotes();
    act(() => actions().seek(4));
    expect(soundingPrograms()).toContainEqual({ program: 40, note: 72 });
    expect(soundingPrograms().length).toBeGreaterThan(1);
    clearNotes();
    act(() => actions().seek(0));
    expect(soundingPrograms().every(({ program }) => program === 58)).toBe(true);
  });

  it("rebuilds timbre routing when a change is edited with the same part IDs", async () => {
    const input = score();
    await publish(input);
    act(() => actions().seek(2));
    await act(async () => {
      await actions().play();
    });
    expect(soundingPrograms()).toContainEqual({ program: 72, note: 72 });
    const updated = structuredClone(input);
    updated.parts[0]!.measures[1]!.instrumentChanges = [{ instrument: "violin" }];
    await publish(updated);
    clearNotes();
    act(() => actions().seek(2));
    await act(async () => {
      await actions().play();
    });
    expect(soundingPrograms()).toContainEqual({ program: 40, note: 72 });
    expect(soundingPrograms().some(({ program }) => program === 72)).toBe(false);
  });

  it("keeps changing parts on browser samplers in native mode instead of claiming unsupported host routing", async () => {
    const host = nativeTransport();
    await publish(score(), host);
    act(() => actions().seek(2));
    await act(async () => {
      await actions().play();
    });
    expect(host.prepare).toHaveBeenCalled();
    expect(host.prepare.mock.calls.at(-1)![1]).toEqual({ vstParts: [], sf2Parts: [] });
    expect(soundingPrograms()).toContainEqual({ program: 72, note: 72 });
  });

  it("stops and refuses a stale timeline after an invalid instrument reference is published", async () => {
    const input = score();
    await publish(input);
    await act(async () => {
      await actions().play();
    });
    clearNotes();
    const invalid = structuredClone(input);
    invalid.parts[0]!.measures[1]!.instrumentChanges = [{ instrument: "missing" }];
    await publish(invalid);
    expect(getPlaybackSnapshot().state.status).toBe("stopped");
    expect(getPlaybackSnapshot().state.duration).toBe(0);
    await act(async () => {
      await actions().play();
    });
    expect(soundingPrograms()).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
    vi.mocked(console.warn).mockClear();
    vi.mocked(console.error).mockClear();
  });
});
