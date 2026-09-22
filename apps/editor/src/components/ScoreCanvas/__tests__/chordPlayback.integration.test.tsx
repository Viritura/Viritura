import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freeze } from "immer";
import { CHORDS_PART_ID, voiceChordSymbol, type Score } from "@viritura/core";
import { Sf2Synth } from "@viritura/audio";
import { serializeMnx } from "@viritura/format";
import { getPlaybackSnapshot, PlaybackProvider, type VstTransport } from "@viritura/playback";
import { getGlobalPerfTracker, type DisplayList } from "@viritura/renderer";
import { DocumentProvider, useDocumentStore, useDocumentStoreApi } from "../../../store/DocumentContext";
import type { DocumentStore } from "../../../store/documentStore";
import { useSelectionStore } from "../../../store/selectionStore";
import { useViewStateStore } from "../../../store/viewStateStore";
import { useMixer, useMixerActions } from "../../../store/mixerStore";
import { useNotePreview } from "../../../hooks/useNotePreview";
import { MixerSyncBridge } from "../../MixerSyncBridge";
import { SelectionPlaybackBridge } from "../../playbackSelection/SelectionPlaybackBridge";
import { ScoreCanvas } from "../ScoreCanvas";
import { computeDisplayListImpl } from "../computeDisplayList";
import type { initWasmAndFont } from "../initWasmAndFont";
import { createVstTransport as createDesktopVstTransport, invalidateVstHostMirror } from "../../../instrumentProfiles";
import { ChordAudioDevice, recordingSynth } from "./chordAudioDevice";

const nativeInvoke = vi.hoisted(() => vi.fn<(command: string, args: Record<string, unknown>) => Promise<unknown>>());
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

// Layout/painting and viewport geometry are fixtures. Selection, its synchronous
// playback bridge, provider, samplers and desktop transport remain real.
vi.mock("../initWasmAndFont", () => ({
  initWasmAndFont: (args: Parameters<typeof initWasmAndFont>[0]) => {
    args.backendRef.current = {
      hasRetainedScore: () => false,
      getScoreInfo: async () => ({
        measureCount: 1,
        partCount: 2,
        partNames: ["Hidden", "Clarinet"],
        scoreCount: 1,
        scoreNames: [],
      }),
    } as unknown as NonNullable<typeof args.backendRef.current>;
    args.setWasmReady(true);
    return () => {};
  },
}));
vi.mock("../computeDisplayList", () => ({
  computeDisplayListImpl: vi.fn(),
  prewarmPatchChain: async () => {},
}));
vi.mock("../paintScoreFrame", () => ({ paintScoreFrame: () => {} }));
vi.mock("../../InputCursor", () => ({ InputCursor: () => null }));
vi.mock("../../../hooks/useViewport", async () => {
  const { useRef } = await import("react");
  return {
    useViewport: () => ({
      viewport: { zoom: 1, scrollX: 0, scrollY: 0 },
      containerRef: useRef(null),
      dragLockRef: useRef(false),
      isDragging: false,
      resetViewport: vi.fn(),
      setZoom: vi.fn(),
      setScroll: vi.fn(),
    }),
  };
});

function sourceScore(collapsed = true): Score {
  return freeze(
    {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            time: { count: 4, unit: 4 },
            tempos: [{ bpm: 120, value: { base: "quarter" } }],
            chordSymbols: [{ position: { fraction: [0, 1] }, root: { step: "C" }, bass: { step: "E" } }],
          },
        ],
      },
      parts: [
        { id: "hidden", name: "Flute", measures: [], chordSymbolVisibility: "hide" },
        {
          id: "clarinet",
          name: "Clarinet",
          chordSymbolVisibility: "show",
          transposition: { interval: { halfSteps: 2, staffDistance: 1 } },
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      type: "event",
                      id: "note",
                      duration: { base: "whole" },
                      notes: [{ pitch: { step: "D", octave: 4 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      layouts: [
        {
          id: "collapsed",
          content: collapsed
            ? [{ type: "staff", sources: [{ part: "hidden" }, { part: "clarinet" }] }]
            : [
                { type: "staff", sources: [{ part: "hidden" }] },
                { type: "staff", sources: [{ part: "clarinet" }] },
              ],
        },
      ],
      scores: [{ layout: "collapsed", useWritten: true }],
    } satisfies Score,
    true,
  );
}

function frame(id: string, collapsed = true): DisplayList {
  return {
    width: 800,
    height: 300,
    commands: [
      {
        type: "DrawText",
        text: "D/F♯",
        x: 100,
        y: 40,
        font: "serif",
        size: 20,
        color: "#000",
        align: "left",
        baseline: "alphabetic",
      },
    ],
    elementIds: [id],
    elementBboxes: [
      { elementId: id, bbox: { x: 100, y: 20, width: 60, height: 20 } },
      { elementId: "p1/m0/s0/note/n0", bbox: { x: 200, y: 65, width: 12, height: 10 } },
    ],
    measureBounds: [
      {
        index: 0,
        partIndex: 1,
        staffIndex: collapsed ? 0 : 1,
        sourcePartIndices: collapsed ? [0, 1] : [1],
        x: 0,
        y: 50,
        width: 400,
        height: 40,
        prefixWidth: 0,
        totalBeats: 4,
        beatAnchors: [],
      },
    ],
  };
}

// A transport-port control. The device matrix below goes further, through the
// real desktop transport to the Tauri command boundary.
function recordingHost() {
  return {
    prepare: vi
      .fn<VstTransport["prepare"]>()
      .mockImplementation(async (_score, plan) => new Set(plan.sf2Parts.map(({ partIndex }) => partIndex))),
    start: vi.fn<VstTransport["start"]>().mockResolvedValue(undefined),
    stop: vi.fn<VstTransport["stop"]>().mockResolvedValue(undefined),
    seek: vi.fn<VstTransport["seek"]>().mockResolvedValue(undefined),
    setPartGain: vi.fn<VstTransport["setPartGain"]>().mockResolvedValue(undefined),
    setMutedParts: vi.fn<VstTransport["setMutedParts"]>().mockResolvedValue(undefined),
    previewNote: vi.fn<VstTransport["previewNote"]>().mockResolvedValue(true),
    previewChord: vi.fn<NonNullable<VstTransport["previewChord"]>>().mockResolvedValue(true),
    release: vi.fn<VstTransport["release"]>().mockResolvedValue(undefined),
  } satisfies VstTransport;
}

let store: DocumentStore;
let mixer: { state: ReturnType<typeof useMixer>; actions: ReturnType<typeof useMixerActions> };
const soundfontLoader = { load: async () => new TextEncoder().encode("RIFF0000sfbk").buffer };
function NotePreviewBridge() {
  useNotePreview();
  const state = useMixer();
  const actions = useMixerActions();
  useEffect(() => {
    mixer = { state, actions };
  }, [state, actions]);
  return null;
}

interface PlaybackDevice {
  audioRenderMode: "web" | "native";
  host?: VstTransport;
}

function Harness({ host, mode, audioRenderMode }: PlaybackDevice & { mode: "write" | "engrave" }) {
  const documentStore = useDocumentStoreApi();
  const score = useDocumentStore((state) => state.score);
  useEffect(() => {
    store = documentStore;
  }, [documentStore]);
  return (
    <PlaybackProvider
      score={score}
      audioRenderMode={audioRenderMode}
      vstTransport={host}
      soundfontLoader={soundfontLoader}
    >
      <MixerSyncBridge score={score} />
      <SelectionPlaybackBridge />
      <NotePreviewBridge />
      <ScoreCanvas viewMode="horizon" initialZoom={1} interactionMode={mode} />
    </PlaybackProvider>
  );
}

async function mount(id: string, mode: "write" | "engrave", collapsed = true, device?: PlaybackDevice) {
  const score = sourceScore(collapsed);
  const host = recordingHost();
  vi.mocked(computeDisplayListImpl).mockResolvedValue(frame(id, collapsed));
  const ui = () => (
    <DocumentProvider>
      <Harness {...(device ?? { host, audioRenderMode: "native" })} mode={mode} />
    </DocumentProvider>
  );
  const view = render(ui());
  await act(async () =>
    store.setState({
      score,
      workingScore: score,
      mnxJson: JSON.stringify(serializeMnx(score)),
    }),
  );
  await waitFor(() => expect(view.container.textContent).not.toContain("Loading score"));
  // A ready timeline makes the real selection subscription seek, rather than
  // accidentally hiding the regression behind measureBeatToSeconds === null.
  await waitFor(() => expect(getPlaybackSnapshot().state.duration).toBe(2));
  await waitFor(() => expect(getPlaybackSnapshot().actions.measureBeatToSeconds(0, 0)).toBe(0));
  return { ...view, host, score, ui, canvas: screen.getByRole("application") };
}

const pointer = { pointerId: 1, pointerType: "mouse", button: 0, clientX: 110, clientY: 30 };
async function click(canvas: HTMLElement, point = pointer) {
  fireEvent.pointerDown(canvas, point);
  fireEvent.mouseDown(canvas, point);
  fireEvent.pointerUp(canvas, point);
  fireEvent.mouseUp(canvas, point);
  await act(async () => {
    fireEvent.click(canvas, point);
  });
}

const synths: ReturnType<typeof recordingSynth>[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  synths.length = 0;
  vi.stubGlobal("AudioContext", ChordAudioDevice);
  vi.spyOn(Sf2Synth, "create").mockImplementation(async (context) => {
    const synth = recordingSynth(context);
    synths.push(synth);
    return synth as unknown as Sf2Synth;
  });
  nativeInvoke
    .mockReset()
    .mockImplementation(async (command) => (command === "vst_soundfont_path" ? "F:\\sounds\\test.sf2" : undefined));
  invalidateVstHostMirror();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new TextEncoder().encode("RIFF0000sfbk"))),
  );
  useSelectionStore.setState(useSelectionStore.getInitialState());
  useViewStateStore.setState({ selectedScoreIndex: 0, selectedPartIds: [] });
});
afterEach(async () => {
  await act(async () => cleanup());
  await act(async () => mixer.actions.reset());
  useSelectionStore.setState(useSelectionStore.getInitialState());
  // Actions survive unmount in the public singleton. Publish a device-free real
  // provider so the next test's first mixer effects cannot target the old host.
  await act(async () => {
    render(<PlaybackProvider audioRenderMode="web">{null}</PlaybackProvider>);
  });
  await act(async () => cleanup());
  vi.useRealTimers();
  await vi.dynamicImportSettled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function desktopDevice(): PlaybackDevice {
  vi.stubGlobal("__TAURI_INTERNALS__", { invoke: nativeInvoke });
  const host = createDesktopVstTransport();
  expect(host).toBeDefined();
  return { audioRenderMode: "native", host };
}

function nativeCalls(command: string) {
  return nativeInvoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args);
}

function piano() {
  const found = synths.find((entry) => entry.synth.programChange.mock.calls.some(([, program]) => program === 0));
  expect(found).toBeDefined();
  return found!;
}

function webNotes() {
  return synths.flatMap(({ synth }) => synth.noteOn.mock.calls.map(([, note]) => note));
}

async function advanceAudio(milliseconds: number) {
  for (const context of new Set(synths.map((synth) => synth.context))) {
    Object.assign(context, { currentTime: context.currentTime + milliseconds / 1000 });
  }
  await act(async () => vi.advanceTimersByTimeAsync(milliseconds));
}

function assertWebChord(start: number, notes: number[]) {
  const recorded = piano();
  const attacks = recorded.synth.noteOn.mock.calls.slice(-notes.length);
  const channel = attacks[0]![0];
  expect(attacks).toEqual(notes.map((note) => [channel, note, 80, { time: start }]));
  expect(recorded.synth.noteOff.mock.calls.slice(-notes.length)).toEqual(
    notes.map((note) => [channel, note, { time: start + 3 }]),
  );
  expect(recorded.synth.programChange).toHaveBeenCalledWith(channel, 0);
  expect(recorded.synth.midiChannels[channel]!.setDrums).not.toHaveBeenCalledWith(true);
  expect(recorded.synth.controllerChange).toHaveBeenCalledWith(channel, 64, 0);
  expect(recorded.synth.controllerChange).toHaveBeenCalledWith(channel, 66, 0);
  expect(synths.some(({ synth }) => synth.programChange.mock.calls.some(([, program]) => program === 71))).toBe(true);
  expect(getPlaybackSnapshot().state.partPatches).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ partName: "Clarinet", gmProgram: 71 }),
      expect.objectContaining({ partName: "Chords", gmProgram: 0 }),
    ]),
  );
}

function audioActivity() {
  return {
    nativePreviews: nativeCalls("vst_playback_preview_chord"),
    nativeStops: nativeCalls("vst_playback_stop"),
    synths: synths.map((entry) => ({
      attacks: entry.synth.noteOn.mock.calls.length,
      offs: entry.synth.noteOff.mock.calls.length,
      releaseControls: entry.synth.controllerChange.mock.calls.filter(([, cc]) => [64, 66, 120, 123].includes(cc))
        .length,
      cancellations: entry.cancelScheduledNotes.mock.calls.length,
      panics: entry.synth.stopAll.mock.calls.length,
      destroyed: entry.destroy.mock.calls.length,
      mutes: entry.synth.midiChannels.map((channel) => channel.setSystemParameter.mock.calls.length),
    })),
  };
}

async function suppressDrags(canvas: HTMLElement) {
  for (const gesture of ["away", "return", "cancel"]) {
    fireEvent.pointerDown(canvas, pointer);
    fireEvent.pointerMove(canvas, { ...pointer, clientX: 130 });
    if (gesture === "return") fireEvent.pointerMove(canvas, pointer);
    if (gesture === "cancel") fireEvent.pointerCancel(canvas, pointer);
    else fireEvent.pointerUp(canvas, gesture === "away" ? { ...pointer, clientX: 130 } : pointer);
    await act(async () => fireEvent.click(canvas, pointer));
    expect(webNotes(), gesture).toEqual([]);
    expect(nativeCalls("vst_playback_preview_chord"), gesture).toEqual([]);
  }
}

describe.each(["web", "native"] as const)("%s device-boundary chord gestures", (audioRenderMode) => {
  describe.each(["write", "engrave"] as const)("%s mode", (mode) => {
    it.each(["m0/chord0", "m0/chord0/p0/staff0"])(
      "suppresses drags and gives every repeated %s click an independent piano hold",
      async (id) => {
        const device = audioRenderMode === "native" ? desktopDevice() : { audioRenderMode };
        const { canvas, score, ui, rerender } = await mount(id, mode, true, device);
        vi.useFakeTimers();
        await suppressDrags(canvas);
        const { leftHand, rightHand } = voiceChordSymbol(score.global.measures[0]!.chordSymbols![0]!);
        const notes = [...leftHand, ...rightHand];
        expect(notes).toEqual([40, 60, 64, 67]);
        expect(leftHand.every((note) => note >= 36 && note <= 47)).toBe(true);
        expect(rightHand.every((note) => note >= 60 && note <= 71)).toBe(true);
        for (let index = 0; index < 3; index++) {
          const start = synths[0]?.context.currentTime ?? 10;
          await click(canvas);
          await act(async () => {
            await vi.waitFor(() =>
              expect(
                audioRenderMode === "web"
                  ? webNotes().length / notes.length
                  : nativeCalls("vst_playback_preview_chord").length,
              ).toBe(index + 1),
            );
          });
          expect(useSelectionStore.getState().selection).toMatchObject({
            kind: "single",
            elementId: id,
            elementType: "chord-symbol",
            measureAnchor: { partIndex: 1, staffIndex: 0 },
          });
          if (audioRenderMode === "web") {
            expect(webNotes()).toEqual(Array.from({ length: index + 1 }, () => notes).flat());
            assertWebChord(start, notes);
            expect(nativeInvoke).not.toHaveBeenCalled();
          } else {
            expect(nativeCalls("vst_playback_preview_chord")).toEqual(
              Array.from({ length: index + 1 }, () => ({
                slotKey: CHORDS_PART_ID,
                partIndex: 2,
                notes,
                velocity: 80,
                durationMs: 3000,
              })),
            );
            expect(nativeCalls("vst_playback_load").at(-1)).toMatchObject({
              slots: expect.arrayContaining([
                expect.objectContaining({ slotKey: "sf2:1", kind: "sf2", program: 71 }),
                expect.objectContaining({ slotKey: CHORDS_PART_ID, kind: "sf2", program: 0, isDrum: false }),
              ]),
            });
            expect(synths).toEqual([]);
          }
          const active = audioActivity();
          rerender(ui());
          await act(async () => {
            await getGlobalPerfTracker().fastLayoutCallback?.(store.getState().mnxJson);
          });
          expect(audioActivity()).toEqual(active);
          // Cross the previous 38ms cancellation and the full key-hold deadline.
          // The device owns scheduled note-offs/release; no JS panic may cut it.
          await advanceAudio(2999);
          expect(audioActivity()).toEqual(active);
          await advanceAudio(1);
          expect(audioActivity()).toEqual(active);
          await advanceAudio(1000);
          expect(audioActivity()).toEqual(active);
          expect(getPlaybackSnapshot().state.status).toBe("stopped");
          expect(nativeCalls("vst_playback_start")).toEqual([]);
          expect(nativeCalls("vst_playback_preview")).toEqual([]);
        }
      },
    );
  });
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("finishes the selection's native seek before sounding its chord", async () => {
  const { canvas } = await mount("m0/chord0", "write", true, desktopDevice());
  const seek = gate();
  const invoke = nativeInvoke.getMockImplementation()!;
  let sounding = false;
  nativeInvoke.mockImplementation(async (command, args) => {
    if (command === "vst_playback_seek") {
      await seek.promise;
      // The native host's seek cancels all outstanding preview notes.
      sounding = false;
    }
    if (command === "vst_playback_preview_chord") sounding = true;
    return invoke(command, args);
  });
  try {
    await click(canvas);
    await act(async () => vi.dynamicImportSettled());
    expect(nativeCalls("vst_playback_seek")).toHaveLength(1);
    const attacksBeforeSeek = nativeCalls("vst_playback_preview_chord").length;
    await act(async () => seek.resolve());
    await waitFor(() => expect(nativeCalls("vst_playback_preview_chord")).toHaveLength(1));
    expect(sounding).toBe(true);
    expect(attacksBeforeSeek).toBe(0);
  } finally {
    seek.resolve();
    await vi.dynamicImportSettled();
  }
});

it("waits for delayed desktop loading and every latest mute write before the pointer audition", async () => {
  const { canvas } = await mount("m0/chord0/p0/staff0", "write", true, desktopDevice());
  const load = gate();
  const writes: Array<ReturnType<typeof gate> & { parts: number[] }> = [];
  let holdMutes = false;
  let appliedParts: number[] = [];
  const soundedWith: number[][] = [];
  const invoke = nativeInvoke.getMockImplementation()!;
  nativeInvoke.mockImplementation(async (command, args) => {
    if (command === "vst_playback_load") {
      holdMutes = true;
      await load.promise;
    }
    if (command === "vst_playback_set_muted") {
      const parts = [...(args.parts as number[])];
      if (holdMutes) {
        const write = { ...gate(), parts };
        writes.push(write);
        await write.promise;
      }
      appliedParts = parts;
    }
    if (command === "vst_playback_preview_chord") soundedWith.push([...appliedParts]);
    return invoke(command, args);
  });
  try {
    await click(canvas);
    await waitFor(() => expect(nativeCalls("vst_playback_load")).toHaveLength(1));
    expect(soundedWith).toEqual([]);
    act(() => mixer.actions.toggleMute(0));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.parts).toEqual([0]);
    expect(soundedWith).toEqual([]);
    await act(async () => load.resolve());
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]!.parts).toEqual([0]);
    act(() => mixer.actions.toggleMute(1));
    await waitFor(() => expect(writes).toHaveLength(3));
    expect(writes[2]!.parts).toEqual([0, 1]);
    expect(soundedWith).toEqual([]);
    await act(async () => {
      writes[0]!.resolve();
      writes[1]!.resolve();
      writes[2]!.resolve();
    });
    await waitFor(() => expect(writes).toHaveLength(4));
    expect(writes[3]!.parts).toEqual([0, 1]);
    expect(soundedWith).toEqual([]);
    // Edit again while the post-prepare barrier itself is in flight. Its old
    // snapshot must not become the final mute state just because it finishes last.
    act(() => mixer.actions.toggleMute(0));
    await waitFor(() => expect(writes).toHaveLength(5));
    expect(writes[4]!.parts).toEqual([1]);
    await act(async () => {
      writes[4]!.resolve();
      writes[3]!.resolve();
    });
    await waitFor(() => expect(writes).toHaveLength(6));
    expect(writes[5]!.parts).toEqual([1]);
    expect(soundedWith).toEqual([]);
    await act(async () => writes[5]!.resolve());
    await waitFor(() => expect(soundedWith).toEqual([[1]]));
    expect(nativeCalls("vst_playback_preview_chord")).toEqual([
      { slotKey: CHORDS_PART_ID, partIndex: 2, notes: [40, 60, 64, 67], velocity: 80, durationMs: 3000 },
    ]);
    expect(synths).toEqual([]);
  } finally {
    holdMutes = false;
    load.resolve();
    for (const write of writes) write.resolve();
    await vi.dynamicImportSettled();
  }
});

it.each(["m0/chord0", "m0/chord0/p1/staff1", "p1/m0/s0/note/n0"])(
  "clears a whole-measure filter on %s without changing explicit mute/solo",
  async (id) => {
    const { canvas, host } = await mount(id.startsWith("m0/") ? id : "m0/chord0", "write", false);
    act(() => {
      mixer.actions.toggleMute(0);
      mixer.actions.toggleSolo(1);
      mixer.actions.toggleSolo(2);
    });
    const explicitMix = mixer.state.channels;
    expect(host.setMutedParts).toHaveBeenLastCalledWith(new Set([0]));
    await click(canvas, { ...pointer, clientX: 350, clientY: 75 });
    expect(useSelectionStore.getState().selection.kind).toBe("measure");
    expect(host.setMutedParts).toHaveBeenLastCalledWith(new Set([0, 2]));
    await click(canvas, id.startsWith("p1/") ? { ...pointer, clientX: 205, clientY: 70 } : pointer);
    expect(useSelectionStore.getState().selection).toMatchObject({ kind: "single", elementId: id });
    expect(host.setMutedParts).toHaveBeenLastCalledWith(new Set([0]));
    expect(mixer.state.channels).toBe(explicitMix);
    if (id.startsWith("p1/")) {
      expect(host.previewNote).toHaveBeenCalledExactlyOnceWith(1, 62, 80, 400);
      expect(host.previewChord).not.toHaveBeenCalled();
    } else {
      expect(host.previewChord).toHaveBeenCalledExactlyOnceWith(2, [40, 60, 64, 67], 80, 3000);
      expect(host.previewNote).not.toHaveBeenCalled();
    }
  },
);

it("records a direct real-provider audition as a native-boundary control", async () => {
  const { host, score } = await mount("m0/chord0", "write");
  await act(async () => {
    await getPlaybackSnapshot().actions.previewChord(score.global.measures[0]!.chordSymbols![0]!, score);
  });
  expect(host.previewChord).toHaveBeenCalledExactlyOnceWith(2, [40, 60, 64, 67], 80, 3000);
});

describe.each(["write", "engrave"] as const)("real chord playback from %s pointer gestures", (mode) => {
  it.each(["m0/chord0", "m0/chord0/p0/staff0"])(
    "auditions first and repeated clicks on %s at the native piano boundary",
    async (id) => {
      const { canvas, host, score, ui, rerender } = await mount(id, mode);
      const { leftHand, rightHand } = voiceChordSymbol(score.global.measures[0]!.chordSymbols![0]!);
      expect(leftHand.length).toBeGreaterThan(0);
      expect(rightHand.length).toBeGreaterThan(0);
      expect(leftHand.every((pitch) => pitch >= 36 && pitch <= 47)).toBe(true);
      expect(rightHand.every((pitch) => pitch >= 60 && pitch <= 71)).toBe(true);
      for (let index = 0; index < 3; index++) {
        await click(canvas);
        expect(useSelectionStore.getState().selection).toMatchObject({
          kind: "single",
          elementId: id,
          elementType: "chord-symbol",
        });
        expect.soft(host.previewChord, `click ${index + 1} on ${id}`).toHaveBeenCalledTimes(index + 1);
        expect.soft(host.previewChord).toHaveBeenLastCalledWith(2, [...leftHand, ...rightHand], 80, 3000);
      }
      expect.soft(host.prepare.mock.calls.at(-1)?.[1].sf2Parts ?? []).toContainEqual({
        partIndex: 2,
        program: 0,
        isDrum: false,
      });
      expect(host.previewNote).not.toHaveBeenCalled();
      expect(host.start).not.toHaveBeenCalled();
      const count = host.previewChord.mock.calls.length;
      const stops = host.stop.mock.calls.length;
      rerender(ui());
      await act(async () => {
        await getGlobalPerfTracker().fastLayoutCallback?.(store.getState().mnxJson);
      });
      expect(host.previewChord).toHaveBeenCalledTimes(count);
      expect(host.stop).toHaveBeenCalledTimes(stops);
    },
  );
});
