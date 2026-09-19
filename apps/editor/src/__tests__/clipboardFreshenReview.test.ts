import { afterEach, describe, expect, it, vi } from "vitest";
import * as core from "@viritura/core";
import { walkSequenceEvents, type NoteEvent, type Score, type SequenceContent, type Tuplet } from "@viritura/core";
import type { ClipboardTrack } from "../clipboard/ClipboardFragment";
import { buildClipboardSelection } from "../clipboard/buildClipboardSelection";
import { assignFreshIds, assignFreshTrackIds, deserializeFragment } from "../clipboard/deserialize";
import { serializeFragment } from "../clipboard/serialize";
import { pasteResultFromFragment } from "../commands/clipboardCommands";

const time = { count: 4, unit: 4 };
const key = { fifths: 0 };

function note(id: string): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base: "quarter" },
    notes: [{ id: `${id}-note`, pitch: { step: "C", octave: 4 } }],
  };
}

function connect(source: NoteEvent, target: NoteEvent): void {
  source.slurs = [
    {
      target: target.id!,
      startNote: source.notes![0]!.id!,
      endNote: target.notes![0]!.id!,
      side: "up",
    },
  ];
  source.notes![0]!.ties = [{ target: target.notes![0]!.id! }];
}

function connectedTracks(): ClipboardTrack[] {
  const source = note("source");
  const target = note("target");
  connect(source, target);
  connect(target, source);
  return [
    { partOffset: 0, voiceIndex: 0, content: [source] },
    { partOffset: 1, voiceIndex: 1, staffOffset: 1, leadIn: [1, 8], content: [target] },
  ];
}

function tuplet(content: SequenceContent[]): Tuplet {
  return {
    type: "tuplet",
    inner: { duration: { base: "quarter" }, multiple: 3 },
    outer: { duration: { base: "quarter" }, multiple: 2 },
    content,
  };
}

function events(content: SequenceContent[]): NoteEvent[] {
  return [...walkSequenceEvents(content)].map(({ event }) => event);
}

function expectConnection(source: NoteEvent, target: NoteEvent): void {
  expect(source.slurs).toEqual([
    {
      target: target.id,
      startNote: source.notes![0]!.id,
      endNote: target.notes![0]!.id,
      side: "up",
    },
  ]);
  expect(source.notes![0]!.ties).toEqual([{ target: target.notes![0]!.id }]);
}

function allIds(tracks: ClipboardTrack[]): string[] {
  return tracks.flatMap((track) =>
    events(track.content).flatMap((event) => [event.id!, ...(event.notes ?? []).map((entry) => entry.id!)]),
  );
}

function freeze(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
}

afterEach(() => vi.restoreAllMocks());

describe("assignFreshTrackIds", () => {
  it("remaps cross-track slurs, their note endpoints, and ties in both directions", () => {
    const tracks = connectedTracks();
    const result = assignFreshTrackIds(tracks[0]!.content, tracks);
    const source = events(result.tracks![0]!.content)[0]!;
    const target = events(result.tracks![1]!.content)[0]!;

    expectConnection(source, target);
    expectConnection(target, source);
    expect(result.content).toBe(result.tracks![0]!.content);
    expect(allIds(result.tracks!)).not.toEqual(allIds(tracks));
    expect(result.tracks![1]).toMatchObject({
      partOffset: 1,
      voiceIndex: 1,
      staffOffset: 1,
      leadIn: [1, 8],
    });
  });

  it("shares maps across nested grace, nested tuplets, and multi-note tremolos", () => {
    const grace = note("grace");
    const nested = note("nested");
    const tremoloStart = note("tremolo-start");
    const tremoloEnd = note("tremolo-end");
    connect(grace, tremoloEnd);
    connect(tremoloEnd, nested);
    connect(nested, grace);
    const tracks: ClipboardTrack[] = [
      {
        partOffset: 0,
        voiceIndex: 0,
        content: [tuplet([{ type: "grace", slash: true, content: [grace] }])],
      },
      {
        partOffset: 0,
        voiceIndex: 1,
        content: [tuplet([tuplet([nested])])],
      },
      {
        partOffset: 1,
        voiceIndex: 0,
        content: [
          { type: "space", duration: [1, 8] },
          tuplet([
            {
              type: "tremolo",
              marks: 3,
              outer: { duration: { base: "half" }, multiple: 1 },
              content: [tremoloStart, tremoloEnd],
            },
          ]),
        ],
      },
    ];
    const generateId = vi.spyOn(core, "generateId");
    const result = assignFreshTrackIds(structuredClone(tracks[1]!.content), tracks);
    const freshGrace = events(result.tracks![0]!.content)[0]!;
    const freshNested = events(result.tracks![1]!.content)[0]!;
    const freshTremoloEnd = events(result.tracks![2]!.content)[1]!;

    expectConnection(freshGrace, freshTremoloEnd);
    expectConnection(freshTremoloEnd, freshNested);
    expectConnection(freshNested, freshGrace);
    expect(result.content).toBe(result.tracks![1]!.content);
    expect(result.tracks![2]!.content[0]).toEqual({ type: "space", duration: [1, 8] });
    expect(new Set(allIds(result.tracks!)).size).toBe(8);
    expect(generateId).toHaveBeenCalledTimes(8);
  });

  it("drops external targets, deletes external slur endpoints, and preserves targetless ties", () => {
    const tracks = connectedTracks();
    const source = events(tracks[0]!.content)[0]!;
    const target = events(tracks[1]!.content)[0]!;
    source.slurs = [
      { target: target.id!, startNote: "outside-start", endNote: "outside-end", side: "down" },
      { target: "outside-event", startNote: source.notes![0]!.id },
    ];
    source.notes![0]!.ties = [{ target: target.notes![0]!.id }, { target: "outside-note" }, { lv: true }, {}];
    source.notes!.push({
      id: "external-only",
      pitch: { step: "E", octave: 4 },
      ties: [{ target: "outside-note" }],
    });
    target.slurs = [{ target: "outside-event" }];
    target.notes![0]!.ties = [{ target: "outside-note" }];

    const result = assignFreshTrackIds(tracks[0]!.content, tracks);
    const freshSource = events(result.content)[0]!;
    const freshTarget = events(result.tracks![1]!.content)[0]!;

    expect(freshSource.slurs).toEqual([{ target: freshTarget.id, side: "down" }]);
    expect(freshSource.slurs![0]).not.toHaveProperty("startNote");
    expect(freshSource.slurs![0]).not.toHaveProperty("endNote");
    expect(freshSource.notes![0]!.ties).toEqual([{ target: freshTarget.notes![0]!.id }, { lv: true }, {}]);
    expect(freshSource.notes![1]).not.toHaveProperty("ties");
    expect(freshTarget).not.toHaveProperty("slurs");
    expect(freshTarget.notes![0]).not.toHaveProperty("ties");
  });

  it("clones content and track metadata without mutating frozen inputs", () => {
    const tracks = connectedTracks();
    tracks[0]!.clef = { sign: "G", staffPosition: -2 };
    const content = structuredClone(tracks[1]!.content);
    const original = structuredClone({ content, tracks });
    freeze(content);
    freeze(tracks);

    const result = assignFreshTrackIds(content, tracks);
    expect(result.content).toBe(result.tracks![1]!.content);
    expect(result.tracks).not.toBe(tracks);
    expect(result.tracks![0]).not.toBe(tracks[0]);
    expect(result.tracks![0]!.clef).not.toBe(tracks[0]!.clef);
    expect(result.tracks![1]!.leadIn).not.toBe(tracks[1]!.leadIn);
    expect(events(result.content)[0]!.notes![0]).not.toBe(events(content)[0]!.notes![0]);

    result.tracks![0]!.clef!.sign = "F";
    result.tracks![1]!.leadIn![0] = 7;
    events(result.content)[0]!.notes![0]!.pitch.step = "G";
    expect({ content, tracks }).toEqual(original);
  });

  it("freshens the duplicate primary only once after a serialization round trip", () => {
    const tracks = connectedTracks();
    const fragment = deserializeFragment(serializeFragment(tracks[1]!.content, time, key, tracks))!;
    expect(fragment.content).not.toBe(fragment.tracks![1]!.content);
    const generateId = vi.spyOn(core, "generateId");

    const result = assignFreshTrackIds(fragment.content, fragment.tracks);

    expect(generateId).toHaveBeenCalledTimes(4);
    expect(result.content).toBe(result.tracks![1]!.content);
    expectConnection(events(result.content)[0]!, events(result.tracks![0]!.content)[0]!);
  });

  it("finds a later primary by event ID even when its fallback content differs", () => {
    const tracks = connectedTracks();
    const content = structuredClone(tracks[1]!.content);
    delete events(content)[0]!.slurs;
    const result = assignFreshTrackIds(content, tracks);

    expect(result.content).toBe(result.tracks![1]!.content);
    expectConnection(events(result.content)[0]!, events(result.tracks![0]!.content)[0]!);
  });

  it("anchors legacy aggregate content to its first event's track rather than array order", () => {
    const tracks = connectedTracks();
    const content = structuredClone([...tracks[1]!.content, ...tracks[0]!.content]);
    const generateId = vi.spyOn(core, "generateId");
    const result = assignFreshTrackIds(content, tracks);

    expect(result.content).toBe(result.tracks![1]!.content);
    expect(result.content).toHaveLength(1);
    expect(generateId).toHaveBeenCalledTimes(4);
    expectConnection(events(result.content)[0]!, events(result.tracks![0]!.content)[0]!);
  });

  it("matches serialized anonymous primary content rather than defaulting to the first track", () => {
    const tracks: ClipboardTrack[] = [
      { partOffset: 0, voiceIndex: 0, content: [{ type: "event", duration: { base: "half" }, rest: {} }] },
      {
        partOffset: 0,
        voiceIndex: 1,
        content: [{ type: "event", duration: { base: "quarter" }, notes: [{ pitch: { step: "G", octave: 4 } }] }],
      },
    ];
    const fragment = deserializeFragment(serializeFragment(tracks[1]!.content, time, key, tracks))!;
    const result = assignFreshTrackIds(fragment.content, fragment.tracks);

    expect(result.content).toBe(result.tracks![1]!.content);
    expect(events(result.content)[0]!.notes![0]!.pitch.step).toBe("G");
    expect(events(result.content)[0]!.id).toEqual(expect.any(String));
    expect(events(result.content)[0]!.notes![0]!.id).toEqual(expect.any(String));
  });

  it("prefers original array identity when anonymous tracks have identical content", () => {
    const content: SequenceContent[] = [{ type: "event", duration: { base: "quarter" }, rest: {} }];
    const tracks: ClipboardTrack[] = [
      { partOffset: 0, voiceIndex: 0, content: structuredClone(content) },
      { partOffset: 0, voiceIndex: 1, content },
    ];
    const result = assignFreshTrackIds(content, tracks);

    expect(result.content).toBe(result.tracks![1]!.content);
  });

  it.each<{ content: SequenceContent[] }>([{ content: [] }, { content: [{ type: "space", duration: [1, 4] }] }])(
    "finds a later primary without events: %j",
    ({ content }) => {
      const tracks: ClipboardTrack[] = [
        { partOffset: 0, voiceIndex: 0, content: [note("other")] },
        { partOffset: 1, voiceIndex: 0, content: structuredClone(content) },
      ];
      const result = assignFreshTrackIds(content, tracks);

      expect(result.content).toBe(result.tracks![1]!.content);
      expect(result.content).toEqual(content);
      expect(result.content).not.toBe(content);
    },
  );

  it("treats unmatched fallback content as external when tracks are authoritative", () => {
    const tracks = connectedTracks();
    const source = events(tracks[0]!.content)[0]!;
    const unrelated = note("unrelated");
    source.slurs = [{ target: unrelated.id! }];
    source.notes![0]!.ties = [{ target: unrelated.notes![0]!.id! }];
    const generateId = vi.spyOn(core, "generateId");
    const result = assignFreshTrackIds([unrelated], tracks);

    expect(result.content).toBe(result.tracks![0]!.content);
    expect(events(result.content)[0]).not.toHaveProperty("slurs");
    expect(events(result.content)[0]!.notes![0]).not.toHaveProperty("ties");
    expect(generateId).toHaveBeenCalledTimes(4);
  });

  it("uses independent fresh ID maps on repeated paste", () => {
    const tracks = connectedTracks();
    const first = assignFreshTrackIds(tracks[1]!.content, tracks);
    const second = assignFreshTrackIds(tracks[1]!.content, tracks);
    const firstIds = new Set(allIds(first.tracks!));

    expect(allIds(second.tracks!).every((id) => !firstIds.has(id))).toBe(true);
    expect(first.content).not.toBe(second.content);
    expectConnection(events(second.content)[0]!, events(second.tracks![0]!.content)[0]!);
  });

  it.each<{ tracks?: ClipboardTrack[] }>([{ tracks: undefined }, { tracks: [] }])(
    "preserves flat connector semantics without populated tracks (%j)",
    ({ tracks }) => {
      const connected = connectedTracks();
      const content = connected.flatMap((track) => track.content);
      events(content)[0]!.notes![0]!.ties!.push({ target: "outside" }, { lv: true });
      const original = structuredClone(content);
      const result = assignFreshTrackIds(content, tracks);
      const source = events(result.content)[0]!;
      const target = events(result.content)[1]!;

      expectConnection(target, source);
      expect(source.notes![0]!.ties).toEqual([{ target: target.notes![0]!.id }, { lv: true }]);
      expect(result.tracks).toEqual(tracks);
      expect(content).toEqual(original);
      expect(result.content).not.toBe(content);
      if (tracks) expect(result.tracks).not.toBe(tracks);
    },
  );

  it("keeps the original assignFreshIds API working on nested flat content", () => {
    const source = note("source");
    const target = note("target");
    connect(source, target);
    const content: SequenceContent[] = [tuplet([{ type: "grace", content: [source] }, target])];
    const original = structuredClone(content);
    const result = assignFreshIds(content);

    expectConnection(events(result)[0]!, events(result)[1]!);
    expect(content).toEqual(original);
    expect(result).not.toBe(content);
  });
});

describe("fragment freshening integration", () => {
  it("preserves connectors from a built cross-part selection after tracks are reordered", () => {
    const tracks = connectedTracks();
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time }] },
      parts: tracks.map((track) => ({ measures: [{ sequences: [{ content: track.content }] }] })),
    };
    const selection = buildClipboardSelection(score, {
      kind: "range",
      startElementId: "p0/m0/s0/source",
      endElementId: "p1/m0/s0/target",
    })!;
    expect(selection.tracks).toHaveLength(2);
    const fragment = deserializeFragment(
      serializeFragment(
        selection.events,
        selection.timeSignature,
        selection.keySignature,
        [...selection.tracks!].reverse(),
      ),
    )!;
    const result = assignFreshTrackIds(fragment.content, fragment.tracks);

    expect(result.content).toBe(result.tracks![1]!.content);
    expectConnection(events(result.content)[0]!, events(result.tracks![0]!.content)[0]!);
  });

  it("returns the same fresh primary array through pasteResultFromFragment", () => {
    const tracks = connectedTracks();
    const fragment = deserializeFragment(serializeFragment(tracks[1]!.content, time, key, tracks))!;
    const original = structuredClone(fragment);
    const result = pasteResultFromFragment(fragment);

    expect(result.content).toBe(result.tracks![1]!.content);
    expectConnection(events(result.content)[0]!, events(result.tracks![0]!.content)[0]!);
    expectConnection(events(result.tracks![0]!.content)[0]!, events(result.content)[0]!);
    expect(result.sourceTimeSignature).toEqual(time);
    expect(result.sourceKeySignature).toEqual(key);
    expect(fragment).toEqual(original);
  });
});
