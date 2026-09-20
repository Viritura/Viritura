// @vitest-environment happy-dom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackEngine, Sf2Synth } from "@viritura/audio";
import { voiceChordSymbol, type ChordSymbol, type Score } from "@viritura/core";
import { PlaybackProvider } from "./PlaybackContext";
import { SCORE_CHANGE_DEBOUNCE_MS } from "./playbackReducer";
import { getPlaybackSnapshot } from "./usePlayback";
import { ChordTestDevice, nativeTransport, recordingSynth } from "./chordTestDevice";

const symbol: ChordSymbol = {
  position: { fraction: [0, 1] },
  root: { step: "C" },
  quality: "major",
  extension: 7,
  bass: { step: "E" },
};

function pitches(chord = symbol) {
  const { leftHand, rightHand } = voiceChordSymbol(chord);
  return [...leftHand, ...rightHand];
}

function makeScore(chord: ChordSymbol | null = symbol): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: { count: 4, unit: 4 },
          tempos: [{ bpm: 120, value: { base: "quarter" } }],
          ...(chord ? { chordSymbols: [chord] } : {}),
        },
      ],
    },
    parts: [0, 1].map((index) => ({
      id: `flute-${index}`,
      name: "Flute",
      measures: [
        {
          sequences: [
            {
              content: [
                {
                  type: "event" as const,
                  duration: { base: "whole" as const },
                  notes: [{ pitch: { step: "C" as const, octave: index === 0 ? (6 as const) : (7 as const) } }],
                },
              ],
            },
          ],
        },
      ],
    })),
  };
}

type ProviderOptions = Omit<ComponentProps<typeof PlaybackProvider>, "children">;

const synths: ReturnType<typeof recordingSynth>[] = [];
let root: Root;
let container: HTMLDivElement;
let props: ProviderOptions;
const buffer = new TextEncoder().encode("RIFF0000sfbk").buffer;
const soundfontLoader = { load: async () => buffer };
const actions = () => getPlaybackSnapshot().actions;

async function flush(milliseconds = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

async function renderProvider(next: ProviderOptions, settleMs = SCORE_CHANGE_DEBOUNCE_MS) {
  props = next;
  await act(async () => {
    root.render(
      <PlaybackProvider {...props} soundfontLoader={soundfontLoader}>
        {null}
      </PlaybackProvider>,
    );
  });
  await flush(settleMs);
}

async function mount(options: ProviderOptions = {}) {
  await renderProvider({ score: makeScore(), ...options });
  act(() => {
    actions().stop();
    actions().setSelectionPartIds(null);
    actions().clearLoop();
    if (getPlaybackSnapshot().state.countInEnabled) actions().toggleCountIn();
    if (getPlaybackSnapshot().state.metronomeEnabled) actions().toggleMetronome();
  });
  expect(getPlaybackSnapshot().state.duration).toBe(2);
}

async function play() {
  await act(async () => {
    await actions().play();
  });
  expect(getPlaybackSnapshot().state.status).toBe("playing");
}

async function preview(chord = symbol) {
  await act(async () => {
    await actions().previewChord(chord);
  });
}

function piano() {
  const found = synths.findLast((synth) => synth.synth.programChange.mock.calls.some(([, program]) => program === 0));
  expect(found).toBeDefined();
  return found!;
}

function notes(program: number) {
  return synths.flatMap(({ synth }) =>
    synth.noteOn.mock.calls
      .filter(([channel]) => synth.programChange.mock.calls.some(([ch, patch]) => ch === channel && patch === program))
      .map(([, note]) => note),
  );
}

function clearNotes() {
  for (const synth of synths) synth.synth.noteOn.mockClear();
}

function lastController(synth: ReturnType<typeof recordingSynth>, controller: number) {
  return synth.synth.controllerChange.mock.calls.filter(([, cc]) => cc === controller).at(-1)?.[2];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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

describe.each(["web", "native"] as const)("published chord commits in %s mode", (mode) => {
  it("prepares the first addition from the published score and gives each edit a full audition", async () => {
    const host = nativeTransport();
    await mount({ score: makeScore(null), audioRenderMode: mode, vstTransport: host });
    // Retain the same callback as a commit handler rendered before publication.
    const commitPreview = actions().previewChord;
    for (const step of ["C", "D", "E"] as const) {
      const chord = { ...symbol, root: { step } };
      const updated = makeScore(chord);
      const previousAttacks = mode === "web" ? notes(0).length : host.previewChord.mock.calls.length;
      await act(async () => {
        await commitPreview(chord, updated);
      });
      await flush(30);
      expect(mode === "web" ? notes(0).length : host.previewChord.mock.calls.length).toBe(previousAttacks);
      const published = structuredClone(updated);
      await renderProvider({ ...props, score: published }, 0);
      expect(getPlaybackSnapshot().state.status).toBe("stopped");
      expect(host.start).not.toHaveBeenCalled();
      if (mode === "native") {
        expect(host.prepare.mock.calls.at(-1)?.[0]).toBe(published);
        expect(host.prepare.mock.calls.at(-1)?.[1].sf2Parts.at(-1)).toMatchObject({ partIndex: 2, program: 0 });
        expect(host.previewChord).toHaveBeenLastCalledWith(2, pitches(chord), 80, 400);
        host.stop.mockClear();
      } else {
        expect(notes(0).slice(previousAttacks)).toEqual(pitches(chord));
        expect(getPlaybackSnapshot().state.partPatches.at(-1)).toMatchObject({ partName: "Chords", gmProgram: 0 });
        piano().cancelScheduledNotes.mockClear();
      }
      // Cross both the score timeline debounce and the original 38ms failure.
      await flush(399);
      if (mode === "web") expect(piano().cancelScheduledNotes).not.toHaveBeenCalled();
      else expect(host.stop).not.toHaveBeenCalled();
      await flush(1);
      if (mode === "web") expect(piano().cancelScheduledNotes).toHaveBeenCalled();
    }
    expect(synths).toHaveLength(mode === "web" ? 2 : 0);
  });

  it("coalesces unpublished edits and cancels an active audition on a real score change", async () => {
    const host = nativeTransport();
    await mount({ audioRenderMode: mode, vstTransport: host });
    const first = { ...symbol, root: { step: "D" } };
    const last = { ...symbol, root: { step: "E" } };
    await act(async () => {
      await actions().previewChord(first, makeScore(first));
      await actions().previewChord(last, makeScore(last));
    });
    await renderProvider({ ...props, score: makeScore(first) }, 0);
    expect(notes(0)).toEqual([]);
    expect(host.previewChord).not.toHaveBeenCalled();
    await renderProvider({ ...props, score: makeScore(last) }, 0);
    if (mode === "web") {
      expect(notes(0)).toEqual(pitches(last));
      piano().cancelScheduledNotes.mockClear();
    } else {
      expect(host.previewChord).toHaveBeenCalledExactlyOnceWith(2, pitches(last), 80, 400);
      host.stop.mockClear();
    }
    // Even an otherwise identical document is not the audition's publication.
    await renderProvider({ ...props, score: structuredClone(props.score) }, 0);
    if (mode === "web") expect(piano().cancelScheduledNotes).toHaveBeenCalled();
    else expect(host.stop).toHaveBeenCalled();
  });

  it("keeps cold preparation alive across its own timeline debounce", async () => {
    const host = nativeTransport();
    const ready = deferred<void>();
    if (mode === "native") {
      host.prepare.mockImplementationOnce(async () => {
        await ready.promise;
        return new Set([0, 1, 2]);
      });
    } else {
      const create = vi.mocked(Sf2Synth.create).getMockImplementation()!;
      vi.mocked(Sf2Synth.create).mockImplementation(async (...args) => {
        const synth = await create(...args);
        vi.mocked(synth.warmUp).mockReturnValue(ready.promise);
        return synth;
      });
    }
    await mount({ score: makeScore(null), audioRenderMode: mode, vstTransport: host });
    await act(async () => actions().previewChord(symbol, makeScore()));
    await renderProvider({ ...props, score: makeScore() }, 0);
    await flush(SCORE_CHANGE_DEBOUNCE_MS + 50);
    expect(notes(0)).toEqual([]);
    expect(host.previewChord).not.toHaveBeenCalled();
    for (const synth of synths) expect(synth.destroy).not.toHaveBeenCalled();
    await act(async () => ready.resolve());
    if (mode === "web") {
      expect(notes(0)).toEqual(pitches());
      for (const synth of synths) expect(synth.destroy).not.toHaveBeenCalled();
    } else expect(host.previewChord).toHaveBeenCalledExactlyOnceWith(2, pitches(), 80, 400);
  });

  it.each(["stop", "seek", "mode change", "transport replacement", "unrelated document", "unmount"] as const)(
    "drops an unpublished commit after %s",
    async (cancellation) => {
      const host = nativeTransport();
      await mount({ score: makeScore(null), audioRenderMode: mode, vstTransport: host });
      const chord = { ...symbol, root: { step: "D" } };
      await act(async () => actions().previewChord(chord, makeScore(chord)));
      if (cancellation === "stop") act(() => actions().stop());
      else if (cancellation === "seek") act(() => actions().seek(0.5));
      else if (cancellation === "mode change") {
        await renderProvider({ ...props, audioRenderMode: mode === "web" ? "native" : "web" }, 0);
      } else if (cancellation === "transport replacement") {
        await renderProvider({ ...props, vstTransport: nativeTransport() }, 0);
      } else if (cancellation === "unrelated document") {
        const otherDocument = { ...makeScore(chord), parts: [makeScore().parts[0]!] };
        await renderProvider({ ...props, score: otherDocument }, 0);
      } else {
        await act(async () => {
          root.unmount();
          root = createRoot(container);
        });
      }
      await renderProvider({ ...props, score: makeScore(chord) });
      expect(synths).toHaveLength(0);
      expect(host.previewChord).not.toHaveBeenCalled();
    },
  );

  it.each(["stop", "seek", "mode change"] as const)(
    "releases an active paused commit audition on explicit %s",
    async (cancellation) => {
      const host = nativeTransport();
      await mount({ audioRenderMode: mode, vstTransport: host });
      await play();
      act(() => actions().pause());
      expect(getPlaybackSnapshot().state.status).toBe("paused");
      host.stop.mockClear();
      const chord = { ...symbol, root: { step: "D" } };
      const committed = makeScore(chord);
      await act(async () => actions().previewChord(chord, committed));
      await renderProvider({ ...props, score: structuredClone(committed) }, 0);
      const synth = mode === "web" ? piano() : undefined;
      if (synth) {
        expect(notes(0).slice(-pitches(chord).length)).toEqual(pitches(chord));
        synth.cancelScheduledNotes.mockClear();
      } else expect(host.previewChord).toHaveBeenCalledExactlyOnceWith(2, pitches(chord), 80, 400);
      // Native cancellation must still work after the paused timeline reload.
      await flush(mode === "native" ? SCORE_CHANGE_DEBOUNCE_MS + 50 : 50);
      if (synth) expect(synth.cancelScheduledNotes).not.toHaveBeenCalled();
      else expect(host.stop).not.toHaveBeenCalled();

      if (cancellation === "stop") act(() => actions().stop());
      else if (cancellation === "seek") act(() => actions().seek(0.5));
      else await renderProvider({ ...props, audioRenderMode: mode === "web" ? "native" : "web" }, 0);
      if (synth) expect(synth.cancelScheduledNotes).toHaveBeenCalled();
      else expect(host.stop).toHaveBeenCalled();
      const attacks = mode === "web" ? notes(0).length : host.previewChord.mock.calls.length;
      await flush(500);
      expect(mode === "web" ? notes(0).length : host.previewChord.mock.calls.length).toBe(attacks);
    },
  );
});

describe("global chords through the real browser provider", () => {
  it("shares a warming note-preview graph without destroying it for a chord click", async () => {
    const ready = deferred<void>();
    const create = vi.mocked(Sf2Synth.create).getMockImplementation()!;
    vi.mocked(Sf2Synth.create).mockImplementation(async (...args) => {
      const synth = await create(...args);
      vi.mocked(synth.warmUp).mockReturnValue(ready.promise);
      return synth;
    });
    await mount();
    let note: unknown;
    let chord!: Promise<void>;
    await act(async () => {
      note = actions().previewNote(72, 0);
    });
    expect(synths).toHaveLength(2);
    await act(async () => {
      chord = actions().previewChord(symbol);
    });
    for (const synth of synths) expect(synth.destroy).not.toHaveBeenCalled();
    await act(async () => {
      ready.resolve();
      await Promise.all([note, chord]);
    });
    expect(notes(0)).toEqual(pitches());
    for (const synth of synths) expect(synth.destroy).not.toHaveBeenCalled();
  });

  it("does not leave an invalidated note-preview build installed after a chord edit", async () => {
    const ready = deferred<void>();
    const create = vi.mocked(Sf2Synth.create).getMockImplementation()!;
    vi.mocked(Sf2Synth.create).mockImplementationOnce(async (...args) => {
      await ready.promise;
      return create(...args);
    });
    await mount();
    let note: unknown;
    await act(async () => {
      note = actions().previewNote(72, 0);
    });
    const edited = { ...symbol, root: { step: "D" } };
    await renderProvider({ ...props, score: makeScore(edited) });
    await act(async () => {
      ready.resolve();
      await note;
    });
    expect(notes(0)).toEqual([]);
    expect(notes(73)).toEqual([]);
    await play();
    expect(notes(0)).toEqual(pitches(edited));
    expect(notes(73)).toEqual([84, 96]);
  });

  it("does not create or audition a derived lane when the score has no global symbols", async () => {
    await mount({ score: makeScore(null) });
    await preview();
    expect(synths).toHaveLength(0);
    await play();
    expect(getPlaybackSnapshot().state.partPatches.map(({ gmProgram }) => gmProgram)).toEqual([73, 73]);
    expect(notes(0)).toEqual([]);
    expect(notes(73)).toEqual([84, 96]);
  });

  it("adds a GM0 piano sampler alongside flute patches without adding a score Part", async () => {
    const score = makeScore();
    const original = structuredClone(score);
    await mount({ score });
    await play();
    expect(getPlaybackSnapshot().state.partPatches.map(({ partName, gmProgram }) => [partName, gmProgram])).toEqual([
      ["Flute", 73],
      ["Flute", 73],
      ["Chords", 0],
    ]);
    expect(notes(0)).toEqual(pitches());
    expect(notes(73)).toEqual([84, 96]);
    const attacks = piano().synth.noteOn.mock.calls.map(([, , , options]) => options?.time);
    expect(new Set(attacks).size).toBe(1);
    expect(attacks[0]).toBeGreaterThanOrEqual(10);
    expect(score).toEqual(original);
  });

  it.each([
    { name: "full score", visible: undefined, selection: null, flute: [84, 96], chords: true },
    { name: "current part", visible: ["flute-1"], selection: null, flute: [96], chords: true },
    { name: "partial explicit selection", visible: undefined, selection: ["flute-0"], flute: [84], chords: false },
    {
      name: "all explicit selection",
      visible: undefined,
      selection: ["flute-0", "flute-1"],
      flute: [84, 96],
      chords: true,
    },
    { name: "all-visible selection", visible: ["flute-1"], selection: ["flute-1"], flute: [96], chords: true },
    { name: "empty explicit selection", visible: undefined, selection: [], flute: [], chords: false },
    { name: "selection outside view", visible: ["flute-1"], selection: ["flute-0"], flute: [], chords: false },
  ])("routes $name through the actual timeline", async ({ visible, selection, flute, chords }) => {
    await mount({ visiblePartIds: visible });
    act(() => actions().setSelectionPartIds(selection));
    await play();
    expect(notes(73)).toEqual(flute);
    expect(notes(0)).toEqual(chords ? pitches() : []);
  });

  it("clears temporary selection on demand without losing the accompaniment", async () => {
    await mount();
    act(() => actions().setSelectionPartIds(["flute-0"]));
    await play();
    expect(notes(0)).toEqual([]);
    act(() => {
      actions().stop();
      actions().setSelectionPartIds(null);
    });
    clearNotes();
    await play();
    expect(notes(0)).toEqual(pitches());
  });

  it("previews the core slash-chord voicing only, then releases after 400ms without starting transport", async () => {
    await mount();
    await preview();
    expect(notes(0)).toEqual(pitches());
    expect(notes(73)).toEqual([]);
    expect(getPlaybackSnapshot().state.status).toBe("stopped");
    const synth = piano();
    expect(
      synth.synth.noteOn.mock.calls.every(([, , velocity, options]) => velocity === 80 && options?.time === 10),
    ).toBe(true);
    synth.cancelScheduledNotes.mockClear();
    synth.synth.controllerChange.mockClear();
    await flush(399);
    expect(synth.cancelScheduledNotes).not.toHaveBeenCalled();
    await flush(1);
    expect(synth.cancelScheduledNotes).toHaveBeenCalledWith([0], -Infinity);
    expect(lastController(synth, 123)).toBe(0);
    expect(synth.synth.noteOff).not.toHaveBeenCalled();
  });

  it("releases an old click immediately and gives the new click its own full lifetime", async () => {
    await mount();
    await preview();
    const synth = piano();
    await flush(250);
    synth.cancelScheduledNotes.mockClear();
    await preview();
    expect(synth.cancelScheduledNotes).toHaveBeenCalled();
    expect(notes(0)).toEqual([...pitches(), ...pitches()]);
    synth.cancelScheduledNotes.mockClear();
    await flush(150);
    expect(synth.cancelScheduledNotes).not.toHaveBeenCalled();
    await flush(249);
    expect(synth.cancelScheduledNotes).not.toHaveBeenCalled();
    await flush(1);
    expect(synth.cancelScheduledNotes).toHaveBeenCalled();
  });

  it("coalesces concurrent cold clicks and stop cancels the outstanding release", async () => {
    await mount();
    await act(async () => {
      await Promise.all([
        actions().previewChord(symbol),
        actions().previewChord(symbol),
        actions().previewChord(symbol),
      ]);
    });
    expect(notes(0)).toEqual(pitches());
    const synth = piano();
    synth.cancelScheduledNotes.mockClear();
    act(() => actions().stop());
    expect(synth.cancelScheduledNotes).toHaveBeenCalled();
    expect(synth.destroy).toHaveBeenCalledOnce();
    clearNotes();
    await flush(500);
    expect(notes(0)).toEqual([]);
  });

  it("does not audition over a running transport", async () => {
    await mount();
    await play();
    clearNotes();
    await preview();
    expect(notes(0)).toEqual([]);
    expect(getPlaybackSnapshot().state.status).toBe("playing");
  });

  it("releases the preview before the real timeline starts", async () => {
    await mount();
    await preview();
    const synth = piano();
    synth.cancelScheduledNotes.mockClear();
    clearNotes();
    await play();
    expect(synth.cancelScheduledNotes).toHaveBeenCalled();
    expect(synth.cancelScheduledNotes.mock.invocationCallOrder[0]).toBeLessThan(
      synth.synth.noteOn.mock.invocationCallOrder[0]!,
    );
    expect(notes(0)).toEqual(pitches());
    expect(notes(73)).toEqual([84, 96]);
    synth.cancelScheduledNotes.mockClear();
    await flush(400);
    expect(synth.cancelScheduledNotes).not.toHaveBeenCalled();
  });

  it("does not let a stopped cold preview sound after its synth finishes loading", async () => {
    await mount();
    const ready = deferred<void>();
    const create = vi.mocked(Sf2Synth.create).getMockImplementation()!;
    vi.mocked(Sf2Synth.create).mockImplementationOnce(async (...args) => {
      await ready.promise;
      return create(...args);
    });
    let pending!: Promise<void>;
    await act(async () => {
      pending = actions().previewChord(symbol);
    });
    expect(Sf2Synth.create).toHaveBeenCalled();
    act(() => actions().stop());
    await act(async () => {
      ready.resolve();
      await pending;
    });
    expect(notes(0)).toEqual([]);
    expect(notes(73)).toEqual([]);
    expect(getPlaybackSnapshot().state.status).toBe("stopped");
    expect(synths.every((synth) => synth.destroy.mock.calls.length > 0)).toBe(true);
  });

  it("releases supported preview voices when the next click is unsupported", async () => {
    await mount();
    await preview();
    const synth = piano();
    synth.cancelScheduledNotes.mockClear();
    clearNotes();
    await preview({ position: { fraction: [0, 1] }, rawText: "C7alt" });
    expect(synth.cancelScheduledNotes).toHaveBeenCalled();
    expect(notes(0)).toEqual([]);
  });

  it("uses edited harmony after a seek/restart without rebuilding the piano", async () => {
    const start = vi.spyOn(PlaybackEngine.prototype, "play");
    const score = makeScore();
    await mount({ score });
    await play();
    act(() => actions().seek(0.75));
    const origin = (start.mock.instances[0] as PlaybackEngine).getScoreTimeSeconds();
    const synthCount = synths.length;
    const edited = { ...symbol, root: { step: "D" as const } };
    await renderProvider({ ...props, score: makeScore(edited) });
    expect(getPlaybackSnapshot().state.status).toBe("stopped");
    clearNotes();
    await play();
    expect(synths).toHaveLength(synthCount);
    expect(notes(0)).toEqual(pitches(edited));
    expect(start).toHaveBeenLastCalledWith(origin);
  });

  it("shares cold sampler preparation with note preview and releases every synth", async () => {
    await mount();
    const ready = deferred<void>();
    const create = vi.mocked(Sf2Synth.create).getMockImplementation()!;
    vi.mocked(Sf2Synth.create).mockImplementationOnce(async (...args) => {
      await ready.promise;
      return create(...args);
    });
    let chord!: Promise<void>;
    await act(async () => {
      chord = actions().previewChord(symbol);
    });
    let note: unknown;
    await act(async () => {
      note = actions().previewNote(72, 0);
    });
    await act(async () => {
      ready.resolve();
      await Promise.all([chord, note]);
    });
    expect(synths).toHaveLength(2);
    act(() => actions().stop());
    expect(synths.every((synth) => synth.destroy.mock.calls.length === 1)).toBe(true);
  });

  it.each(["score edit", "stop", "render mode", "transport replacement"] as const)(
    "keeps the newer note preview and Play graph alive after a cold chord is cancelled by %s",
    async (cancellation) => {
      await mount();
      const ready = deferred<void>();
      const create = vi.mocked(Sf2Synth.create).getMockImplementation()!;
      vi.mocked(Sf2Synth.create).mockImplementationOnce(async (...args) => {
        await ready.promise;
        return create(...args);
      });
      let chord!: Promise<void>;
      await act(async () => {
        chord = actions().previewChord(symbol);
      });
      expect(Sf2Synth.create).toHaveBeenCalled();

      const edited = { ...symbol, root: { step: "D" as const } };
      if (cancellation === "score edit") await renderProvider({ ...props, score: makeScore(edited) });
      else if (cancellation === "stop") act(() => actions().stop());
      else if (cancellation === "render mode") await renderProvider({ ...props, audioRenderMode: "native" });
      else await renderProvider({ ...props, vstTransport: nativeTransport() });

      let note: unknown;
      await act(async () => {
        note = actions().previewNote(72, 0);
      });
      await act(async () => {
        ready.resolve();
        await Promise.all([chord, note]);
      });
      expect(notes(0)).toEqual([]);
      expect(notes(73)).toEqual([72]);
      const previewSynth = synths.find((synth) => synth.synth.noteOn.mock.calls.some(([, pitch]) => pitch === 72));
      expect(previewSynth).toBeDefined();
      expect(previewSynth!.destroy).not.toHaveBeenCalled();

      const synthCount = synths.length;
      clearNotes();
      await play();
      expect(synths).toHaveLength(synthCount);
      expect(notes(0)).toEqual(pitches(cancellation === "score edit" ? edited : symbol));
      expect(notes(73)).toEqual([84, 96]);
      for (const synth of synths) {
        if (synth.synth.noteOn.mock.calls.length) expect(synth.destroy).not.toHaveBeenCalled();
      }
      act(() => actions().stop());
      expect(synths.every((synth) => synth.destroy.mock.calls.length === 1)).toBe(true);
    },
  );

  it("installs the cached metronome and precise resolver when preview loads the engine first", async () => {
    const clicks = vi.spyOn(PlaybackEngine.prototype, "setClickTrack");
    const resolver = vi.spyOn(PlaybackEngine.prototype, "setPlayheadResolver");
    await mount();
    await preview();
    expect(clicks.mock.calls.at(-1)?.[0]).toHaveLength(4);
    expect(resolver.mock.calls.at(-1)?.[0]).toBeTypeOf("function");
    await play();
    expect(clicks.mock.calls.at(-1)?.[0]).toHaveLength(4);
  });

  it("keeps a shared cold graph alive when Play supersedes chord and note previews", async () => {
    await mount();
    const ready = deferred<void>();
    const create = vi.mocked(Sf2Synth.create).getMockImplementation()!;
    vi.mocked(Sf2Synth.create).mockImplementationOnce(async (...args) => {
      await ready.promise;
      return create(...args);
    });
    let audition!: Promise<void>;
    let note: unknown;
    let start!: Promise<void>;
    await act(async () => {
      audition = actions().previewChord(symbol);
    });
    await act(async () => {
      note = actions().previewNote(72, 0);
    });
    await act(async () => {
      start = actions().play();
    });
    await act(async () => {
      ready.resolve();
      await Promise.all([audition, note, start]);
    });
    expect(getPlaybackSnapshot().state.status).toBe("playing");
    expect(synths).toHaveLength(2);
    expect(synths.every((synth) => synth.destroy.mock.calls.length === 0)).toBe(true);
    expect(notes(0)).toEqual(pitches());
  });

  it.each(["mute", "solo exclusion", "zero fader"] as const)("blocks browser preview for %s", async (reason) => {
    await mount();
    act(() => {
      if (reason === "solo exclusion") actions().setVstMutedParts(new Set([2]));
      else actions().applyMix(2, reason === "zero fader" ? 0 : 0.7, 0, reason === "mute", false);
    });
    await preview();
    expect(synths).toHaveLength(0);
    act(() => {
      actions().setVstMutedParts(new Set());
      actions().applyMix(2, 0.7, 0, false, false);
    });
    await preview();
    expect(notes(0)).toEqual(pitches());
  });

  it.each(["NC", "C7alt"])("retains the GM0 lane for unsupported %s but never sounds it", async (rawText) => {
    const chord: ChordSymbol = { position: { fraction: [0, 1] }, rawText };
    await mount({ score: makeScore(chord) });
    await preview(chord);
    expect(synths).toHaveLength(0);
    await play();
    expect(getPlaybackSnapshot().state.partPatches.at(-1)).toMatchObject({ partName: "Chords", gmProgram: 0 });
    expect(notes(0)).toEqual([]);
    expect(notes(73)).toEqual([84, 96]);
  });

  it("keeps the same sampler when an unsupported symbol is corrected", async () => {
    await mount({ score: makeScore({ position: { fraction: [0, 1] }, rawText: "C7alt" }) });
    await play();
    const count = synths.length;
    act(() => {
      actions().pause();
      actions().seek(0);
    });
    await renderProvider({ ...props, score: makeScore() });
    clearNotes();
    await play();
    expect(synths).toHaveLength(count);
    expect(notes(0)).toEqual(pitches());
  });

  it("retains browser chord fader/pan through restart, deletion, restoration and index shifts", async () => {
    const score = makeScore();
    const original = structuredClone(score);
    await mount({ score });
    act(() => {
      actions().applySpatialListener(0, 0);
      actions().applySpatialPosition(2, 0, 0);
      actions().applyMix(2, 0.37, -0.4, false, false);
    });
    await play();
    const settings = [7, 39, 10].map((cc) => lastController(piano(), cc));
    expect(settings[0]).toBeGreaterThan(0);
    expect(settings[2]).toBeLessThan(64);
    act(() => actions().stop());
    await play();
    expect([7, 39, 10].map((cc) => lastController(piano(), cc))).toEqual(settings);
    act(() => actions().stop());
    const withoutChords = makeScore(null);
    await renderProvider({ ...props, score: withoutChords });
    await play();
    expect(getPlaybackSnapshot().state.partPatches).toHaveLength(2);
    act(() => actions().stop());
    const expanded = { ...score, parts: [...score.parts, { ...score.parts[0]!, id: "flute-new" }] };
    await renderProvider({ ...props, score: expanded });
    await play();
    expect(getPlaybackSnapshot().state.partPatches[3]).toMatchObject({ partName: "Chords", gmProgram: 0 });
    expect([7, 39, 10].map((cc) => lastController(piano(), cc))).toEqual(settings);
    act(() => actions().stop());
    await renderProvider({ ...props, score: { ...score, parts: [score.parts[1]!] } });
    await play();
    expect(getPlaybackSnapshot().state.partPatches[1]).toMatchObject({ partName: "Chords", gmProgram: 0 });
    expect([7, 39, 10].map((cc) => lastController(piano(), cc))).toEqual(settings);
    expect(score).toEqual(original);
    expect(expanded.parts).toHaveLength(3);
  });
});

describe("global chords through the native boundary", () => {
  it.each(["chord", "note", "play"] as const)(
    "awaits native natural-completion stop before preparing %s",
    async (next) => {
      const host = nativeTransport();
      let nativePlaying = false;
      host.start.mockImplementation(async () => {
        nativePlaying = true;
      });
      host.previewChord.mockImplementation(async () => {
        if (nativePlaying) throw new Error("native transport is still playing");
        return true;
      });
      await mount({ vstTransport: host, audioRenderMode: "native" });
      await play();
      const stopped = deferred<void>();
      host.stop.mockClear();
      host.stop.mockImplementationOnce(async () => {
        await stopped.promise;
        nativePlaying = false;
      });
      host.prepare.mockClear();
      Object.assign(synths[0]!.context, { currentTime: 13 });
      await flush(50);
      expect(getPlaybackSnapshot().state.status).toBe("stopped");
      expect(host.stop).toHaveBeenCalledOnce();
      expect(nativePlaying).toBe(true);
      let pending!: Promise<void>;
      await act(async () => {
        pending = Promise.resolve(
          next === "chord"
            ? actions().previewChord(symbol)
            : next === "note"
              ? actions().previewNote(60, 0)
              : actions().play(),
        );
      });
      expect(host.prepare).not.toHaveBeenCalled();
      expect(host.previewChord).not.toHaveBeenCalled();
      expect(host.previewNote).not.toHaveBeenCalled();
      expect(host.start).toHaveBeenCalledOnce();
      await act(async () => {
        stopped.resolve();
        await pending;
      });
      expect(host.prepare).toHaveBeenCalledOnce();
      if (next === "chord") {
        expect(nativePlaying).toBe(false);
        expect(host.previewChord).toHaveBeenCalledExactlyOnceWith(2, pitches(), 80, 400);
        await flush(399);
        expect(host.stop).toHaveBeenCalledOnce();
      } else if (next === "note") {
        expect(host.previewNote).toHaveBeenCalledExactlyOnceWith(0, 60, 80, 400);
      } else {
        expect(host.start).toHaveBeenCalledTimes(2);
      }
    },
  );

  it.each(["stop", "seek"] as const)(
    "keeps %s cancellation while natural-completion stop is pending",
    async (cancel) => {
      const host = nativeTransport();
      await mount({ vstTransport: host, audioRenderMode: "native" });
      await play();
      const stopped = deferred<void>();
      host.stop.mockReturnValueOnce(stopped.promise);
      Object.assign(synths[0]!.context, { currentTime: 13 });
      await flush(50);
      let pending!: Promise<void>;
      await act(async () => {
        pending = actions().previewChord(symbol);
      });
      act(() => {
        if (cancel === "stop") actions().stop();
        else actions().seek(0.5);
      });
      await act(async () => {
        stopped.resolve();
        await pending;
      });
      expect(host.previewChord).not.toHaveBeenCalled();
      expect(notes(0)).toEqual([]);
      await preview();
      expect(host.previewChord).toHaveBeenCalledExactlyOnceWith(2, pitches(), 80, 400);
    },
  );

  it("reports a failed natural-completion stop and blocks preview until an explicit stop succeeds", async () => {
    const host = nativeTransport();
    await mount({ vstTransport: host, audioRenderMode: "native" });
    await play();
    const error = new Error("native stop failed");
    host.stop.mockRejectedValueOnce(error);
    host.prepare.mockClear();
    Object.assign(synths[0]!.context, { currentTime: 13 });
    await flush(50);
    expect(getPlaybackSnapshot().state.status).toBe("stopped");
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("[Audio] Native transport stop failed:", error);
    await preview();
    expect(host.prepare).not.toHaveBeenCalled();
    expect(host.previewChord).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenLastCalledWith("[Audio] Chord preview failed:", error);
    vi.mocked(console.warn).mockClear();
    act(() => actions().stop());
    await preview();
    expect(host.previewChord).toHaveBeenCalledExactlyOnceWith(2, pitches(), 80, 400);
  });

  it.each([
    { initialChord: null, prepareDelay: 0 },
    { initialChord: symbol, prepareDelay: 0 },
    { initialChord: null, prepareDelay: 150 },
    { initialChord: symbol, prepareDelay: 150 },
  ])(
    "preserves a paused commit audition and resume position ($prepareDelay ms preparation, $initialChord)",
    async ({ initialChord, prepareDelay }) => {
      const enginePlay = vi.spyOn(PlaybackEngine.prototype, "play");
      const reload = vi.spyOn(PlaybackEngine.prototype, "loadTimeline");
      const host = nativeTransport();
      await mount({ score: makeScore(initialChord), vstTransport: host, audioRenderMode: "native" });
      await play();
      const engine = enginePlay.mock.contexts[0] as PlaybackEngine;
      Object.assign(synths[0]!.context, { currentTime: 11 });
      act(() => actions().pause());
      const pausedAt = engine.getScoreTimeSeconds();
      expect(pausedAt).toBeGreaterThan(0);
      expect(getPlaybackSnapshot().state.status).toBe("paused");
      expect(host.stop).toHaveBeenCalled();
      host.stop.mockClear();
      host.start.mockClear();
      reload.mockClear();

      const ready = deferred<void>();
      const prepare = host.prepare.getMockImplementation()!;
      host.prepare.mockImplementationOnce(async (...args) => {
        await ready.promise;
        return prepare(...args);
      });
      const chord = { ...symbol, root: { step: "D" } };
      const committed = makeScore(chord);
      await act(async () => actions().previewChord(chord, committed));
      expect(host.previewChord).not.toHaveBeenCalled();
      const published = structuredClone(committed);
      await renderProvider({ ...props, score: published }, 0);
      await flush(prepareDelay);
      await act(async () => ready.resolve());
      expect(host.prepare.mock.calls.at(-1)?.[0]).toBe(published);
      expect(host.previewChord).toHaveBeenCalledExactlyOnceWith(2, pitches(chord), 80, 400);
      expect(host.start).not.toHaveBeenCalled();
      await flush(399);
      expect(reload).toHaveBeenCalledOnce();
      expect(host.stop).not.toHaveBeenCalled();
      await flush(1);
      expect(host.stop).not.toHaveBeenCalled();
      expect(host.start).not.toHaveBeenCalled();

      await play();
      expect(enginePlay).toHaveBeenLastCalledWith(pausedAt);
      expect(host.start).toHaveBeenCalledExactlyOnceWith(pausedAt);
    },
  );

  it("still stops a running native transport when an edit reloads its timeline", async () => {
    const host = nativeTransport();
    await mount({ vstTransport: host, audioRenderMode: "native" });
    await play();
    host.stop.mockClear();
    await renderProvider({ ...props, score: makeScore({ ...symbol, root: { step: "D" } }) }, 0);
    expect(host.stop).not.toHaveBeenCalled();
    await flush(SCORE_CHANGE_DEBOUNCE_MS);
    expect(host.stop).toHaveBeenCalledOnce();
    expect(getPlaybackSnapshot().state.status).toBe("stopped");
  });

  it("keeps an unsupported-symbol lane in the native plan without sending a preview", async () => {
    const host = nativeTransport();
    const unsupported: ChordSymbol = { position: { fraction: [0, 1] }, rawText: "C7alt" };
    await mount({ score: makeScore(unsupported), vstTransport: host, audioRenderMode: "native" });
    await preview(unsupported);
    expect(host.prepare).not.toHaveBeenCalled();
    expect(host.previewChord).not.toHaveBeenCalled();
    await play();
    expect(host.prepare.mock.calls.at(-1)?.[1].sf2Parts.at(-1)).toEqual({ partIndex: 2, program: 0, isDrum: false });
    expect(notes(0)).toEqual([]);
  });

  it("prepares the extra SF2 piano index before a cold preview, without transport start", async () => {
    const host = nativeTransport();
    const score = makeScore();
    await mount({ score, vstTransport: host, audioRenderMode: "native" });
    expect(host.prepare).not.toHaveBeenCalled();
    await preview();
    expect(host.prepare).toHaveBeenCalledWith(score, {
      vstParts: [],
      sf2Parts: [
        { partIndex: 0, program: 73, isDrum: false },
        { partIndex: 1, program: 73, isDrum: false },
        { partIndex: 2, program: 0, isDrum: false },
      ],
    });
    expect(host.previewChord).toHaveBeenCalledWith(2, pitches(), 80, 400);
    expect(host.prepare.mock.invocationCallOrder[0]).toBeLessThan(host.previewChord.mock.invocationCallOrder[0]!);
    expect(host.start).not.toHaveBeenCalled();
    expect(host.previewNote).not.toHaveBeenCalled();
    expect(synths).toHaveLength(0);
    expect(getPlaybackSnapshot().state.status).toBe("stopped");
  });

  it("auditions independently of temporary selection and restores that selection for playback", async () => {
    const host = nativeTransport();
    await mount({ vstTransport: host, audioRenderMode: "native" });
    act(() => actions().setSelectionPartIds(["flute-0"]));
    await preview();
    expect(host.setMutedParts.mock.calls.at(-1)?.[0]).toEqual(new Set([1]));
    expect(host.previewChord).toHaveBeenCalledWith(2, pitches(), 80, 400);
    await play();
    expect(host.setMutedParts.mock.calls.at(-1)?.[0]).toEqual(new Set([1, 2]));
  });

  it("does not revive a cleared mute when a lane index changes without a fader edit", async () => {
    const host = nativeTransport();
    const score = makeScore();
    await mount({ score, vstTransport: host, audioRenderMode: "native" });
    act(() => actions().setVstMutedParts(new Set([2])));
    await renderProvider({ ...props, score: { ...score, parts: [...score.parts].reverse() } });
    act(() => actions().setVstMutedParts(new Set()));
    await renderProvider({ ...props, score: { ...score, parts: [score.parts[0]!] } });
    await preview();
    expect(host.setMutedParts.mock.calls.at(-1)?.[0]).toEqual(new Set());
    expect(host.previewChord).toHaveBeenCalledWith(1, pitches(), 80, 400);
  });

  it.each([
    { owned: [0, 1, 2], flute: [], chords: [] },
    { owned: [0, 1], flute: [], chords: pitches() },
    { owned: [2], flute: [84, 96], chords: [] },
  ])("filters browser voices for exact host ownership $owned", async ({ owned, flute, chords }) => {
    const host = nativeTransport();
    host.prepare.mockResolvedValue(new Set(owned));
    await mount({ vstTransport: host, audioRenderMode: "native" });
    await play();
    expect(host.start).toHaveBeenCalledWith(0);
    expect(notes(73)).toEqual(flute);
    expect(notes(0)).toEqual(chords);
  });

  it.each([
    { name: "current part", visible: ["flute-1"], selection: null, muted: [0] },
    { name: "partial selection", visible: undefined, selection: ["flute-0"], muted: [1, 2] },
    { name: "all selection", visible: undefined, selection: ["flute-0", "flute-1"], muted: [] },
    { name: "all-visible selection", visible: ["flute-1"], selection: ["flute-1"], muted: [0] },
    { name: "empty selection", visible: undefined, selection: [], muted: [0, 1, 2] },
  ])("sends the native eligibility mask for $name", async ({ visible, selection, muted }) => {
    const host = nativeTransport();
    await mount({ vstTransport: host, audioRenderMode: "native", visiblePartIds: visible });
    act(() => actions().setSelectionPartIds(selection));
    await play();
    expect(host.setMutedParts.mock.calls.at(-1)?.[0]).toEqual(new Set(muted));
    expect(notes(0)).toEqual([]);
    expect(notes(73)).toEqual([]);
  });

  it.each(["mute", "solo exclusion", "zero fader"] as const)("blocks native preview for %s", async (reason) => {
    const host = nativeTransport();
    await mount({ vstTransport: host, audioRenderMode: "native" });
    act(() => {
      if (reason === "solo exclusion") actions().setVstMutedParts(new Set([2]));
      else actions().applyMix(2, reason === "zero fader" ? 0 : 0.7, 0, reason === "mute", false);
    });
    await preview();
    expect(host.prepare).not.toHaveBeenCalled();
    expect(host.previewChord).not.toHaveBeenCalled();
    expect(synths).toHaveLength(0);
  });

  it("applies gain, pan and effective mute to the extra index before and after restart", async () => {
    const host = nativeTransport();
    await mount({ vstTransport: host, audioRenderMode: "native" });
    act(() => {
      actions().applyMix(2, 0.37, -0.4, true, false);
      actions().setVstMutedParts(new Set([2]));
    });
    await preview();
    expect(host.prepare).not.toHaveBeenCalled();
    expect(host.previewChord).not.toHaveBeenCalled();
    for (let generation = 0; generation < 2; generation++) {
      host.setPartGain.mockClear();
      host.setPartPan.mockClear();
      host.setMutedParts.mockClear();
      await play();
      expect(host.setPartGain).toHaveBeenCalledWith(2, 0.37);
      expect(host.setPartPan).toHaveBeenCalledWith(2, -0.4);
      expect(host.setMutedParts.mock.calls.at(-1)?.[0]).toEqual(new Set([2]));
      act(() => actions().stop());
    }
    act(() => {
      actions().applyMix(2, 0.37, -0.4, false, false);
      actions().setVstMutedParts(new Set());
    });
    await preview();
    expect(host.previewChord).toHaveBeenCalledWith(2, pitches(), 80, 400);
  });

  it("silences native previews on repeated clicks, stop, and switching to browser mode", async () => {
    const host = nativeTransport();
    await mount({ vstTransport: host, audioRenderMode: "native" });
    await preview();
    host.stop.mockClear();
    await preview();
    expect(host.stop).toHaveBeenCalled();
    expect(host.previewChord).toHaveBeenCalledTimes(2);
    host.stop.mockClear();
    await renderProvider({ ...props, audioRenderMode: "web" });
    expect(host.stop).toHaveBeenCalled();
    await preview();
    expect(notes(0)).toEqual(pitches());
    expect(host.previewChord).toHaveBeenCalledTimes(2);
    const synth = piano();
    synth.cancelScheduledNotes.mockClear();
    await renderProvider({ ...props, audioRenderMode: "native" });
    expect(synth.cancelScheduledNotes).toHaveBeenCalled();
    await preview();
    expect(host.previewChord).toHaveBeenCalledTimes(3);
    host.stop.mockClear();
    act(() => actions().stop());
    expect(host.stop).toHaveBeenCalled();
    expect(host.start).not.toHaveBeenCalled();
  });

  it("falls back to the real browser piano when the native host declines preview", async () => {
    const host = nativeTransport();
    host.previewChord.mockResolvedValue(false);
    await mount({ vstTransport: host, audioRenderMode: "native" });
    await preview();
    expect(host.previewChord).toHaveBeenCalledWith(2, pitches(), 80, 400);
    expect(notes(0)).toEqual(pitches());
    expect(notes(73)).toEqual([]);
    expect(host.start).not.toHaveBeenCalled();
  });

  it("invalidates an in-flight native prepare when render mode changes", async () => {
    const host = nativeTransport();
    const ready = deferred<ReadonlySet<number>>();
    host.prepare.mockReturnValueOnce(ready.promise);
    await mount({ vstTransport: host, audioRenderMode: "native" });
    let pending!: Promise<void>;
    await act(async () => {
      pending = actions().previewChord(symbol);
    });
    expect(host.prepare).toHaveBeenCalledOnce();
    await renderProvider({ ...props, audioRenderMode: "web" });
    await act(async () => {
      ready.resolve(new Set([0, 1, 2]));
      await pending;
    });
    expect(host.previewChord).not.toHaveBeenCalled();
    expect(host.start).not.toHaveBeenCalled();
    expect(notes(0)).toEqual([]);
    await preview();
    expect(notes(0)).toEqual(pitches());
  });

  it("honors Stop while Play waits for an in-flight preview preparation", async () => {
    const host = nativeTransport();
    const ready = deferred<ReadonlySet<number>>();
    host.prepare.mockReturnValueOnce(ready.promise);
    await mount({ vstTransport: host, audioRenderMode: "native" });
    let audition!: Promise<void>;
    let start!: Promise<void>;
    await act(async () => {
      audition = actions().previewChord(symbol);
    });
    await act(async () => {
      start = actions().play();
    });
    act(() => actions().stop());
    await act(async () => {
      ready.resolve(new Set([0, 1, 2]));
      await Promise.all([audition, start]);
    });
    expect(host.start).not.toHaveBeenCalled();
    expect(host.previewChord).not.toHaveBeenCalled();
    expect(getPlaybackSnapshot().state.status).toBe("stopped");
    expect(notes(0)).toEqual([]);
  });

  it("restores native chord gain, pan and mute by identity, never by a reused source-part index", async () => {
    const host = nativeTransport();
    const score = makeScore();
    const original = structuredClone(score);
    await mount({ score, vstTransport: host, audioRenderMode: "native" });
    act(() => {
      actions().applyMix(0, 0.8, 0.2, false, false);
      actions().applyMix(2, 0.37, -0.4, true, false);
      actions().setVstMutedParts(new Set([2]));
    });
    await play();
    act(() => actions().stop());
    const withoutChords = makeScore(null);
    withoutChords.parts.push({ ...score.parts[0]!, id: "flute-new" });
    await renderProvider({ ...props, score: withoutChords });
    host.setPartGain.mockClear();
    host.setPartPan.mockClear();
    await play();
    expect(host.prepare.mock.calls.at(-1)?.[1].sf2Parts).toHaveLength(3);
    expect(host.setPartGain).not.toHaveBeenCalledWith(2, 0.37);
    expect(host.setPartPan).not.toHaveBeenCalledWith(2, -0.4);
    expect(host.setMutedParts.mock.calls.at(-1)?.[0]).toEqual(new Set());
    act(() => actions().stop());
    const restored = { ...score, parts: withoutChords.parts };
    await renderProvider({ ...props, score: restored });
    host.setPartGain.mockClear();
    host.setPartPan.mockClear();
    await play();
    expect(host.setPartGain).toHaveBeenCalledWith(3, 0.37);
    expect(host.setPartPan).toHaveBeenCalledWith(3, -0.4);
    expect(host.setPartGain).toHaveBeenCalledWith(0, 0.8);
    expect(host.setMutedParts.mock.calls.at(-1)?.[0]).toEqual(new Set([3]));
    act(() => actions().stop());
    await renderProvider({ ...props, score: { ...score, parts: [score.parts[1]!] } });
    host.setPartGain.mockClear();
    host.setPartPan.mockClear();
    await play();
    expect(host.setPartGain).toHaveBeenCalledWith(1, 0.37);
    expect(host.setPartPan).toHaveBeenCalledWith(1, -0.4);
    expect(host.setMutedParts.mock.calls.at(-1)?.[0]).toEqual(new Set([1]));
    expect(score).toEqual(original);
    expect(withoutChords.parts).toHaveLength(3);
  });
});
