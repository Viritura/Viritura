import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHORDS_PART_ID, voiceChordSymbol, type Score } from "@viritura/core";
import type { PerformanceEvent } from "@viritura/midi";
import type { VstPreparePlan } from "@viritura/playback";
import type { FxChainsConfig } from "./fxChainStore";
import chordMidiFixture from "../../../desktop/src-tauri/tests/fixtures/derived-chords-midi.json";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  compileMapper: vi.fn<(events: PerformanceEvent[]) => ScheduledEvent[]>(),
  fx: vi.fn<() => FxChainsConfig>(),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("./profileHostBridge", () => ({ isDesktopHost: () => true }));
vi.mock("./instrumentProfileStore", () => ({
  readInstrumentProfileState: vi.fn(),
  useInstrumentProfileStore: {
    getState: () => ({
      profiles: [
        {
          id: "profile",
          slots: ["piano", "strings", "winds"].map((slotId) => ({
            slotId,
            label: slotId,
            binding: { pluginPath: `F:\\plugins\\${slotId}.vst3`, luaScriptPath: "F:\\mappers\\piano.lua" },
          })),
        },
      ],
    }),
  },
}));
vi.mock("./fxChainStore", () => ({
  readFxChains: mocks.fx,
  useFxChainStore: { getState: () => ({ ensureReverbSeeded() {} }) },
}));
vi.mock("./fxChainState", () => ({ readFxPluginState: vi.fn() }));
vi.mock("../store/backgroundTaskStore", () => ({
  beginBackgroundTask: () => "load",
  updateBackgroundTask() {},
  endBackgroundTask() {},
}));

interface StripControls {
  gain: number;
  pan: number;
  reverbSend: number;
}

interface LoadSlot extends StripControls {
  slotKey: string;
  events: (ScheduledEvent & { part: number })[];
}

interface ScheduledEvent {
  atSeconds: number;
  type: string;
  note_id: string;
  channel: number;
  note: number;
  velocity: number;
}

function score(step: "C" | "D" = "C", octave = 4): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "note",
                    duration: { base: "whole" },
                    notes: [{ pitch: { step, octave } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function plan(kind: "vst" | "sf2"): VstPreparePlan {
  return kind === "sf2"
    ? { vstParts: [], sf2Parts: [{ partIndex: 0, program: 0, isDrum: false }] }
    : {
        vstParts: [
          {
            partIndex: 0,
            vst: { id: "piano", kind: "vst", hostProfileId: "profile", instrumentSlot: "piano", midiChannel: 0 },
          },
        ],
        sf2Parts: [],
      };
}

function chordFixture() {
  const document = score();
  document.global.measures[0] = {
    time: { count: 4, unit: 4 },
    tempos: [{ bpm: 120, value: { base: "quarter" } }],
    repeatStart: {},
    repeatEnd: { times: 2 },
    chordSymbols: [{ root: { step: "C" }, position: { fraction: [0, 1] } }],
  };
  const preparation: VstPreparePlan = {
    vstParts: [],
    sf2Parts: [
      { partIndex: 0, program: 73, isDrum: false },
      { partIndex: document.parts.length, program: 0, isDrum: false },
    ],
  };
  return { document, preparation };
}

function selectionFixture(kind: "vst" | "sf2" | "shared vst", step: "C" | "D" = "C") {
  const document = score(step);
  document.parts = [0, 1, 2].map((partIndex) => ({
    ...score(step, 4 + partIndex).parts[0]!,
    id: `part-${partIndex}`,
  }));
  const slotIds = kind === "shared vst" ? ["piano", "piano", "piano"] : ["piano", "strings", "winds"];
  const preparation: VstPreparePlan =
    kind === "sf2"
      ? { vstParts: [], sf2Parts: [0, 1, 2].map((partIndex) => ({ partIndex, program: 0, isDrum: false })) }
      : {
          vstParts: slotIds.map((instrumentSlot, partIndex) => ({
            partIndex,
            vst: { ...plan("vst").vstParts[0]!.vst, instrumentSlot, midiChannel: partIndex },
          })),
          sf2Parts: [],
        };
  const slotKeys = slotIds.map((slotId, partIndex) => (kind === "sf2" ? `sf2:${partIndex}` : `profile:${slotId}`));
  return { document, preparation, slotKeys };
}

function mockMultitimbralMapper() {
  // Channels come from this mapper stub, not the transport. Only the native
  // invocation payloads are tested here; no plugin or native dispatch runs.
  mocks.compileMapper.mockImplementation((events) =>
    events.flatMap((event) =>
      event.kind === "noteOn" || event.kind === "noteOff"
        ? [
            {
              atSeconds: event.time,
              type: event.kind === "noteOn" ? "note_on" : "note_off",
              note_id: event.note.id,
              channel: Math.floor(event.note.pitch / 12) - 5,
              note: event.note.pitch,
              velocity: 100,
            },
          ]
        : [],
    ),
  );
}

describe("native mixer reconciliation", () => {
  let strips: Map<string, StripControls>;
  let muted: Set<number>;
  let fx: FxChainsConfig;
  let duringLoad: (() => Promise<void>) | undefined;
  let wet: number;

  beforeEach(() => {
    vi.resetModules();
    mocks.invoke.mockReset();
    mocks.compileMapper.mockReset().mockReturnValue([]);
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: mocks.invoke });
    strips = new Map();
    muted = new Set();
    duringLoad = undefined;
    wet = 0;
    fx = {
      reverb: {
        plugins: [{ id: "reverb", pluginPath: "F:\\plugins\\reverb.vst3", pluginName: "Reverb", stateVersion: 0 }],
        send: 0.25,
        wet: 0.3,
      },
      master: { plugins: [] },
    };
    mocks.fx.mockImplementation(() => fx);
    // Model the host's important behavior: absent strips ignore live setters,
    // and loading either a new or reused strip overwrites its load-time controls.
    mocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      switch (command) {
        case "vst_soundfont_path":
          return "F:\\fonts\\piano.sf2";
        case "vst_compile_mapper":
          return mocks.compileMapper(args.events as PerformanceEvent[]);
        case "vst_playback_load":
          await duringLoad?.();
          for (const slot of args.slots as LoadSlot[]) {
            strips.set(slot.slotKey, {
              gain: slot.gain ?? 1,
              pan: slot.pan ?? 0,
              reverbSend: slot.reverbSend ?? 0,
            });
          }
          break;
        case "vst_playback_set_gain": {
          const strip = strips.get(args.slotKey as string);
          if (strip) strip.gain = args.gain as number;
          break;
        }
        case "vst_playback_set_pan": {
          const strip = strips.get(args.slotKey as string);
          if (strip) strip.pan = args.pan as number;
          break;
        }
        case "vst_playback_set_muted":
          if (strips.size) muted = new Set(args.parts as number[]);
          break;
        case "vst_playback_set_reverb_levels":
          for (const strip of strips.values()) strip.reverbSend = args.send as number;
          wet = args.wet as number;
          break;
        case "vst_playback_retain":
          for (const key of strips.keys()) if (!(args.keys as string[]).includes(key)) strips.delete(key);
          break;
        case "vst_playback_release":
          strips.clear();
          break;
      }
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("routes the real global repeat timeline to the shared Rust SF2 fixture without a persisted Part", async () => {
    const { document, preparation } = chordFixture();
    const original = structuredClone(document);
    const { createVstTransport } = await import("./vstTransport");
    const owned = await createVstTransport()!.prepare(document, preparation);
    expect(owned).toEqual(new Set([0, document.parts.length]));
    const slots = mocks.invoke.mock.calls.find(([command]) => command === "vst_playback_load")?.[1]
      ?.slots as LoadSlot[];
    const chords = slots.find((slot) => slot.slotKey === CHORDS_PART_ID)!;
    expect(chords).toMatchObject({
      kind: "sf2",
      program: 0,
      isDrum: false,
      pluginPath: "",
      soundfontPath: "F:\\fonts\\piano.sf2",
    });
    // The Rust routing test deserializes this exact payload and renders its GM0
    // schedule, including the second repeat visit and final release.
    expect(chords.events).toEqual(chordMidiFixture);
    expect(mocks.compileMapper).not.toHaveBeenCalled();
    expect(document).toEqual(original);
  });

  it("retains chord controls across stop, seek, edits, removal and restore independently of authored parts", async () => {
    const { document, preparation } = chordFixture();
    const { createVstTransport } = await import("./vstTransport");
    const transport = createVstTransport()!;
    await transport.setPartGain(1, 0.3);
    await transport.setMutedParts(new Set([1]));
    await transport.prepare(document, preparation);
    await transport.start(0);
    await transport.seek(2.5);
    await transport.stop();
    document.global.measures[0]!.chordSymbols![0]!.root = { step: "D" };
    await transport.prepare(document, preparation);
    expect(strips.get(CHORDS_PART_ID)?.gain).toBe(0.3);
    expect(strips.get("sf2:0")?.gain).toBe(1);
    expect(muted).toEqual(new Set([1]));
    const symbols = document.global.measures[0]!.chordSymbols;
    delete document.global.measures[0]!.chordSymbols;
    await transport.prepare(document, preparation);
    expect(strips.has(CHORDS_PART_ID)).toBe(false);
    document.global.measures[0]!.chordSymbols = symbols;
    await transport.prepare(document, preparation);
    expect(strips.get(CHORDS_PART_ID)?.gain).toBe(0.3);
    expect(muted).toEqual(new Set([1]));
    await transport.release();
    await transport.prepare(document, preparation);
    expect(strips.get(CHORDS_PART_ID)?.gain).toBe(0.3);
    // Soloing Chords is an effective mute of the authored part, not of the lane.
    await transport.setMutedParts(new Set([0]));
    expect(muted).toEqual(new Set([0]));
  });

  it("provisions unsupported global symbols as silent piano and rejects invalid or VST derived indices", async () => {
    const { document, preparation } = chordFixture();
    document.global.measures[0]!.chordSymbols = [{ rawText: "C7alt", position: { fraction: [0, 1] } }];
    const { createVstTransport } = await import("./vstTransport");
    const transport = createVstTransport()!;
    const owned = await transport.prepare(document, {
      vstParts: [{ ...plan("vst").vstParts[0]!, partIndex: 1 }],
      sf2Parts: [-1, 1, 2, 0.5].map((partIndex) => ({ partIndex, program: 48, isDrum: true })),
    });
    expect(owned).toEqual(new Set([1]));
    const slots = mocks.invoke.mock.calls.find(([command]) => command === "vst_playback_load")?.[1]
      ?.slots as LoadSlot[];
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ slotKey: CHORDS_PART_ID, program: 0, isDrum: false, events: [] });
    expect(mocks.compileMapper).not.toHaveBeenCalled();
    await transport.prepare(document, { ...preparation, sf2Parts: [] });
    expect(strips.size).toBe(0);
  });

  it("auditions the same piano voicing atomically and respects mixer mute and released ownership", async () => {
    const { document, preparation } = chordFixture();
    const { createVstTransport } = await import("./vstTransport");
    const transport = createVstTransport()!;
    const voice = voiceChordSymbol(document.global.measures[0]!.chordSymbols![0]!);
    const notes = [...voice.leftHand, ...voice.rightHand];
    expect(await transport.previewChord(1, notes, 80, 600)).toBe(false);
    await transport.prepare(document, preparation);
    for (let click = 0; click < 2; click++) expect(await transport.previewChord(1, notes, 80, 600)).toBe(true);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "vst_playback_preview_chord")).toHaveLength(2);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "vst_playback_preview_chord",
      { slotKey: CHORDS_PART_ID, partIndex: 1, notes: [36, 60, 64, 67], velocity: 80, durationMs: 600 },
      undefined,
    );
    await transport.setMutedParts(new Set([1]));
    expect(await transport.previewChord(1, notes, 80, 600)).toBe(true);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "vst_playback_preview_chord")).toHaveLength(2);
    await transport.setMutedParts(new Set());
    await transport.release();
    expect(await transport.previewChord(1, notes, 80, 600)).toBe(false);
  });

  it("sends repeated score IDs as separate SF2 lifetimes without the VST mapper", async () => {
    const document = score();
    document.global.measures[0]!.repeatStart = {};
    document.global.measures[0]!.repeatEnd = { times: 2 };
    const { createVstTransport } = await import("./vstTransport");
    await createVstTransport()!.prepare(document, plan("sf2"));

    const load = mocks.invoke.mock.calls.find(([command]) => command === "vst_playback_load");
    const slots = load?.[1]?.slots as LoadSlot[];
    expect(slots).toHaveLength(1);
    expect(slots[0]!.slotKey).toBe("sf2:0");
    const notes = slots[0]!.events.filter((event) => event.type === "note_on" || event.type === "note_off");
    // The native resolver must pair occurrences, not overwrite by score ID.
    // Rust sf2_lifetimes tests render this repeated-ID shape with the bundled font.
    expect(notes.map(({ type, note_id, part }) => ({ type, note_id, part }))).toEqual([
      { type: "note_on", note_id: "note", part: 0 },
      { type: "note_off", note_id: "note", part: 0 },
      { type: "note_on", note_id: "note", part: 0 },
      { type: "note_off", note_id: "note", part: 0 },
    ]);
    expect(notes[1]!.atSeconds).toBeGreaterThan(notes[0]!.atSeconds);
    expect(notes[2]!.atSeconds).toBeGreaterThanOrEqual(notes[1]!.atSeconds);
    expect(notes[3]!.atSeconds).toBeGreaterThan(notes[2]!.atSeconds);
    expect(mocks.compileMapper).not.toHaveBeenCalled();
  });

  it.each(["vst", "sf2"] as const)("reapplies %s controls on cold load, reload and restart", async (kind) => {
    const { createVstTransport, invalidateVstHostMirror } = await import("./vstTransport");
    const transport = createVstTransport()!;
    await transport.setPartGain(0, 0.35);
    await transport.setPartPan(0, -0.6);
    await transport.setMutedParts(new Set([0, 1]));
    expect(strips.size).toBe(0);

    const assertMix = () => {
      expect([...strips.values()]).toEqual([{ gain: 0.35, pan: -0.6, reverbSend: 0.25 }]);
      expect(muted).toEqual(new Set([0, 1]));
      expect(wet).toBe(0.3);
    };
    await transport.prepare(score(), plan(kind));
    const load = mocks.invoke.mock.calls.find(([command]) => command === "vst_playback_load");
    expect(load?.[1]).toMatchObject({ slots: [{ gain: 0.35, pan: -0.6 }] });
    assertMix();
    await transport.start(0);
    await transport.stop();
    await transport.prepare(score("D"), plan(kind));
    await transport.start(0);
    assertMix();

    const loadCount = mocks.invoke.mock.calls.filter(([command]) => command === "vst_playback_load").length;
    await transport.prepare(score("D"), plan(kind));
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "vst_playback_load")).toHaveLength(loadCount);
    assertMix();

    strips.clear();
    muted.clear();
    invalidateVstHostMirror();
    await transport.prepare(score(), plan(kind));
    assertMix();
    await transport.release();
    await transport.prepare(score(), plan(kind));
    assertMix();
  });

  it.each(["vst", "sf2"] as const)("uses the latest %s controls changed during slow loading", async (kind) => {
    const { createVstTransport } = await import("./vstTransport");
    const transport = createVstTransport()!;
    await transport.setPartGain(0, 0.8);
    await transport.setPartPan(0, 0.5);
    await transport.setMutedParts(new Set([0]));
    duringLoad = async () => {
      await transport.setPartGain(0, 0.2);
      await transport.setPartPan(0, -0.75);
      await transport.setMutedParts(new Set([1]));
      fx = { ...fx, reverb: { ...fx.reverb, send: 0.6, wet: 0.7 } };
    };
    await transport.prepare(score(), plan(kind));
    expect([...strips.values()]).toEqual([{ gain: 0.2, pan: -0.75, reverbSend: 0.6 }]);
    expect(muted).toEqual(new Set([1]));
    expect(wet).toBe(0.7);
  });

  it.each(["vst", "sf2"] as const)("suppresses muted and solo-excluded %s previews after reload", async (kind) => {
    const { createVstTransport } = await import("./vstTransport");
    const transport = createVstTransport()!;
    await transport.setPartGain(0, 0.35);
    await transport.prepare(score(), plan(kind));
    await transport.start(0);
    await transport.stop();
    // The provider represents both a muted strip and a solo-excluded strip in this set.
    await transport.setMutedParts(new Set([0]));
    await transport.prepare(score("D"), plan(kind));
    mocks.invoke.mockClear();
    expect(await transport.previewNote(0, 60, 100, 200)).toBe(true);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "vst_playback_preview")).toHaveLength(0);
    await transport.setMutedParts(new Set());
    expect(await transport.previewNote(0, 60, 100, 200)).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("vst_playback_preview", expect.objectContaining({ note: 60 }), undefined);
  });

  it("carries live controls across SF2/VST replacement and permits explicit defaults", async () => {
    const { createVstTransport } = await import("./vstTransport");
    const transport = createVstTransport()!;
    await transport.prepare(score(), plan("sf2"));
    await transport.setPartGain(0, 0);
    await transport.setPartPan(0, 1);
    await transport.setMutedParts(new Set([0]));
    await transport.prepare(score(), plan("vst"));
    expect([...strips.keys()]).toEqual(["profile:piano"]);
    expect([...strips.values()]).toEqual([{ gain: 0, pan: 1, reverbSend: 0.25 }]);
    expect(muted).toEqual(new Set([0]));

    await transport.setPartGain(0, 1);
    await transport.setPartPan(0, 0);
    await transport.setMutedParts(new Set());
    fx.reverb.plugins = [];
    await transport.prepare(score(), plan("sf2"));
    expect([...strips.values()]).toEqual([{ gain: 1, pan: 0, reverbSend: 0 }]);
    expect(muted.size).toBe(0);
  });

  it("keeps the last live gain and pan for a shared VST strip on replay", async () => {
    const { createVstTransport } = await import("./vstTransport");
    const transport = createVstTransport()!;
    const sharedScore = score();
    sharedScore.parts.push(structuredClone(sharedScore.parts[0]!));
    const assignment = plan("vst").vstParts[0]!;
    const sharedPlan = { vstParts: [assignment, { ...assignment, partIndex: 1 }], sf2Parts: [] };
    await transport.prepare(sharedScore, sharedPlan);
    await transport.setPartGain(0, 0.8);
    await transport.setPartGain(1, 0.4);
    await transport.setPartGain(0, 0.6);
    await transport.setPartPan(1, -0.5);
    await transport.setPartPan(0, 0.5);
    await transport.setPartPan(1, -1);
    await transport.prepare(sharedScore, sharedPlan);
    expect([...strips.values()]).toEqual([{ gain: 0.6, pan: -1, reverbSend: 0.25 }]);
  });

  it.each(["vst", "sf2", "shared vst"] as const)(
    "sends effective per-part %s mutes before starts after prepare, reload and host invalidation",
    async (kind) => {
      const { createVstTransport, invalidateVstHostMirror } = await import("./vstTransport");
      const transport = createVstTransport()!;
      mockMultitimbralMapper();
      const { document, preparation, slotKeys } = selectionFixture(kind);
      // Provider output for raw mixer mute {1} and selectionPartIds {"part-0"}.
      // Union derivation belongs to provider tests, not this transport seam.
      await transport.setMutedParts(new Set([1, 2]));
      expect(strips.size).toBe(0);

      const prepareAndStart = async (nextScore: Score, reload: boolean) => {
        mocks.invoke.mockClear();
        expect(await transport.prepare(nextScore, preparation)).toEqual(new Set([0, 1, 2]));
        await transport.start(0.5);
        const loads = mocks.invoke.mock.calls.filter(([command]) => command === "vst_playback_load");
        expect(loads).toHaveLength(reload ? 1 : 0);
        if (reload) {
          expect(
            mocks.invoke.mock.calls.findIndex(([command]) => command === "vst_playback_set_muted"),
          ).toBeGreaterThan(mocks.invoke.mock.calls.findIndex(([command]) => command === "vst_playback_load"));
          const slots = loads[0]![1].slots as LoadSlot[];
          expect(slots.map((slot) => slot.slotKey)).toEqual([...new Set(slotKeys)]);
          // Excluded parts stay scheduled so a live selection clear needs no reload.
          for (const partIndex of [0, 1, 2]) {
            const slot = slots.find((entry) => entry.slotKey === slotKeys[partIndex])!;
            expect(slot.events).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  part: partIndex,
                  type: "note_on",
                  channel: kind === "sf2" ? 0 : partIndex,
                }),
                expect.objectContaining({ part: partIndex, type: "note_off" }),
              ]),
            );
          }
        }
        expect(
          mocks.invoke.mock.calls.filter(([command]) =>
            ["vst_playback_set_muted", "vst_playback_start", "vst_playback_stop", "vst_playback_seek"].includes(
              command,
            ),
          ),
        ).toEqual([
          ["vst_playback_set_muted", { parts: [1, 2] }, undefined],
          ["vst_playback_start", { originSeconds: 0.5 }, undefined],
        ]);
      };

      await prepareAndStart(document, true);
      await transport.stop();
      const revised = selectionFixture(kind, "D").document;
      await prepareAndStart(revised, true);
      await transport.stop();
      await prepareAndStart(revised, false);
      await transport.stop();
      strips.clear();
      muted.clear();
      invalidateVstHostMirror();
      await prepareAndStart(revised, true);
    },
  );

  it.each(["vst", "sf2", "shared vst"] as const)(
    "restores the latest raw %s mixer mutes on live selection clear without transport commands",
    async (kind) => {
      const { createVstTransport } = await import("./vstTransport");
      const transport = createVstTransport()!;
      const { document, preparation, slotKeys } = selectionFixture(kind);
      mockMultitimbralMapper();
      await transport.setMutedParts(new Set([1, 2]));
      await transport.prepare(document, preparation);
      await transport.start(0.5);
      mocks.invoke.mockClear();
      expect(await transport.previewNote(0, 60, 100, 200)).toBe(true);
      expect(await transport.previewNote(1, 72, 100, 200)).toBe(true);
      expect(await transport.previewNote(2, 84, 100, 200)).toBe(true);
      expect(mocks.invoke.mock.calls).toEqual([
        [
          "vst_playback_preview",
          { slotKey: slotKeys[0], partIndex: 0, note: 60, velocity: 100, durationMs: 200 },
          undefined,
        ],
      ]);

      mocks.invoke.mockClear();
      // Raw mixer mute changes to {0, 1} while selection still excludes {1, 2}.
      await transport.setMutedParts(new Set([0, 1, 2]));
      // Clearing selection supplies the latest raw mixer set, not an empty set.
      await transport.setMutedParts(new Set([0, 1]));
      expect(mocks.invoke.mock.calls).toEqual([
        ["vst_playback_set_muted", { parts: [0, 1, 2] }, undefined],
        ["vst_playback_set_muted", { parts: [0, 1] }, undefined],
      ]);

      mocks.invoke.mockClear();
      expect(await transport.previewNote(0, 60, 100, 200)).toBe(true);
      expect(await transport.previewNote(1, 72, 100, 200)).toBe(true);
      expect(await transport.previewNote(2, 84, 100, 200)).toBe(true);
      expect(mocks.invoke.mock.calls).toEqual([
        [
          "vst_playback_preview",
          { slotKey: slotKeys[2], partIndex: 2, note: 84, velocity: 100, durationMs: 200 },
          undefined,
        ],
      ]);

      mocks.invoke.mockClear();
      await transport.setMutedParts(new Set());
      expect(mocks.invoke.mock.calls).toEqual([["vst_playback_set_muted", { parts: [] }, undefined]]);
    },
  );

  it.each(["vst", "sf2", "shared vst"] as const)(
    "reapplies the latest %s raw mixer mute when selection clears during loading",
    async (kind) => {
      const { createVstTransport } = await import("./vstTransport");
      const transport = createVstTransport()!;
      const { document, preparation } = selectionFixture(kind);
      mockMultitimbralMapper();
      await transport.setMutedParts(new Set([1, 2]));
      duringLoad = async () => {
        await transport.setMutedParts(new Set([0, 1, 2]));
        await transport.setMutedParts(new Set([0, 1]));
      };
      mocks.invoke.mockClear();
      await transport.prepare(document, preparation);
      await transport.start(0.5);
      expect(
        mocks.invoke.mock.calls.filter(([command]) =>
          ["vst_playback_set_muted", "vst_playback_start", "vst_playback_stop", "vst_playback_seek"].includes(command),
        ),
      ).toEqual([
        ["vst_playback_set_muted", { parts: [0, 1, 2] }, undefined],
        ["vst_playback_set_muted", { parts: [0, 1] }, undefined],
        ["vst_playback_set_muted", { parts: [0, 1] }, undefined],
        ["vst_playback_start", { originSeconds: 0.5 }, undefined],
      ]);
    },
  );
});
