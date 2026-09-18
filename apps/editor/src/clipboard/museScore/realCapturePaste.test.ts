import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  measureBeats,
  pitchToMidi,
  walkSequenceEvents,
  type ChordSymbol,
  type NoteEvent,
  type Score,
  type SequenceContent,
  type TimeSignature,
  type Transposition,
} from "@viritura/core";
import type { DynamicGroup as RawDynamicGroup } from "@viritura/core/raw";
import { parseMnx, serializeMnx, validateRawScore } from "@viritura/format";
import {
  applyPaste,
  pasteFromClipboard,
  pasteResultFromFragment,
  type ClipboardSelection,
  type PasteResult,
} from "../../commands/clipboardCommands";
import { sequenceContentBeats } from "../../commands/noteCommands";
import { resolveWrittenPitchFromSounding } from "../../commands/transposeCommands";
import { buildClipboardSelection } from "../buildClipboardSelection";
import { findPlacedSelection } from "../computePasteResult";
import { assignFreshTrackIds, deserializeFragment } from "../deserialize";
import { serializeFragment } from "../serialize";
import { MUSESCORE_STAFF_LIST_MIME, readMuseScoreClipboard, writeMuseScoreStaffList } from ".";
import doublebassXml from "./fixtures/realCaptures/doublebass.xml?raw";
import hairpinXml from "./fixtures/realCaptures/hairpin.xml?raw";
import naturalXml from "./fixtures/realCaptures/natural.xml?raw";
import pianoXml from "./fixtures/realCaptures/pianoLowerDynamics.xml?raw";
import tiesXml from "./fixtures/realCaptures/ties.xml?raw";

const clipboard = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../notationClipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../notationClipboard")>()),
  readNotationClipboard: clipboard.read,
}));

beforeEach(() => clipboard.read.mockReset());

const SIX_EIGHT: TimeSignature = { count: 6, unit: 8 };
const BASS: Transposition = {
  interval: { halfSteps: 12, staffDistance: 7 },
  prefersWrittenPitches: true,
};
const TIE_PITCHES = [[63], [62], [63], [65], [65], [63], [63]];
const TIE_DURATIONS = [3 / 16, 1 / 16, 1 / 8, 1 / 8, 1 / 16, 1 / 16, 1 / 8];
const UPPER_PITCHES = [
  [60, 63, 67],
  [63, 67, 70],
];
const LOWER_PITCHES = [[48], [46], [48], [50], [46], [50]];

// MuseScore v4.7.5: Dynamic L1288-L1308; PLAY via Spanner L1592-L1602 / TextLineBase L1642-L1672.
// Hairpin playback fields: https://github.com/musescore/MuseScore/blob/3654226c2e99289916916953a98e585a3d3b315a/src/engraving/rw/write/twrite.cpp#L1683-L1707
const sourcePlaybackHairpinXml = hairpinXml
  .replace("<Dynamic>", "<Dynamic><play>0</play>")
  .replace(
    "<HairPin>",
    "<HairPin><veloChange>20</veloChange><singleNoteDynamics>0</singleNoteDynamics>" +
      "<veloChangeMethod>1</veloChangeMethod><play>0</play>",
  );

interface NativeMeasure {
  sequences: Array<{ staff?: number; content: Array<Omit<NoteEvent, "type">> }>;
  dynamics?: RawDynamicGroup[];
  _x?: { viritura?: { chordSymbols?: ChordSymbol[] } };
}

interface NativeScore {
  parts: Array<{ transposition?: Transposition; measures: NativeMeasure[] }>;
}

function destination(layout = [1], time = SIX_EIGHT): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: Array.from({ length: 8 }, (_, index) => ({
        id: `destination-m${index}`,
        time: { ...time },
        key: { fifths: -3 },
      })),
    },
    parts: layout.map((staves, part) => ({
      id: `destination-p${part}`,
      staves,
      measures: Array.from({ length: 8 }, (_, measure) => ({
        sequences: Array.from({ length: staves }, (_, staff) => ({
          staff: staff + 1,
          content: Array.from(
            { length: measureBeats(time) * 4 },
            (_, event): NoteEvent => ({
              type: "event",
              id: `rest-p${part}-m${measure}-s${staff}-e${event}`,
              duration: { base: "16th" },
              rest: {},
            }),
          ),
        })),
      })),
    })),
  };
}

function readCapture(xml: string) {
  const root = new DOMParser().parseFromString(xml, "application/xml").documentElement;
  expect(root.tagName).toBe("StaffList");
  expect(root.getAttribute("tick")).not.toBe("0/1");
  expect(root.getAttribute("len")).toBe("6/8");
  const parsed = readMuseScoreClipboard(xml, MUSESCORE_STAFF_LIST_MIME);
  for (const track of parsed.tracks ?? [{ content: parsed.content }]) {
    expect(track.content.reduce((sum, item) => sum + sequenceContentBeats(item), 0)).toBe(3);
  }
  return parsed;
}

function pitched(content: SequenceContent[]): NoteEvent[] {
  return [...walkSequenceEvents(content)].map(({ event }) => event).filter((event) => event.notes?.length);
}

function staffEvents(score: Score, part = 0, staff = 1, first = 1, last = 1): NoteEvent[] {
  return score.parts[part]!.measures.slice(first, last + 1).flatMap((measure) =>
    measure.sequences
      .filter((sequence) => (sequence.staff ?? 1) === staff)
      .flatMap((sequence) => pitched(sequence.content)),
  );
}

function nativeEvents(score: NativeScore, part = 0, staff = 1, first = 1, last = 1) {
  return score.parts[part]!.measures.slice(first, last + 1).flatMap((measure) =>
    measure.sequences
      .filter((sequence) => (sequence.staff ?? 1) === staff)
      .flatMap((sequence) => sequence.content.filter((event) => event.notes?.length)),
  );
}

function expectMusic(events: Array<Pick<NoteEvent, "notes" | "duration">>, pitches: number[][], durations: number[]) {
  expect(events.map((event) => event.notes!.map((note) => pitchToMidi(note.pitch)))).toEqual(pitches);
  expect(events.map((event) => sequenceContentBeats({ type: "event", duration: event.duration }) / 4)).toEqual(
    durations,
  );
}

function persisted(score: Score) {
  const wire = serializeMnx(score);
  expect(validateRawScore(wire)).toMatchObject({ ok: true });
  const decoded = parseMnx(JSON.parse(JSON.stringify(wire)));
  return { wire: wire as NativeScore, decoded };
}

function place(paste: PasteResult, target: Score, measure = 1, event = 0) {
  const input = structuredClone({ target, paste });
  const placed: SequenceContent[] = [];
  const fresh = { ...paste, ...assignFreshTrackIds(paste.content, paste.tracks) };
  const score = applyPaste(target, fresh, 0, measure, 0, event, placed);
  expect({ target, paste }).toEqual(input);
  const selection = findPlacedSelection(score, placed, measure, event / 4).selection;
  expect(selection?.kind).toBe("multi");
  if (selection?.kind !== "multi") throw new Error("Expected actual placed-event selection");
  expect(selection.elementIds).toHaveLength(pitched(placed).length);
  expect(new Set(selection.elementIds).size).toBe(selection.elementIds.length);
  const { wire, decoded } = persisted(score);
  const captured = buildClipboardSelection(decoded, selection);
  expect(captured).not.toBeNull();
  expect(captured!.captureOrigin).toEqual({ measureIndex: measure, beat: event / 4 });
  expect(captured!.timeSignature).toEqual(target.global.measures[measure]!.time);
  for (const track of captured!.tracks ?? [{ content: captured!.events }]) {
    expect(track.content.reduce((sum, item) => sum + sequenceContentBeats(item), 0)).toBe(3);
  }
  return { score, wire, decoded, captured: captured!, selection };
}

function captureClipboardSelection(captured: ClipboardSelection) {
  const fragment = deserializeFragment(
    serializeFragment(
      captured.events,
      captured.timeSignature,
      captured.keySignature,
      captured.tracks,
      captured.clef,
      captured.transposition,
      captured.dynamics,
      captured.measureRepeats,
      captured.lyrics,
      captured.chordSymbols,
    ),
  );
  expect(fragment).not.toBeNull();
  expect(fragment!.content).toEqual(captured.events);
  expect(fragment!.tracks).toEqual(captured.tracks);
  expect(fragment!.dynamics ?? []).toEqual(captured.dynamics ?? []);
  expect(fragment!.chordSymbols ?? []).toEqual(captured.chordSymbols ?? []);
  const nativeCapture: ClipboardSelection = {
    ...captured,
    events: fragment!.content,
    tracks: fragment!.tracks,
    transposition: fragment!.transposition,
    dynamics: fragment!.dynamics,
    chordSymbols: fragment!.chordSymbols,
  };
  const written = writeMuseScoreStaffList(nativeCapture);
  expect(written.warning).toBeUndefined();
  expect(written.xml).toBeTruthy();
  const xml = written.xml!;
  const document = new DOMParser().parseFromString(xml, "application/xml");
  expect(document.querySelectorAll("velocity")).toHaveLength(0);
  const length = document.documentElement.getAttribute("len")!.split("/").map(Number);
  expect(length[0]! / length[1]!).toBe(3 / 4);
  return {
    fragment: fragment!,
    xml,
    document,
    reimported: readMuseScoreClipboard(xml, MUSESCORE_STAFF_LIST_MIME),
  };
}

function capturedDynamics(selection: ClipboardSelection) {
  const tracks = selection.tracks?.flatMap((track) => track.dynamics ?? []) ?? [];
  return tracks.length ? tracks : (selection.dynamics ?? []);
}

function fractionValue(value: [number, number] | undefined) {
  expect(value).toBeDefined();
  return value![0] / value![1];
}

function expectTies(events: Array<Pick<NoteEvent, "id" | "notes">>, edges: number[][]) {
  const notes = events.flatMap((event) => event.notes!);
  const byId = new Map(notes.map((note) => [note.id, note]));
  expect(byId.size).toBe(notes.length);
  const actual = notes.flatMap((note, source) =>
    (note.ties ?? []).map((tie) => {
      const target = byId.get(tie.target);
      expect(target, `Tie target ${tie.target} must exist in the selected passage`).toBeDefined();
      expect(target!.pitch).toEqual(note.pitch);
      expect(target!.id).not.toBe(note.id);
      return [source, notes.indexOf(target!)];
    }),
  );
  expect(actual).toEqual(edges);
}

function allIds(events: NoteEvent[]) {
  return events.flatMap((event) => [event.id!, ...event.notes!.map((note) => note.id!)]);
}

describe("exact real StaffList captures through actual paste, MNX, native copy, and MuseScore", () => {
  it.each([
    { name: "hairpin", xml: hairpinXml, layout: [1], pitches: [[63], [65], [67]] },
    {
      name: "hairpin with disabled source playback",
      xml: sourcePlaybackHairpinXml,
      layout: [1],
      pitches: [[63], [65], [67]],
    },
    { name: "double bass", xml: doublebassXml, layout: [1], pitches: [[29], [31]] },
    { name: "natural", xml: naturalXml, layout: [1], pitches: [[60], [59]] },
    { name: "ties", xml: tiesXml, layout: [1], pitches: TIE_PITCHES },
    { name: "piano", xml: pianoXml, layout: [2], pitches: UPPER_PITCHES },
  ])(
    "passes $name through the native-format clipboard command without rewriting staff coordinates",
    async ({ name, xml, layout, pitches }) => {
      clipboard.read.mockResolvedValue({ text: "", museScore: { mime: MUSESCORE_STAFF_LIST_MIME, xml } });
      const paste = await pasteFromClipboard();
      expect(paste).not.toBeNull();
      expect(paste!.sourceKeySignature).toBeUndefined();
      expect(paste!.sourceTimeSignature).toBeUndefined();
      const result = place(paste!, destination(layout));
      expect(staffEvents(result.decoded).map((event) => event.notes!.map((note) => pitchToMidi(note.pitch)))).toEqual(
        pitches,
      );
      const copied = captureClipboardSelection(result.captured);
      expect(
        pitched(copied.reimported.content).map((event) => event.notes!.map((note) => pitchToMidi(note.pitch))),
      ).toEqual(pitches);
      if (name === "piano") {
        expect(paste!.dynamics?.[0]?.staffOffset).toBe(1);
        expectPiano(result.decoded, 0, 2);
        expect(copied.reimported.dynamics?.[0]?.staffOffset).toBe(1);
      } else if (name === "double bass") {
        expect(paste!.tracks?.[0]?.transposition).toEqual(BASS);
      } else if (name === "ties") {
        expectTies(staffEvents(result.decoded), [
          [3, 4],
          [5, 6],
        ]);
      } else if (name.startsWith("hairpin")) {
        for (const score of [result.score, result.wire, result.decoded]) {
          expect(score.parts[0]!.measures[1]!.dynamics).toEqual([
            {
              id: expect.any(String),
              type: "gradual",
              value: "mf",
              wedgeType: "increasing",
              staff: 1,
              position: { fraction: [0, 16] },
              end: { measure: "destination-m1", position: { fraction: [12, 16] } },
            },
          ]);
        }
        expect(copied.reimported.dynamics).toEqual(
          readCapture(hairpinXml).dynamics!.map(({ dynamic, ...placement }) => ({
            ...placement,
            dynamic: { ...dynamic, id: expect.any(String) },
          })),
        );
        expect(
          copied.document.querySelectorAll(
            "velocity, play, veloChange, veloChangeSpeed, singleNoteDynamics, veloChangeMethod",
          ),
        ).toHaveLength(0);
      } else {
        expect(staffEvents(result.decoded)[1]!.notes![0]!.accidentalDisplay).toMatchObject({ show: true });
      }
    },
  );

  it.each([
    { name: "6/8", time: SIX_EIGHT, endMeasure: 1, endFraction: 3 / 4 },
    { name: "2/4", time: { count: 2, unit: 4 }, endMeasure: 2, endFraction: 1 / 4 },
  ])("keeps the exact crescendo endpoint in $name", ({ time, endMeasure, endFraction }) => {
    const parsed = readCapture(hairpinXml);
    expectMusic(pitched(parsed.content), [[63], [65], [67]], [1 / 4, 1 / 8, 3 / 8]);
    expect(parsed.dynamics).toHaveLength(1);
    expect(parsed.dynamics![0]!.dynamic).toEqual({
      id: expect.any(String),
      type: "gradual",
      value: "mf",
      wedgeType: "increasing",
      position: { fraction: [0, 1] },
      end: { measure: "0", position: { fraction: [3, 4] } },
    });
    expect(fractionValue(parsed.dynamics![0]!.endOffset)).toBe(3 / 4);
    const result = place(parsed, destination([1], time));
    const expectedPitches = endMeasure === 1 ? [[63], [65], [67]] : [[63], [65], [67], [67]];
    const expectedDurations = endMeasure === 1 ? [1 / 4, 1 / 8, 3 / 8] : [1 / 4, 1 / 8, 1 / 8, 1 / 4];
    for (const score of [result.score, result.decoded]) {
      expectMusic(staffEvents(score, 0, 1, 1, endMeasure), expectedPitches, expectedDurations);
      const dynamics = score.parts[0]!.measures.flatMap((measure) => measure.dynamics ?? []);
      expect(dynamics).toHaveLength(1);
      expect(dynamics[0]).toEqual({
        id: expect.any(String),
        type: "gradual",
        value: "mf",
        wedgeType: "increasing",
        staff: 1,
        position: { fraction: [0, 16] },
        end: {
          measure: score.global.measures[endMeasure]!.id,
          position: { fraction: [endFraction * 16, 16] },
        },
      });
      expect(fractionValue(dynamics[0]!.position.fraction)).toBe(0);
      expect(fractionValue(dynamics[0]!.end!.position.fraction)).toBe(endFraction);
    }
    expectMusic(nativeEvents(result.wire, 0, 1, 1, endMeasure), expectedPitches, expectedDurations);
    expect(result.wire.parts[0]!.measures[1]!.dynamics).toEqual([
      {
        id: expect.any(String),
        type: "gradual",
        value: "mf",
        wedgeType: "increasing",
        staff: 1,
        position: { fraction: [0, 16] },
        end: {
          measure: result.score.global.measures[endMeasure]!.id,
          position: { fraction: [endFraction * 16, 16] },
        },
      },
    ]);
    expect(result.selection.rhythmicRange?.end).toEqual({ measureIndex: endMeasure, beat: endFraction * 4 });
    expect(capturedDynamics(result.captured)).toHaveLength(1);
    expect(fractionValue(capturedDynamics(result.captured)[0]!.endOffset)).toBe(3 / 4);
    const copied = captureClipboardSelection(result.captured);
    expectMusic(pitched(copied.reimported.content), expectedPitches, expectedDurations);
    expect(copied.reimported.dynamics).toHaveLength(1);
    expect(copied.reimported.dynamics![0]!.staffOffset).toBe(0);
    expect(copied.reimported.dynamics![0]!.dynamic).toEqual({
      id: expect.any(String),
      type: "gradual",
      value: "mf",
      wedgeType: "increasing",
      position: { fraction: [0, 1] },
      end: { measure: "0", position: { fraction: [3, 4] } },
    });
    expect(fractionValue(copied.reimported.dynamics![0]!.endOffset)).toBe(3 / 4);
    expect(copied.document.querySelectorAll("Dynamic")).toHaveLength(1);
    expect(copied.document.querySelector("Dynamic")?.innerHTML).toBe("<subtype>mf</subtype>");
    expect(copied.document.querySelectorAll('Spanner[type="HairPin"]')).toHaveLength(2);
  });

  it.each(["concert", "double bass"] as const)("keeps F1/G1 sounding into a %s destination", (instrument) => {
    const parsed = readCapture(doublebassXml);
    expect(parsed.tracks?.[0]?.transposition).toEqual(BASS);
    expectMusic(pitched(parsed.content), [[29], [31]], [3 / 8, 3 / 8]);
    expect(pitched(parsed.content).map((event) => event.notes![0]!.pitch)).toEqual([
      { step: "F", octave: 1 },
      { step: "G", octave: 1 },
    ]);
    const target = destination();
    if (instrument === "double bass") target.parts[0]!.transposition = structuredClone(BASS);
    const result = place(parsed, target);
    const transposition = instrument === "double bass" ? BASS : undefined;
    for (const score of [result.score, result.decoded]) {
      expect(score.parts[0]!.transposition).toEqual(transposition);
      const events = staffEvents(score);
      expectMusic(events, [[29], [31]], [3 / 8, 3 / 8]);
      expect(events.map((event) => resolveWrittenPitchFromSounding(event.notes![0]!.pitch, score, 0, -3))).toEqual([
        { step: "F", octave: instrument === "double bass" ? 2 : 1 },
        { step: "G", octave: instrument === "double bass" ? 2 : 1 },
      ]);
    }
    expect(result.wire.parts[0]!.transposition).toEqual(transposition);
    expectMusic(nativeEvents(result.wire), [[29], [31]], [3 / 8, 3 / 8]);
    expect(result.captured.transposition).toEqual(transposition);
    const copied = captureClipboardSelection(result.captured);
    expect(copied.fragment.transposition).toEqual(transposition);
    expect(copied.reimported.tracks?.[0]?.transposition).toEqual(transposition);
    expectMusic(pitched(copied.reimported.content), [[29], [31]], [3 / 8, 3 / 8]);
    expect([...copied.document.querySelectorAll("Note > pitch")].map((element) => Number(element.textContent))).toEqual(
      [29, 31],
    );
    expect(copied.document.querySelector("transposeChromatic")?.textContent).toBe(
      instrument === "double bass" ? "-12" : undefined,
    );
    expect(copied.document.querySelector("transposeDiatonic")?.textContent).toBe(
      instrument === "double bass" ? "-7" : undefined,
    );
  });

  it("preserves the explicit B-natural after C4 in an E-flat-major destination", () => {
    const parsed = readCapture(naturalXml);
    expectMusic(pitched(parsed.content), [[60], [59]], [3 / 8, 3 / 8]);
    expect(pitched(parsed.content)[1]!.notes![0]!.accidentalDisplay).toMatchObject({ show: true });
    const result = place(parsed, destination());
    for (const score of [result.score, result.decoded]) {
      expect(score.global.measures[1]!.key).toEqual({ fifths: -3 });
      const events = staffEvents(score);
      expectMusic(events, [[60], [59]], [3 / 8, 3 / 8]);
      expect(events.map((event) => event.notes![0]!.pitch)).toEqual([
        { step: "C", octave: 4 },
        { step: "B", octave: 3 },
      ]);
      expect(events[1]!.notes![0]!.accidentalDisplay).toMatchObject({ show: true });
    }
    const native = nativeEvents(result.wire);
    expectMusic(native, [[60], [59]], [3 / 8, 3 / 8]);
    expect(native[1]!.notes![0]!.accidentalDisplay).toMatchObject({ show: true });
    const copied = captureClipboardSelection(result.captured);
    expect(copied.document.querySelector("Accidental > subtype")?.textContent).toBe("accidentalNatural");
    expectMusic(pitched(copied.reimported.content), [[60], [59]], [3 / 8, 3 / 8]);
    expect(pitched(copied.reimported.content)[1]!.notes![0]!.accidentalDisplay).toMatchObject({ show: true });
    const repasted = place(pasteResultFromFragment(copied.fragment), destination());
    expect(staffEvents(repasted.decoded)[1]!.notes![0]!.accidentalDisplay).toMatchObject({ show: true });
  });

  it.each(["6/8", "3/8 with a sixteenth lead-in"] as const)("remaps ties twice in %s", (meter) => {
    const parsed = readCapture(tiesXml);
    expectMusic(pitched(parsed.content), TIE_PITCHES, TIE_DURATIONS);
    expectTies(pitched(parsed.content), [
      [3, 4],
      [5, 6],
    ]);
    const split = meter !== "6/8";
    const time = split ? { count: 3, unit: 8 } : SIX_EIGHT;
    const first = place(parsed, destination([1], time), 1, split ? 1 : 0);
    const pitches = split ? [[63], [62], [63], [63], [65], [65], [63], [63], [63]] : TIE_PITCHES;
    const durations = split ? [3 / 16, 1 / 16, 1 / 16, 1 / 16, 1 / 8, 1 / 16, 1 / 16, 1 / 16, 1 / 16] : TIE_DURATIONS;
    const edges = split
      ? [
          [2, 3],
          [4, 5],
          [6, 7],
          [7, 8],
        ]
      : [
          [3, 4],
          [5, 6],
        ];
    const firstEnd = split ? 3 : 1;
    for (const score of [first.score, first.decoded]) {
      const events = staffEvents(score, 0, 1, 1, firstEnd);
      expectMusic(events, pitches, durations);
      expectTies(events, edges);
    }
    expectMusic(nativeEvents(first.wire, 0, 1, 1, firstEnd), pitches, durations);
    expectTies(nativeEvents(first.wire, 0, 1, 1, firstEnd), edges);
    const copied = captureClipboardSelection(first.captured);
    expectMusic(pitched(copied.reimported.content), pitches, durations);
    expectTies(pitched(copied.reimported.content), edges);
    expectTies(pitched(copied.fragment.content), edges);
    const second = place(pasteResultFromFragment(copied.fragment), first.decoded, 4, split ? 1 : 0);
    const secondEnd = split ? 6 : 4;
    const sourceIds = new Set(allIds(pitched(parsed.content)));
    const firstIds = new Set(allIds(staffEvents(first.decoded, 0, 1, 1, firstEnd)));
    for (const id of firstIds) expect(sourceIds.has(id)).toBe(false);
    for (const score of [second.score, second.decoded]) {
      const events = staffEvents(score, 0, 1, 4, secondEnd);
      expectMusic(events, pitches, durations);
      expectTies(events, edges);
      const ids = allIds(events);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        expect(sourceIds.has(id)).toBe(false);
        expect(firstIds.has(id)).toBe(false);
      }
      expect(staffEvents(score, 0, 1, 1, firstEnd)).toEqual(staffEvents(first.decoded, 0, 1, 1, firstEnd));
    }
    expectMusic(nativeEvents(second.wire, 0, 1, 4, secondEnd), pitches, durations);
    expectTies(nativeEvents(second.wire, 0, 1, 4, secondEnd), edges);
    const secondCopy = captureClipboardSelection(second.captured);
    expectTies(pitched(secondCopy.reimported.content), edges);
    expectMusic(pitched(secondCopy.reimported.content), pitches, durations);
    if (split) {
      expect(first.selection.rhythmicRange?.end).toEqual({ measureIndex: 3, beat: 1 / 4 });
      expect(staffEvents(first.decoded, 0, 1, 1, 1).at(-1)!.notes![0]!.ties?.[0]?.target).toBe(
        staffEvents(first.decoded, 0, 1, 2, 2)[0]!.notes![0]!.id,
      );
    }
  });

  it.each([
    { name: "grand staff", layout: [2], lowerPart: 0, lowerStaff: 2 },
    { name: "separate parts", layout: [1, 1], lowerPart: 1, lowerStaff: 1 },
  ])("routes piano into $name", ({ layout, lowerPart, lowerStaff }) => {
    const parsed = readCapture(pianoXml);
    expect(parsed.tracks).toHaveLength(2);
    expect(parsed.tracks?.map((track) => track.staffOffset)).toEqual([0, 1]);
    expectMusic(pitched(parsed.tracks![0]!.content), UPPER_PITCHES, [3 / 8, 3 / 8]);
    expectMusic(pitched(parsed.tracks![1]!.content), LOWER_PITCHES, Array<number>(6).fill(1 / 8));
    const result = place(parsed, destination(layout));
    expectPiano(result.score, lowerPart, lowerStaff);
    expectPiano(result.decoded, lowerPart, lowerStaff);
    expectMusic(nativeEvents(result.wire), UPPER_PITCHES, [3 / 8, 3 / 8]);
    expectMusic(nativeEvents(result.wire, lowerPart, lowerStaff), LOWER_PITCHES, Array<number>(6).fill(1 / 8));
    expect(result.wire.parts[lowerPart]!.measures[1]!.dynamics).toEqual([
      {
        id: expect.any(String),
        type: "immediate",
        value: "mp",
        staff: lowerStaff,
        position: { fraction: [0, 16] },
      },
    ]);
    expectHarmonies(result.wire.parts[0]!.measures[1]!._x?.viritura?.chordSymbols, 1);
    const copied = captureClipboardSelection(result.captured);
    expect(copied.reimported.tracks?.map((track) => track.staffOffset)).toEqual([0, 1]);
    expectMusic(pitched(copied.reimported.tracks![0]!.content), UPPER_PITCHES, [3 / 8, 3 / 8]);
    expectMusic(pitched(copied.reimported.tracks![1]!.content), LOWER_PITCHES, Array<number>(6).fill(1 / 8));
    expect(copied.reimported.dynamics).toEqual([
      {
        partOffset: 0,
        staffOffset: 1,
        measureOffset: 0,
        offset: [0, 1],
        dynamic: {
          id: expect.any(String),
          type: "immediate",
          value: "mp",
          position: { fraction: [0, 1] },
        },
      },
    ]);
    const staves = copied.document.querySelectorAll("Staff");
    expect(staves).toHaveLength(2);
    expect(staves[0]!.querySelectorAll("Dynamic")).toHaveLength(0);
    expect(staves[0]!.querySelectorAll("Harmony")).toHaveLength(2);
    expect(staves[1]!.querySelectorAll("Dynamic")).toHaveLength(1);
    expect(staves[1]!.querySelector("Dynamic")?.innerHTML).toBe("<subtype>mp</subtype>");
    expect(staves[1]!.querySelectorAll("Harmony")).toHaveLength(0);
    const otherLayout = layout.length === 1 ? [1, 1] : [2];
    const repasted = place(copied.reimported, destination(otherLayout));
    expectPiano(repasted.decoded, layout.length === 1 ? 1 : 0, layout.length === 1 ? 1 : 2);
    expectPiano(place(pasteResultFromFragment(copied.fragment), destination(layout)).decoded, lowerPart, lowerStaff);
  });

  it("splits the tied F across two 2/4 bars while retaining the original onset-target ties", () => {
    const result = place(readCapture(tiesXml), destination([1], { count: 2, unit: 4 }), 1, 1);
    const events = staffEvents(result.decoded, 0, 1, 1, 2);
    expectMusic(
      events,
      [[63], [62], [63], [65], [65], [65], [63], [63]],
      [3 / 16, 1 / 16, 1 / 8, 1 / 16, 1 / 16, 1 / 16, 1 / 16, 1 / 8],
    );
    const edges = [
      [3, 4],
      [4, 5],
      [6, 7],
    ];
    expectTies(events, edges);
    expectTies(nativeEvents(result.wire, 0, 1, 1, 2), edges);
    const copied = captureClipboardSelection(result.captured);
    expectTies(pitched(copied.reimported.content), edges);
    expect(result.selection.rhythmicRange?.end).toEqual({ measureIndex: 2, beat: 1.25 });
  });

  it.each([
    { name: "grand staff", layout: [2], lowerPart: 0, lowerStaff: 2 },
    { name: "separate parts", layout: [1, 1], lowerPart: 1, lowerStaff: 1 },
  ])("routes secondary harmonies into $name", ({ layout, lowerPart, lowerStaff }) => {
    const harmonies = [...pianoXml.matchAll(/ {4}<Harmony>[\s\S]*? {6}<\/Harmony>\r?\n/g)].map((match) => match[0]);
    expect(harmonies).toHaveLength(2);
    let variant = pianoXml;
    for (const harmony of harmonies) variant = variant.replace(harmony, "");
    const lowerStart = variant.indexOf('  <Staff id="23">');
    const lowerFirstChord = variant.indexOf("    <Chord>", lowerStart);
    variant = variant.slice(0, lowerFirstChord) + harmonies[0]! + variant.slice(lowerFirstChord);
    const lowerFourthChord = [...variant.matchAll(/ {4}<Chord>/g)][5]!.index!;
    variant = variant.slice(0, lowerFourthChord) + harmonies[1]! + variant.slice(lowerFourthChord);
    const parsed = readCapture(variant);
    expect(parsed.chordSymbols?.map((symbol) => [symbol.staffOffset, fractionValue(symbol.offset)])).toEqual([
      [1, 0],
      [1, 3 / 8],
    ]);
    const result = place(parsed, destination(layout));
    expectPiano(result.score, lowerPart, lowerStaff, true);
    expectPiano(result.decoded, lowerPart, lowerStaff, true);
    expectHarmonies(result.wire.parts[lowerPart]!.measures[1]!._x?.viritura?.chordSymbols, lowerStaff);
    const copied = captureClipboardSelection(result.captured);
    expect(copied.reimported.chordSymbols?.map((symbol) => [symbol.staffOffset, fractionValue(symbol.offset)])).toEqual(
      [
        [1, 0],
        [1, 3 / 8],
      ],
    );
    expect(copied.document.querySelectorAll("Staff")[0]!.querySelectorAll("Harmony")).toHaveLength(0);
    expect(copied.document.querySelectorAll("Staff")[1]!.querySelectorAll("Harmony")).toHaveLength(2);
    expectPiano(place(copied.reimported, destination(layout)).decoded, lowerPart, lowerStaff, true);
  });
});

function expectHarmonies(symbols: ChordSymbol[] | undefined, staff: number) {
  expect(symbols).toHaveLength(2);
  expect(symbols).toMatchObject([
    { root: { step: "C" }, quality: "minor", displayStaff: staff },
    { root: { step: "E", alter: -1 }, quality: "major", displayStaff: staff },
  ]);
  expect(symbols!.map((symbol) => fractionValue(symbol.position.fraction))).toEqual([0, 3 / 8]);
}

function expectPiano(score: Score, lowerPart: number, lowerStaff: number, lowerHarmony = false) {
  expectMusic(staffEvents(score), UPPER_PITCHES, [3 / 8, 3 / 8]);
  expectMusic(staffEvents(score, lowerPart, lowerStaff), LOWER_PITCHES, Array<number>(6).fill(1 / 8));
  const dynamics = score.parts.flatMap((part) => part.measures.flatMap((measure) => measure.dynamics ?? []));
  expect(dynamics).toHaveLength(1);
  expect(score.parts[lowerPart]!.measures[1]!.dynamics).toEqual([
    {
      id: expect.any(String),
      type: "immediate",
      value: "mp",
      staff: lowerStaff,
      position: { fraction: [0, 16] },
    },
  ]);
  expect(fractionValue(dynamics[0]!.position.fraction)).toBe(0);
  expectHarmonies(score.parts[lowerHarmony ? lowerPart : 0]!.measures[1]!.chordSymbols, lowerHarmony ? lowerStaff : 1);
  expect(score.parts.flatMap((part) => part.measures.flatMap((measure) => measure.chordSymbols ?? []))).toHaveLength(2);
}
