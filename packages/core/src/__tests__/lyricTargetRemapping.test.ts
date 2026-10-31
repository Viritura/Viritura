import { expect, it } from "vitest";
import { remapLyricExtenderTargets, remapScoreLyricExtenderTargets } from "../operations";
import type { NoteEvent, Score, SequenceContent } from "../model";

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
