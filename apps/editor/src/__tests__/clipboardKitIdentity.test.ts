import { describe, expect, it } from "vitest";
import { walkSequenceEvents, type NoteEvent, type Score, type SequenceContent, type Tuplet } from "@viritura/core";
import type { ClipboardTrack } from "../clipboard/ClipboardFragment";
import { assignFreshIds, assignFreshTrackIds, deserializeFragment } from "../clipboard/deserialize";
import { serializeFragment } from "../clipboard/serialize";
import { applyPaste } from "../commands/clipboardCommands";
import { sequenceContentBeats } from "../commands/noteCommands";

function kitEvent(id: string, base: NoteEvent["duration"]["base"] = "quarter"): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base },
    kitNotes: [
      { id: `${id}-snare`, kitComponent: "snare" },
      { id: `${id}-cymbal`, kitComponent: "cymbal" },
    ],
  };
}

function tuplet(content: SequenceContent[]): Tuplet {
  return {
    type: "tuplet",
    inner: { multiple: 3, duration: { base: "quarter" } },
    outer: { multiple: 2, duration: { base: "quarter" } },
    content,
  };
}

function events(content: SequenceContent[]): NoteEvent[] {
  return [...walkSequenceEvents(content)].map(({ event }) => event);
}

function ids(content: SequenceContent[]): string[] {
  return events(content).flatMap((event) => [
    event.id!,
    ...(event.notes ?? []).map((note) => note.id!),
    ...(event.kitNotes ?? []).map((note) => note.id!),
  ]);
}

function connect(source: NoteEvent, target: NoteEvent): void {
  source.kitNotes![0]!.ties = [{ target: target.kitNotes![0]!.id, side: "down" }];
  source.slurs = [
    {
      target: target.id!,
      startNote: source.kitNotes![0]!.id,
      endNote: target.kitNotes![1]!.id,
      side: "up",
    },
  ];
}

function expectConnection(source: NoteEvent, target: NoteEvent): void {
  expect(source.kitNotes![0]!.ties).toEqual([{ target: target.kitNotes![0]!.id, side: "down" }]);
  expect(source.slurs).toEqual([
    {
      target: target.id,
      startNote: source.kitNotes![0]!.id,
      endNote: target.kitNotes![1]!.id,
      side: "up",
    },
  ]);
}

describe("clipboard kit-note freshening", () => {
  it("freshens nested grace, tuplets and tremolos with cross-track connectors on every paste", () => {
    const grace = kitEvent("grace");
    const nested = kitEvent("nested");
    const tremoloA = kitEvent("tremolo-a");
    const tremoloB = kitEvent("tremolo-b");
    connect(grace, tremoloB);
    connect(tremoloB, nested);
    connect(nested, grace);
    const tracks: ClipboardTrack[] = [
      { partOffset: 0, voiceIndex: 0, content: [tuplet([{ type: "grace", slash: true, content: [grace] }])] },
      { partOffset: 0, voiceIndex: 1, content: [tuplet([tuplet([nested])])] },
      {
        partOffset: 1,
        voiceIndex: 0,
        content: [
          tuplet([
            {
              type: "tremolo",
              marks: 3,
              outer: { multiple: 1, duration: { base: "half" } },
              content: [tremoloA, tremoloB],
            },
          ]),
        ],
      },
    ];
    const snapshot = structuredClone(tracks);
    const fragment = deserializeFragment(
      serializeFragment(tracks[1]!.content, { count: 4, unit: 4 }, { fifths: 0 }, tracks),
    )!;
    const usedIds = new Set(tracks.flatMap((track) => ids(track.content)));
    for (let paste = 0; paste < 2; paste++) {
      const result = assignFreshTrackIds(fragment.content, fragment.tracks);
      const freshGrace = events(result.tracks![0]!.content)[0]!;
      const freshNested = events(result.tracks![1]!.content)[0]!;
      const freshTremoloB = events(result.tracks![2]!.content)[1]!;
      expectConnection(freshGrace, freshTremoloB);
      expectConnection(freshTremoloB, freshNested);
      expectConnection(freshNested, freshGrace);
      expect(result.content).toBe(result.tracks![1]!.content);
      expect(result.content).toMatchObject([{ type: "tuplet", content: [{ type: "tuplet" }] }]);
      expect(result.tracks![0]!.content).toMatchObject([{ type: "tuplet", content: [{ type: "grace", slash: true }] }]);
      expect(result.tracks![2]!.content).toMatchObject([{ type: "tuplet", content: [{ type: "tremolo", marks: 3 }] }]);
      const freshIds = result.tracks!.flatMap((track) => ids(track.content));
      expect(freshIds).toHaveLength(12);
      expect(new Set(freshIds).size).toBe(12);
      for (const id of freshIds) {
        expect(usedIds.has(id)).toBe(false);
        usedIds.add(id);
      }
    }
    expect(tracks).toEqual(snapshot);
    expect(fragment.tracks).toEqual(snapshot);
  });

  it("uses a shared pitched/kit note map and preserves targetless ties while dropping external references", () => {
    const source = kitEvent("source");
    const target: NoteEvent = {
      type: "event",
      id: "pitched",
      duration: { base: "quarter" },
      notes: [{ id: "pitched-note", pitch: { step: "C", octave: 4 }, ties: [{ target: "source-snare" }] }],
    };
    source.kitNotes![0]!.ties = [{ target: "pitched-note" }, { target: "outside" }, { lv: true }, {}];
    source.kitNotes![1]!.ties = [{ target: "outside" }];
    source.slurs = [
      { target: "pitched", startNote: "source-snare", endNote: "pitched-note" },
      { target: "pitched", startNote: "outside-start", endNote: "outside-end" },
      { target: "outside-event" },
    ];
    target.slurs = [{ target: "source", startNote: "pitched-note", endNote: "source-cymbal" }];
    const content: SequenceContent[] = [source, tuplet([target])];
    const snapshot = structuredClone(content);
    const result = assignFreshIds(content);
    const [freshSource, freshTarget] = events(result);
    expect(freshSource!.kitNotes![0]!.ties).toEqual([{ target: freshTarget!.notes![0]!.id }, { lv: true }, {}]);
    expect(freshSource!.kitNotes![1]).not.toHaveProperty("ties");
    expect(freshTarget!.notes![0]!.ties).toEqual([{ target: freshSource!.kitNotes![0]!.id }]);
    expect(freshSource!.slurs).toEqual([
      { target: freshTarget!.id, startNote: freshSource!.kitNotes![0]!.id, endNote: freshTarget!.notes![0]!.id },
      { target: freshTarget!.id },
    ]);
    expect(freshTarget!.slurs).toEqual([
      {
        target: freshSource!.id,
        startNote: freshTarget!.notes![0]!.id,
        endNote: freshSource!.kitNotes![1]!.id,
      },
    ]);
    expect(ids(result).every((id) => !ids(content).includes(id))).toBe(true);
    expect(content).toEqual(snapshot);
  });

  it("assigns missing kit IDs with and without authoritative tracks", () => {
    const content: SequenceContent[] = [
      { type: "event", duration: { base: "quarter" }, kitNotes: [{ kitComponent: "snare" }] },
    ];
    const flat = assignFreshIds(content);
    const tracked = assignFreshTrackIds(content, [{ partOffset: 0, voiceIndex: 0, content }]);
    expect(ids(flat)).toEqual([expect.any(String), expect.any(String)]);
    expect(ids(tracked.content)).toEqual([expect.any(String), expect.any(String)]);
    expect(new Set([...ids(flat), ...ids(tracked.content)]).size).toBe(4);
    expect(events(content)[0]!.kitNotes![0]).not.toHaveProperty("id");
  });
});

describe("clipboard kit-note rhythmic splitting", () => {
  it("keeps incoming targets and ties every decomposed piece, leaving outgoing ties only on the final piece", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }, { time: { count: 5, unit: 8 } }, { time: { count: 4, unit: 4 } }],
      },
      parts: [{ measures: Array.from({ length: 3 }, () => ({ sequences: [{ content: [] }] })) }],
    };
    const preceding = kitEvent("preceding");
    const sustained = kitEvent("sustained", "breve");
    const target = kitEvent("target");
    connect(preceding, sustained);
    connect(sustained, target);
    sustained.kitNotes![1]!.ties = [{ lv: true }];
    sustained.markings = { accent: {} };
    sustained.fermata = {};
    const content = [preceding, sustained, target];
    const snapshot = structuredClone({ score, content });
    const result = applyPaste(score, { content }, 0, 0, 0, 0);
    const placedContent = result.parts[0]!.measures.flatMap((measure) => measure.sequences[0]!.content);
    const placed = events(placedContent);
    const chain = placed.slice(1, -1);

    expect(chain.map((event) => event.duration)).toEqual([
      { base: "half", dots: 1 },
      { base: "half" },
      { base: "eighth" },
      { base: "half" },
      { base: "eighth" },
    ]);
    expect(chain[0]!.id).toBe(sustained.id);
    expect(chain[0]!.kitNotes!.map((note) => note.id)).toEqual(sustained.kitNotes!.map((note) => note.id));
    expectConnection(placed[0]!, chain[0]!);
    expect(new Set(ids(placedContent)).size).toBe(placed.length * 3);
    for (let index = 0; index < chain.length - 1; index++) {
      for (const [noteIndex, note] of chain[index]!.kitNotes!.entries()) {
        expect(note.ties).toEqual([{ target: chain[index + 1]!.kitNotes![noteIndex]!.id }]);
      }
    }
    expect(chain.at(-1)!.kitNotes![0]!.ties).toEqual(sustained.kitNotes![0]!.ties);
    expect(chain.at(-1)!.kitNotes![1]!.ties).toEqual([{ lv: true }]);
    expect(chain.every((event) => event.kitNotes!.map((note) => note.kitComponent).join() === "snare,cymbal")).toBe(
      true,
    );
    expect(chain[0]!.slurs).toEqual(sustained.slurs);
    expect(chain.slice(1).every((event) => !event.slurs && !event.markings)).toBe(true);
    expect(chain.slice(0, -1).every((event) => !event.fermata)).toBe(true);
    expect(chain.at(-1)!.fermata).toEqual({});
    expect(chain.reduce((sum, event) => sum + sequenceContentBeats(event), 0)).toBe(8);
    expect({ score, content }).toEqual(snapshot);
  });

  it("creates distinct kit IDs for anonymous split notes without adding an outgoing final tie", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [{ measures: [{ sequences: [{ content: [] }] }] }],
    };
    const result = applyPaste(
      score,
      {
        content: [{ type: "event", duration: { base: "longa" }, kitNotes: [{ kitComponent: "snare" }] }],
      },
      0,
      0,
      0,
      0,
    );
    const content = result.parts[0]!.measures.flatMap((measure) => measure.sequences[0]!.content);
    const chain = events(content);
    expect(chain).toHaveLength(4);
    expect(ids(content).every((id) => typeof id === "string")).toBe(true);
    expect(new Set(ids(content)).size).toBe(8);
    for (let index = 0; index < chain.length - 1; index++) {
      expect(chain[index]!.kitNotes![0]!.ties).toEqual([{ target: chain[index + 1]!.kitNotes![0]!.id }]);
    }
    expect(chain.at(-1)!.kitNotes![0]).not.toHaveProperty("ties");
  });
});
