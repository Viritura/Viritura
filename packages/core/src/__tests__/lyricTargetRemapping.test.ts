import { expect, it } from "vitest";
import { isDraft, produce } from "immer";
import { remapLyricExtenderTargets, remapScoreLyricExtenderTargets } from "../operations";
import type { NoteEvent, Score, SequenceContent } from "../model";

it("does not inspect score branches for identity-only target mappings", () => {
  const score: Score = {
    mnx: { version: 1 },
    global: { measures: [] },
    get parts(): Score["parts"] {
      throw new Error("identity target remapping must not traverse the score");
    },
  };
  expect(() => remapScoreLyricExtenderTargets(score, new Map([["event", "event"]]))).not.toThrow();
});

function source(target: string): NoteEvent {
  return {
    type: "event",
    duration: { base: "quarter" },
    notes: [{ pitch: { step: "C", octave: 4 } }],
    lyrics: {
      lines: { hidden: { text: "Ah", extender: { target, show: false, id: "span", _c: "retain", _x: { test: {} } } } },
    },
  };
}

it("remaps stored hidden targets through nested containers and split/join chains without changing metadata", () => {
  const leaf = source("original");
  const grace = source("original");
  const tremolo = source("external");
  const content: SequenceContent[] = [
    {
      type: "tuplet",
      inner: { duration: { base: "quarter" }, multiple: 3 },
      outer: { duration: { base: "quarter" }, multiple: 2 },
      content: [leaf, { type: "grace", content: [grace] }],
    },
    { type: "tremolo", marks: 3, outer: { duration: { base: "half" }, multiple: 1 }, content: [tremolo] },
  ];
  const metadata = { ...leaf.lyrics!.lines!.hidden!.extender };
  remapLyricExtenderTargets(
    content,
    new Map([
      ["original", "final-fragment"],
      ["final-fragment", "joined"],
    ]),
  );
  expect(leaf.lyrics!.lines!.hidden!.extender).toEqual({ ...metadata, target: "joined" });
  expect(grace.lyrics!.lines!.hidden!.extender?.target).toBe("joined");
  expect(tremolo.lyrics!.lines!.hidden!.extender?.target).toBe("external");
});

it("remaps all parts and voices while preserving document policy and global lyric metadata", () => {
  const score: Score = {
    mnx: { version: 1, support: { useLyricExtenders: true, useBeams: false } },
    global: { measures: [{}], lyrics: { lineOrder: ["hidden"] } },
    parts: [0, 1].map(() => ({
      name: "Singer",
      measures: [{ sequences: [0, 1].map(() => ({ content: [source("old")] })) }],
    })),
  };
  const global = structuredClone(score.global);
  const policy = structuredClone(score.mnx);
  remapScoreLyricExtenderTargets(score, new Map([["old", "new"]]));
  for (const part of score.parts) {
    for (const sequence of part.measures[0]!.sequences) {
      expect((sequence.content[0] as NoteEvent).lyrics?.lines?.hidden?.extender?.target).toBe("new");
    }
  }
  expect(score.global).toEqual(global);
  expect(score.mnx).toEqual(policy);
});

it("plans from current draft references without drafting unrelated lyric-free events", () => {
  const carrier = source("original");
  const unrelated: NoteEvent = {
    type: "event",
    id: "unrelated",
    duration: { base: "quarter" },
    notes: [{ pitch: { step: "C", octave: 4 } }],
    get lyrics() {
      if (isDraft(this)) throw new Error("unrelated events must not be materialized as drafts");
      return undefined;
    },
  };
  const original: Score = {
    mnx: { version: 1, support: { useLyricExtenders: true } },
    global: { measures: [{}] },
    parts: [
      { name: "Singer", measures: [{ sequences: [{ content: [carrier] }] }] },
      { name: "Other", measures: [{ sequences: [{ content: [unrelated] }] }] },
    ],
  };
  const changed = produce(original, (draft) => {
    const event = draft.parts[0]!.measures[0]!.sequences[0]!.content[0];
    if (event?.type !== "event") throw new Error("Expected carrier");
    event.lyrics!.lines!.hidden!.extender!.target = "in-flight";
    remapScoreLyricExtenderTargets(draft, new Map([["in-flight", "final-fragment"]]));
  });
  const changedCarrier = changed.parts[0]!.measures[0]!.sequences[0]!.content[0];
  if (changedCarrier?.type !== "event") throw new Error("Expected carrier");
  expect(changedCarrier.lyrics?.lines?.hidden?.extender).toEqual({
    ...carrier.lyrics!.lines!.hidden!.extender,
    target: "final-fragment",
  });
  expect(carrier.lyrics!.lines!.hidden!.extender?.target).toBe("original");
  expect(changed.parts[1]).toBe(original.parts[1]);
});

it("handles new references on a previously lyric-free mutable score without a stale negative cache", () => {
  const event: NoteEvent = { type: "event", duration: { base: "quarter" }, rest: {} };
  const score: Score = {
    mnx: { version: 1 },
    global: { measures: [{}] },
    parts: [{ name: "Singer", measures: [{ sequences: [{ content: [event] }] }] }],
  };
  const replacements = new Map([["original", "final"]]);
  remapScoreLyricExtenderTargets(score, replacements);
  event.lyrics = source("original").lyrics;
  remapScoreLyricExtenderTargets(score, replacements);
  expect(event.lyrics?.lines?.hidden?.extender?.target).toBe("final");
});
