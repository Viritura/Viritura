import { walkSequenceEvents, type NoteEvent, type SequenceContent } from "@viritura/core";
import { describe, expect, it } from "vitest";
import { assignFreshIds, assignFreshTrackIds, deserializeFragment } from "./deserialize";
import { serializeFragment } from "./serialize";

function note(id: string, target?: string): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base: "quarter" },
    notes: [{ id: `${id}-note`, pitch: { step: "C", octave: 4 } }],
    ...(target ? { lyrics: { lines: { verse: { text: "la", extender: { show: true, target } } } } } : {}),
  };
}

describe("lyric extender clipboard references", () => {
  it("remaps internal targets and preserves references outside the copied fragment", () => {
    const copied = assignFreshIds([note("source", "inside"), note("inside"), note("external-source", "outside")]);
    const events = [...walkSequenceEvents(copied)].map(({ event }) => event);

    expect(events[0]!.lyrics?.lines?.verse?.extender?.target).toBe(events[1]!.id);
    expect(events[0]!.id).not.toBe("source");
    expect(events[2]!.lyrics?.lines?.verse?.extender).toEqual({ show: true, target: "outside" });
  });
});

describe("glissando clipboard references", () => {
  it("remaps both endpoints independently on repeated copies without changing line properties or the source", () => {
    const source = note("source");
    source.glissandos = [
      {
        target: "target",
        kind: "portamento",
        style: "wavy",
        playbackType: "pitch-bend",
        text: "port.",
        showText: false,
      },
    ];
    const content = [source, note("target")];
    const snapshot = structuredClone(content);
    const first = [...walkSequenceEvents(assignFreshIds(content))].map(({ event }) => event);
    const second = [...walkSequenceEvents(assignFreshIds(content))].map(({ event }) => event);

    for (const copied of [first, second]) {
      expect(copied[0]!.glissandos).toEqual([{ ...source.glissandos[0], target: copied[1]!.id }]);
      expect(copied[0]!.id).not.toBe(source.id);
      expect(copied[1]!.id).not.toBe("target");
    }
    expect(first[0]!.id).not.toBe(second[0]!.id);
    expect(first[1]!.id).not.toBe(second[1]!.id);
    expect(content).toEqual(snapshot);
  });

  it("drops only glissandos whose targets are outside the fragment", () => {
    const source = note("source");
    source.glissandos = [{ target: "outside" }, { target: "inside", text: "gliss." }];
    const copied = [...walkSequenceEvents(assignFreshIds([source, note("inside")]))].map(({ event }) => event);
    const sourceOnly = [...walkSequenceEvents(assignFreshIds([source]))][0]!.event;

    expect(copied[0]!.glissandos).toEqual([{ target: copied[1]!.id, text: "gliss." }]);
    expect(sourceOnly.glissandos).toBeUndefined();
    expect(source.glissandos).toHaveLength(2);
  });

  it("remaps cross-track endpoints inside nested containers after serialization", () => {
    const source = note("source");
    source.glissandos = [{ target: "target", style: "straight" }];
    const content: SequenceContent[] = [{ type: "grace", content: [source] }];
    const tracks = [
      {
        partOffset: 0,
        staffOffset: 1,
        voiceIndex: 0,
        content: [
          {
            type: "tuplet",
            inner: { duration: { base: "eighth" }, multiple: 3 },
            outer: { duration: { base: "quarter" }, multiple: 1 },
            content: [note("target")],
          },
        ] satisfies SequenceContent[],
      },
      { partOffset: 0, staffOffset: 0, voiceIndex: 0, content },
    ];
    const snapshot = structuredClone({ content, tracks });
    const fragment = deserializeFragment(serializeFragment(content, { count: 4, unit: 4 }, { fifths: 0 }, tracks))!;
    const copied = assignFreshTrackIds(fragment.content, fragment.tracks);
    const copiedSource = [...walkSequenceEvents(copied.content)][0]!.event;
    const copiedTarget = [...walkSequenceEvents(copied.tracks![0]!.content)][0]!.event;

    expect(copiedSource.glissandos).toEqual([{ target: copiedTarget.id, style: "straight" }]);
    expect(copied.content).toBe(copied.tracks![1]!.content);
    expect({ content, tracks }).toEqual(snapshot);
  });
});
