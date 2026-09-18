import { describe, expect, it } from "vitest";
import { walkSequenceEvents, type NoteEvent, type Score, type SequenceContent } from "@viritura/core";
import { sequenceContentBeats } from "../commands/noteCommands";
import type { SelectionState } from "../store/selectionStore";
import { buildClipboardSelection } from "./buildClipboardSelection";
import { computePasteResult } from "./computePasteResult";
import { computeRepeatResult } from "./computeRepeatResult";
import { assignFreshTrackIds } from "./deserialize";

const layouts = ["voice", "staff", "part", "reordered staff"] as const;
type Layout = (typeof layouts)[number] | "single";
type Placement = NonNullable<ReturnType<typeof computeRepeatResult>>;

interface Track {
  part: number;
  staff: number;
  voice: number;
}

interface EventRow {
  id: string;
  event: NoteEvent;
  beat: number;
  beats: number;
}

function note(id: string, step: "C" | "G" = "C", duration: NoteEvent["duration"] = { base: "quarter" }): NoteEvent {
  return { type: "event", id, duration, notes: [{ id: `${id}-note`, pitch: { step, octave: 4 } }] };
}

function rest(id: string, base: NoteEvent["duration"]["base"] = "whole"): NoteEvent {
  return { type: "event", id, duration: { base }, rest: {} };
}

function space(beats = 1): SequenceContent {
  return { type: "space", duration: [beats, 4] };
}

function fixture(
  layout: Layout,
  primary: SequenceContent[] = [0, 1, 2, 3].map((i) => note(`c-${i}`)),
  secondary: SequenceContent[] = [space(), note("g-1", "G"), note("g-2", "G"), space()],
) {
  const tracks: Track[] = [{ part: 0, staff: 1, voice: 0 }];
  if (layout !== "single") {
    tracks.push({
      part: layout === "part" ? 1 : 0,
      staff: layout.includes("staff") ? 2 : 1,
      voice: layout === "voice" ? 1 : 0,
    });
  }
  const source = [primary, secondary].slice(0, tracks.length);
  const score: Score = {
    mnx: { version: 1 },
    global: { measures: Array.from({ length: 4 }, () => ({ time: { count: 4, unit: 4 } })) },
    parts: Array.from({ length: layout === "part" ? 2 : 1 }, (_, part) => ({
      staves: Math.max(...tracks.filter((track) => track.part === part).map((track) => track.staff)),
      measures: Array.from({ length: 4 }, (_, measure) => {
        const sequences = tracks.flatMap((track, index) =>
          track.part === part
            ? [
                {
                  staff: track.staff,
                  content: measure === 0 ? source[index]! : [rest(`old-${part}-${measure}-${index}`)],
                },
              ]
            : [],
        );
        return { sequences: layout === "reordered staff" && measure % 2 === 1 ? sequences.reverse() : sequences };
      }),
    })),
  };
  score.parts.push({
    name: "Unselected instrument",
    measures: Array.from({ length: 4 }, (_, m) => ({
      sequences: [{ content: [note(`untouched-${m}`, "C", { base: "whole" })] }],
    })),
  });
  return { score, tracks, source };
}

function wholeMeasure(tracks: Track[], measure = 0): SelectionState {
  const last = tracks.at(-1)!;
  return {
    kind: "measure",
    startPartIndex: 0,
    endPartIndex: last.part,
    startStaffIndex: 0,
    endStaffIndex: last.part + last.staff - 1,
    startLocalStaffIndex: 0,
    endLocalStaffIndex: last.staff - 1,
    startMeasure: measure,
    endMeasure: measure,
  };
}

function trackAt(score: Score, track: Track, measure: number) {
  const sequences = score.parts[track.part]!.measures[measure]!.sequences;
  const sequence = sequences.filter((item) => (item.staff ?? 1) === track.staff)[track.voice]!;
  return { content: sequence.content, prefix: `p${track.part}/m${measure}/s${sequences.indexOf(sequence)}/` };
}

function eventRows(content: SequenceContent[], prefix = "", beat = 0, scale = 1): EventRow[] {
  return content.flatMap((item, index): EventRow[] => {
    const start = beat;
    const beats = sequenceContentBeats(item) * scale;
    beat += beats;
    if (item.type === "event")
      return item.notes ? [{ id: `${prefix}${item.id}`, event: item, beat: start, beats }] : [];
    if (item.type === "tuplet") {
      const nominal = item.content.reduce((sum, child) => sum + sequenceContentBeats(child), 0);
      return eventRows(item.content, prefix, start, beats / nominal);
    }
    if (item.type === "grace") {
      const parent = content[index === content.length - 1 ? index - 1 : index + 1] as NoteEvent;
      return eventRows(item.content, `${prefix}${parent.id}/grace/`, start, 0);
    }
    return [];
  });
}

function placedRows(score: Score, tracks: Track[], start: number, beats = 4): EventRow[] {
  return tracks.flatMap((track) =>
    score.parts[track.part]!.measures.flatMap((_, m) => {
      const { content, prefix } = trackAt(score, track, m);
      return eventRows(content, prefix, m * 4).filter((row) => row.beat >= start && row.beat < start + beats);
    }),
  );
}

function profile(content: SequenceContent[], beat = 0) {
  return eventRows(content, "", beat).map((row) => [row.beat, row.beats, row.event.notes![0]!.pitch.step]);
}

function recapture(result: Placement, tracks: Track[], start: number, beats = 4) {
  const placed = placedRows(result.newScore, tracks, start, beats);
  expect(result.selection?.kind).toBe("multi");
  if (result.selection?.kind !== "multi") throw new Error("Expected a timed placed selection");
  expect([...result.selection.elementIds].sort()).toEqual(placed.map((row) => row.id).sort());
  expect(result.selection.rhythmicRange).toMatchObject({
    start: { measureIndex: Math.floor(start / 4), beat: start % 4 },
    end: { measureIndex: Math.ceil((start + beats) / 4) - 1, beat: (start + beats) % 4 || 4 },
  });
  const captured = buildClipboardSelection(result.newScore, result.selection!)!;
  expect(captured).not.toBeNull();
  expect(captured.events).toEqual(captured.tracks![0]!.content);
  expect(captured.captureOrigin).toEqual(result.selection.rhythmicRange!.start);
  expect(captured.tracks).toHaveLength(tracks.length);
  for (const track of captured.tracks!) {
    const lead = track.leadIn ? (track.leadIn[0] / track.leadIn[1]) * 4 : 0;
    expect(lead + track.content.reduce((sum, item) => sum + sequenceContentBeats(item), 0)).toBe(beats);
  }
  expect(
    captured.tracks!.flatMap((track) => [...walkSequenceEvents(track.content)].map(({ event }) => event.id)).sort(),
  ).toEqual(placed.map((row) => row.event.id).sort());
  return captured;
}

function expectBar(score: Score, tracks: Track[], source: SequenceContent[][], measure: number) {
  for (const [index, track] of tracks.entries()) {
    const content = trackAt(score, track, measure).content;
    expect(profile(content)).toEqual(profile(source[index]!));
    expect(content.reduce((sum, item) => sum + sequenceContentBeats(item), 0)).toBe(4);
  }
}

function expectUnchanged(before: Score, after: Score) {
  expect(after.parts.at(-1)).toEqual(before.parts.at(-1));
  for (const [part, value] of before.parts.entries()) expect(after.parts[part]!.measures[0]).toEqual(value.measures[0]);
}

describe("automatic placed-selection clipboard round trips", () => {
  it.each(layouts)("retains an interior-only G voice through two whole-measure repeats (%s)", (layout) => {
    const { score, tracks, source } = fixture(layout);
    let current = score;
    let captured = buildClipboardSelection(score, wholeMeasure(tracks))!;
    for (const measure of [1, 2]) {
      const snapshot = structuredClone({ current, captured });
      const result = computeRepeatResult(current, captured)!;
      expect({ current, captured }).toEqual(snapshot);
      expectBar(result.newScore, tracks, source, measure);
      expectUnchanged(score, result.newScore);
      if (measure === 2) expectBar(result.newScore, tracks, source, 1);
      captured = recapture(result, tracks, measure * 4);
      expect(profile(captured.events)).toEqual([
        [0, 1, "C"],
        [1, 1, "C"],
        [2, 1, "C"],
        [3, 1, "C"],
      ]);
      current = result.newScore;
    }
  });

  it.each(layouts.flatMap((layout) => (["paste", "repeat"] as const).map((action) => ({ layout, action }))))(
    "copies the automatic paste selection into another $action ($layout)",
    ({ layout, action }) => {
      const { score, tracks, source } = fixture(layout);
      const original = buildClipboardSelection(score, wholeMeasure(tracks))!;
      const originalSnapshot = structuredClone({ score, original });
      const first = computePasteResult(
        score,
        wholeMeasure(tracks, 1),
        assignFreshTrackIds(original.events, original.tracks),
      )!;
      expect({ score, original }).toEqual(originalSnapshot);
      const copied = recapture(first, tracks, 4);
      const snapshot = structuredClone({ score, first, copied });
      const second =
        action === "repeat"
          ? computeRepeatResult(first.newScore, copied)!
          : computePasteResult(
              first.newScore,
              wholeMeasure(tracks, 2),
              assignFreshTrackIds(copied.events, copied.tracks),
            )!;
      recapture(second, tracks, 8);
      for (const measure of [1, 2]) expectBar(second.newScore, tracks, source, measure);
      expectUnchanged(score, second.newScore);
      expect({ score, first, copied }).toEqual(snapshot);
    },
  );

  it.each(["outer silence", "interior gaps"] as const)(
    "keeps four beats through two successive selections with %s",
    (shape) => {
      const primary =
        shape === "outer silence"
          ? [space(), note("g", "G", { base: "half" }), space()]
          : [space(), note("g-a", "G", { base: "eighth" }), space(), note("g-b", "G", { base: "eighth" }), space()];
      const { score, tracks, source } = fixture("single", primary);
      let current = score;
      let captured = buildClipboardSelection(score, wholeMeasure(tracks))!;
      for (const measure of [1, 2]) {
        const result = computeRepeatResult(current, captured)!;
        captured = recapture(result, tracks, measure * 4);
        expect(captured.tracks![0]!.leadIn).toBeUndefined();
        expect(captured.events[0]).toEqual(space());
        expect(profile(captured.events)).toEqual(profile(primary));
        for (let bar = 1; bar <= measure; bar++) expectBar(result.newScore, tracks, source, bar);
        expectUnchanged(score, result.newScore);
        current = result.newScore;
      }
    },
  );

  it.each(layouts)("remaps cross-track tie and slur targets on both automatic repeats (%s)", (layout) => {
    const { score, tracks, source: sourceContent } = fixture(layout);
    const source = trackAt(score, tracks[0]!, 0).content[1] as NoteEvent;
    const target = trackAt(score, tracks[1]!, 0).content[2] as NoteEvent;
    source.notes![0]!.pitch.step = "G";
    source.notes![0]!.ties = [{ target: target.notes![0]!.id }];
    source.slurs = [{ target: target.id!, startNote: source.notes![0]!.id, endNote: target.notes![0]!.id, side: "up" }];
    let current = score;
    let captured = buildClipboardSelection(score, wholeMeasure(tracks))!;
    for (const measure of [1, 2]) {
      const result = computeRepeatResult(current, captured)!;
      captured = recapture(result, tracks, measure * 4);
      const head = eventRows(trackAt(result.newScore, tracks[0]!, measure).content)[1]!.event;
      const tail = eventRows(trackAt(result.newScore, tracks[1]!, measure).content)[1]!.event;
      expect(head.notes![0]!.ties).toEqual([{ target: tail.notes![0]!.id }]);
      expect(head.slurs).toEqual([
        { target: tail.id, startNote: head.notes![0]!.id, endNote: tail.notes![0]!.id, side: "up" },
      ]);
      const oldIds = new Set(
        placedRows(current, tracks, 0, 16).flatMap(({ event }) => [event.id, ...event.notes!.map((n) => n.id)]),
      );
      for (const { event } of placedRows(result.newScore, tracks, measure * 4)) {
        for (const id of [event.id, ...event.notes!.map((n) => n.id)]) expect(oldIds.has(id)).toBe(false);
      }
      for (let bar = 1; bar <= measure; bar++) expectBar(result.newScore, tracks, sourceContent, bar);
      expectUnchanged(score, result.newScore);
      current = result.newScore;
    }
  });

  it.each(["voice", "reordered staff", "part"] as const)(
    "recopies split continuations but never remainder rests (%s)",
    (layout) => {
      const { score, tracks } = fixture(
        layout,
        [note("long-c", "C", { base: "half", dots: 1 }), rest("after-c", "quarter")],
        [note("long-g", "G", { base: "half", dots: 1 }), rest("after-g", "quarter")],
      );
      const last = trackAt(score, tracks[1]!, 0);
      let captured = buildClipboardSelection(score, {
        kind: "range",
        startElementId: "p0/m0/s0/long-c",
        endElementId: `${last.prefix}long-g`,
      })!;
      let current = score;
      for (const start of [3, 6]) {
        const snapshot = structuredClone({ current, captured });
        const result = computeRepeatResult(current, captured)!;
        expect({ current, captured }).toEqual(snapshot);
        captured = recapture(result, tracks, start, 3);
        for (const track of tracks) {
          const placed = placedRows(result.newScore, [track], start, 3);
          const expected =
            start === 3
              ? [
                  [3, 1],
                  [4, 2],
                ]
              : [
                  [6, 1],
                  [7, 1],
                  [8, 1],
                ];
          expect(placed.map((row) => [row.beat, row.beats, row.event.notes![0]!.pitch.step])).toEqual(
            expected.map(([beat, beats]) => [beat, beats, track === tracks[0] ? "C" : "G"]),
          );
          expect(placedRows(result.newScore, [track], 0, start)).toEqual(placedRows(current, [track], 0, start));
          expect(new Set(placed.map((row) => row.event.id)).size).toBe(placed.length);
          for (let i = 0; i < placed.length - 1; i++) {
            expect(placed[i]!.event.notes![0]!.ties).toEqual([{ target: placed[i + 1]!.event.notes![0]!.id }]);
          }
          expect(placed.at(-1)!.event.notes![0]!.ties ?? []).toEqual([]);
          const remainder = trackAt(result.newScore, track, start === 3 ? 1 : 2).content.at(-1) as NoteEvent;
          expect(remainder.rest).toEqual({});
          expect(
            captured.tracks!.flatMap((t) => [...walkSequenceEvents(t.content)].map(({ event }) => event.id)),
          ).not.toContain(remainder.id);
        }
        expect(result.newScore.parts.at(-1)).toEqual(score.parts.at(-1));
        current = result.newScore;
      }
    },
  );

  it.each(["tuplet", "grace"] as const)(
    "preserves %s containers and every child path through automatic recapture",
    (kind) => {
      const middle: SequenceContent[] =
        kind === "tuplet"
          ? [
              {
                type: "tuplet",
                inner: { multiple: 3, duration: { base: "quarter" } },
                outer: { multiple: 2, duration: { base: "quarter" } },
                content: [0, 1, 2].map((i) => note(`triplet-${i}`, "G")),
              },
            ]
          : [
              { type: "grace", content: [note("grace", "G", { base: "eighth" })] },
              note("principal", "G", { base: "half" }),
            ];
      const { score, tracks, source } = fixture("single", [space(), ...middle, space()]);
      let current = score;
      let captured = buildClipboardSelection(score, wholeMeasure(tracks))!;
      for (const measure of [1, 2]) {
        const result = computeRepeatResult(current, captured)!;
        captured = recapture(result, tracks, measure * 4);
        expect(captured.events.map((item) => item.type)).toEqual([
          "space",
          ...middle.map((item) => item.type),
          "space",
        ]);
        expect(profile(captured.events)).toEqual(profile(source[0]!));
        expectBar(result.newScore, tracks, source, measure);
        expectUnchanged(score, result.newScore);
        current = result.newScore;
      }
    },
  );
});
