import { describe, expect, it } from "vitest";
import {
  resolveLyricExtenders,
  walkSequenceEvents,
  type NoteEvent,
  type Score,
  type SequenceContent,
} from "@viritura/core";
import { MnxYjsBridge } from "@viritura/crdt";
import { parseMnx, serializeMnx } from "@viritura/format";
import { applyPaste } from "../commands/clipboardCommands";
import {
  addNote,
  addRest,
  changeDuration,
  collapseRestOnlySequence,
  mergeAdjacentRests,
} from "../commands/noteCommands";
import { planPasteFragments } from "../clipboard/pasteContent/rhythmicFragments";
import { mergeDestinationIntoPaste } from "../clipboard/pasteMerge";
import { explodeFragment, reduceFragment } from "../score/chordDistribution";
import type { ClipboardFragment, ClipboardTrack } from "../clipboard/ClipboardFragment";
import { produce } from "../score/scoreClone";

function event(id: string, base: NoteEvent["duration"]["base"] = "quarter"): NoteEvent {
  return { type: "event", id, duration: { base }, notes: [{ id: `${id}-note`, pitch: { step: "C", octave: 4 } }] };
}

function attach(event: NoteEvent, target: string): void {
  event.lyrics = {
    lines: {
      verse: { text: "Ah", extender: { target, id: "span", _c: "retain", _x: { test: {} } } },
      hidden: { text: "Hidden", extender: { show: false, target, id: "hidden-span" } },
    },
  };
}

function score(): Score {
  return {
    mnx: { version: 1, support: { useLyricExtenders: true, useBeams: false } },
    global: { measures: [{ time: { count: 4, unit: 4 } }, {}], lyrics: { lineOrder: ["verse", "hidden"] } },
    parts: [
      {
        name: "Singer",
        measures: [
          { sequences: [{ content: [event("lead", "half"), event("lead2"), event("target")] }] },
          { sequences: [{ content: [event("rest", "whole")] }] },
        ],
      },
    ],
  };
}

function events(content: readonly SequenceContent[]): NoteEvent[] {
  return [...walkSequenceEvents(content)].map(({ event }) => event);
}

describe("lyric target lifecycle", () => {
  it.each(["note", "rest"] as const)(
    "preserves syllables and final retained targets when %s input splits an existing note",
    (kind) => {
      const original = score();
      attach(events(original.parts[0]!.measures[0]!.sequences[0]!.content)[2]!, "target");
      const params = {
        partIndex: 0,
        measureIndex: 0,
        voice: 0,
        beatPosition: 3.625,
        duration: { base: "eighth" as const },
      };
      const changed = produce(original, (draft) => {
        if (kind === "rest") addRest(draft, params);
        else addNote(draft, { ...params, pitch: { step: "E", octave: 4 } });
      });
      const content = events(changed.parts[0]!.measures[0]!.sequences[0]!.content);
      const first = content.find((item) => item.id === "target")!;
      const last = content[content.indexOf(first) + 1]!;
      expect(first.lyrics?.lines?.verse?.text).toBe("Ah");
      expect(last.lyrics).toBeUndefined();
      expect(first.lyrics?.lines?.verse?.extender?.target).toBe(last.id);
      expect(first.lyrics?.lines?.hidden?.extender?.target).toBe(last.id);
      expect(resolveLyricExtenders(changed).extenders[0]?.endBeat).toBe(3.625);
    },
  );
  it("moves self-targets to the final duration-edit fragment while preserving the first syllable and metadata", () => {
    const original = score();
    const target = events(original.parts[0]!.measures[0]!.sequences[0]!.content)[2]!;
    attach(target, target.id!);
    const changed = changeDuration(structuredClone(original), {
      partIndex: 0,
      measureIndex: 0,
      voice: 0,
      eventIndex: 2,
      newDuration: { base: "half" },
    });
    const first = events(changed.parts[0]!.measures[0]!.sequences[0]!.content)[2]!;
    const final = events(changed.parts[0]!.measures[1]!.sequences[0]!.content)[0]!;
    expect(first.id).toBe("target");
    expect(final.lyrics).toBeUndefined();
    expect(first.lyrics?.lines?.verse?.extender).toEqual({
      ...target.lyrics!.lines!.verse!.extender,
      target: final.id,
    });
    expect(first.lyrics?.lines?.hidden?.extender?.target).toBe(final.id);
    expect(resolveLyricExtenders(changed).extenders[0]).toMatchObject({
      sourceEventId: "target",
      targetEventId: final.id,
      endBeat: 5,
    });
    expect(changed.global).toEqual(original.global);
    expect(changed.mnx).toEqual(original.mnx);
    expect(target.lyrics?.lines?.verse?.extender?.target).toBe("target");
  });

  it("plans barline splits with the syllable on the first piece and self-target on the final piece", () => {
    const target = event("copied", "half");
    attach(target, "copied");
    const fragments = planPasteFragments(score(), 0, 3, [target]);
    const first = events(fragments[0]!.content)[0]!;
    const final = events(fragments[1]!.content)[0]!;
    expect(first.id).toBe("copied");
    expect(final.lyrics).toBeUndefined();
    expect(first.lyrics?.lines?.verse?.extender?.target).toBe(final.id);
    expect(first.lyrics?.lines?.hidden?.extender?.target).toBe(final.id);
    expect(target.lyrics?.lines?.verse?.extender?.target).toBe("copied");
  });

  it.each([false, true])(
    "remaps cross-track endpoints after every track is placed (separate parts=%s)",
    (separateParts) => {
      const destination = score();
      const rests = () => [{ ...event("empty", "whole"), notes: undefined, rest: {} }];
      destination.parts[0]!.measures = [
        { sequences: [{ content: rests() }, { content: rests() }] },
        { sequences: [{ content: rests() }, { content: rests() }] },
      ];
      if (separateParts)
        destination.parts.push({
          name: "Other",
          measures: [{ sequences: [{ content: rests() }] }, { sequences: [{ content: rests() }] }],
        });
      const source = event("source");
      attach(source, "copied-target");
      const tracks: ClipboardTrack[] = [
        {
          partOffset: 0,
          staffOffset: separateParts ? 1 : 0,
          voiceIndex: separateParts ? 0 : 1,
          leadIn: [3, 4],
          content: [event("copied-target", "half")],
        },
        { partOffset: 0, staffOffset: 0, voiceIndex: 0, content: [source] },
      ];
      const changed = applyPaste(destination, { content: tracks[0]!.content, tracks }, 0, 0, 0, 0);
      const finalSequence = changed.parts[separateParts ? 1 : 0]!.measures[1]!.sequences[separateParts ? 0 : 1]!;
      const final = events(finalSequence.content)[0]!;
      const placedSource = events(changed.parts[0]!.measures[0]!.sequences[0]!.content)[0]!;
      expect(placedSource.lyrics?.lines?.verse?.extender?.target).toBe(final.id);
      expect(placedSource.lyrics?.lines?.hidden?.extender?.target).toBe(final.id);
      expect(resolveLyricExtenders(changed).diagnostics).toEqual([]);
      expect(resolveLyricExtenders(changed).extenders[0]?.endBeat).toBe(5);
    },
  );

  it("remaps joined duration targets from another voice to the survivor", () => {
    const original = score();
    const source = event("source");
    attach(source, "lead2");
    original.parts[0]!.measures[0]!.sequences.push({ voice: "singer", content: [source] });
    const changed = changeDuration(original, {
      partIndex: 0,
      measureIndex: 0,
      voice: 0,
      eventIndex: 0,
      newDuration: { base: "whole" },
    });

    expect(source.lyrics?.lines?.verse?.extender?.target).toBe("lead");
    expect(source.lyrics?.lines?.hidden?.extender?.target).toBe("lead");
    expect(resolveLyricExtenders(changed).diagnostics).toEqual([]);
  });

  it("carries targets absorbed by an intermediate bar through to the final grown fragment", () => {
    const original = score();
    const source = event("source");
    attach(source, "rest");
    original.parts[0]!.measures[0]!.sequences.push({ voice: "singer", content: [source] });
    const changed = changeDuration(original, {
      partIndex: 0,
      measureIndex: 0,
      voice: 0,
      eventIndex: 2,
      newDuration: { base: "breve" },
    });
    const final = events(changed.parts[0]!.measures[2]!.sequences[0]!.content)[0]!;
    expect(source.lyrics?.lines?.verse?.extender?.target).toBe(final.id);
    expect(source.lyrics?.lines?.hidden?.extender?.target).toBe(final.id);
    expect(resolveLyricExtenders(changed).extenders[0]?.endBeat).toBe(11);
  });

  it("remaps cross-part targets when rests join", () => {
    const original = score();
    const sequence = original.parts[0]!.measures[0]!.sequences[0]!;
    sequence.content = [event("left"), event("right")].map((item) => ({ ...item, notes: undefined, rest: {} }));
    const source = event("source");
    attach(source, "right");
    original.parts.push({ name: "Other", measures: [{ sequences: [{ content: [source] }] }] });
    mergeAdjacentRests(sequence, undefined, undefined, original);
    const joined = events(sequence.content)[0]!;
    expect(joined.duration).toEqual({ base: "half" });
    expect(source.lyrics?.lines?.verse?.extender?.target).toBe(joined.id);
    expect(source.lyrics?.lines?.hidden?.extender?.target).toBe(joined.id);
  });

  it("keeps rest syllable anchors when normalizing a joined silent measure", () => {
    const original = score();
    const sequence = original.parts[0]!.measures[0]!.sequences[0]!;
    const source = { ...event("rest-source"), notes: undefined, rest: {} };
    attach(source, "rest-source");
    sequence.content = [source, { ...event("next-rest"), notes: undefined, rest: {} }];
    mergeAdjacentRests(sequence, undefined, undefined, original);
    collapseRestOnlySequence(sequence);
    expect(sequence.fullMeasure).toBeUndefined();
    expect(events(sequence.content)[0]?.lyrics).toEqual(source.lyrics);
  });

  function fragment(content: SequenceContent[]): ClipboardFragment {
    return {
      type: "viritura/fragment",
      version: 4,
      timeSignature: { count: 4, unit: 4 },
      keySignature: { fifths: 0 },
      content,
      tracks: [{ partOffset: 0, staffOffset: 0, voiceIndex: 0, content }],
    };
  }

  it("remaps unique reduced targets to the merged event, including self-targets", () => {
    const source = event("source");
    attach(source, "target");
    const copied = fragment([source]);
    copied.tracks!.push({ partOffset: 1, staffOffset: 1, voiceIndex: 0, content: [event("target")] });
    const reduced = reduceFragment(copied);
    const merged = events(reduced.content)[0]!;
    expect(merged.lyrics?.lines?.verse?.extender?.target).toBe(merged.id);
    expect(merged.lyrics?.lines?.hidden?.extender?.target).toBe(merged.id);
  });

  it("preserves ambiguous exploded references and reports existing actionable invalid-target diagnostics", () => {
    const chord = event("chord");
    chord.notes!.push({ id: "upper", pitch: { step: "G", octave: 4 } });
    attach(chord, "chord");
    const exploded = explodeFragment(fragment([chord]), 2);
    const changed = score();
    changed.parts = exploded.tracks!.map((track) => ({
      name: "Singer",
      measures: [{ sequences: [{ content: track.content }] }],
    }));
    for (const part of changed.parts) {
      const placed = events(part.measures[0]!.sequences[0]!.content)[0]!;
      expect(placed.lyrics?.lines?.verse?.extender?.target).toBe("chord");
      expect(placed.lyrics?.lines?.hidden?.extender?.target).toBe("chord");
    }
    expect(resolveLyricExtenders(changed).extenders).toEqual([]);
    expect(resolveLyricExtenders(changed).diagnostics.map((issue) => issue.code)).toEqual([
      "missing-target",
      "missing-target",
    ]);
  });

  it("joins destination targets and lyric metadata into the pasted survivor", () => {
    const original = score();
    const source = event("source");
    attach(source, "lead2");
    original.parts.push({ name: "Other", measures: [{ sequences: [{ content: [source] }] }] });
    const placed: SequenceContent[] = [];
    const changed = applyPaste(original, { content: [event("pasted")] }, 0, 0, 0, 1, placed);
    mergeDestinationIntoPaste(original, changed, placed);
    const remote = events(changed.parts[1]!.measures[0]!.sequences[0]!.content)[0]!;
    expect(remote.lyrics?.lines?.verse?.extender?.target).toBe("pasted");
    expect(remote.lyrics?.lines?.hidden?.extender?.target).toBe("pasted");
  });

  it("persists duration-edit endpoint mappings and hidden metadata through the CRDT bridge", () => {
    const original = score();
    attach(events(original.parts[0]!.measures[0]!.sequences[0]!.content)[2]!, "target");
    const changed = changeDuration(structuredClone(original), {
      partIndex: 0,
      measureIndex: 0,
      voice: 0,
      eventIndex: 2,
      newDuration: { base: "half" },
    });
    const bridge = new MnxYjsBridge();
    bridge.setMnxJson(JSON.stringify(serializeMnx(original)));
    bridge.setMnxJson(JSON.stringify(serializeMnx(changed)));
    const synced = parseMnx(JSON.parse(bridge.getMnxJson()));
    expect(resolveLyricExtenders(synced).extenders[0]?.endBeat).toBe(5);
    expect(events(synced.parts[0]!.measures[0]!.sequences[0]!.content)[2]!.lyrics).toEqual(
      events(changed.parts[0]!.measures[0]!.sequences[0]!.content)[2]!.lyrics,
    );
    bridge.setMnxJson(JSON.stringify(serializeMnx(original)));
    const restored = parseMnx(JSON.parse(bridge.getMnxJson()));
    expect(
      events(restored.parts[0]!.measures[0]!.sequences[0]!.content)[2]!.lyrics?.lines?.verse?.extender?.target,
    ).toBe("target");
    bridge.doc.destroy();
  });
});
