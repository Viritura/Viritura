import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { parseMnx } from "@viritura/format";
import {
  applyLyricDistributionPlan,
  buildLyricDistributionPlan,
  canCommitLyricPlan,
  inspectLyricWorkflow,
  parseVerse,
  repairLyricSource,
  sourceTextFromSelection,
} from "../lyrics";
import type { SelectionState } from "../store/selectionStore";

function scoreWithEvents(): Score {
  return parseMnx({
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 } }],
      lyrics: { lineMetadata: { verse: { label: "Verse 1", lang: "en" } }, lineOrder: ["verse"] },
    },
    parts: [
      {
        id: "voice-part",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    id: "event-1",
                    duration: { base: "quarter" },
                    notes: [
                      {
                        id: "note-1",
                        pitch: { step: "C", octave: 4 },
                        ties: [{ target: "note-2", targetType: "nextNote" }],
                      },
                    ],
                  },
                  {
                    id: "event-2",
                    duration: { base: "quarter" },
                    notes: [{ id: "note-2", pitch: { step: "C", octave: 4 } }],
                  },
                  { id: "event-3", duration: { base: "quarter" }, rest: {} },
                  {
                    id: "event-4",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "D", octave: 4 } }],
                  },
                ],
              },
              {
                content: [
                  {
                    id: "event-v2",
                    duration: { base: "whole" },
                    notes: [{ pitch: { step: "E", octave: 4 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
}

const fullRange: SelectionState = {
  kind: "range",
  startElementId: "p0/m0/s0/event-1",
  endElementId: "p0/m0/s0/event-4",
};

describe("lyric distribution", () => {
  it("preserves explicit hyphenation and expands explicit melisma skips", () => {
    expect(parseVerse("Hal-le-lu-jah __ sing").tokens).toEqual([
      { text: "Hal", type: "start" },
      { text: "le", type: "middle" },
      { text: "lu", type: "middle" },
      { text: "jah", type: "end" },
      { skip: true },
      { skip: true },
      { text: "sing" },
    ]);
  });

  it.each(["Hal\u2010le", "Hal\u2011le", "Hal\u00adle"])("recognizes pasted Unicode hyphenation in %s", (source) => {
    expect(parseVerse(source).tokens).toEqual([
      { text: "Hal", type: "start" },
      { text: "le", type: "end" },
    ]);
  });

  it("requires confirmation for language-aware generated syllables", () => {
    const parsed = parseVerse("hello singing", { languageAware: true, language: "en" });
    expect(parsed.tokens.map((token) => token.text)).toEqual(["hel", "lo", "sing", "ing"]);
    expect(parsed.requiresSyllabificationConfirmation).toBe(true);
  });

  it("reports ties, rests, token counts, collisions, and mixed voices before commit", () => {
    const score = scoreWithEvents();
    const plan = buildLyricDistributionPlan(score, fullRange, "verse", "one two three four five");
    expect(plan.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["too-many-tokens", "tie-continuation", "rest-destination"]),
    );
    expect(canCommitLyricPlan(plan, false)).toBe(false);
    expect(plan.issues.find((issue) => issue.code === "too-many-tokens")?.message).toContain(
      "1 token has no destination",
    );

    const mixedPlan = buildLyricDistributionPlan(
      score,
      { kind: "multi", elementIds: ["p0/m0/s0/event-1", "p0/m0/s1/event-v2"] },
      "verse",
      "one two",
    );
    expect(mixedPlan.issues.some((issue) => issue.code === "mixed-voice")).toBe(true);
  });

  it("commits a distribution atomically and keeps stable token identities across reflow", () => {
    const score = scoreWithEvents();
    const selection: SelectionState = {
      kind: "range",
      startElementId: "p0/m0/s0/event-1",
      endElementId: "p0/m0/s0/event-2",
    };
    const plan = buildLyricDistributionPlan(score, selection, "verse", "sing _");
    const distributed = applyLyricDistributionPlan(score, plan, false, "source-1");
    const firstTokenId = distributed.lyricWorkflow!.sources["source-1"]!.tokens[0]!.id;
    const firstEvent = distributed.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (firstEvent.type !== "event") throw new Error("Expected an event");
    expect(firstEvent.lyrics?.lines?.["verse"]?.text).toBe("sing");
    expect(distributed.lyricWorkflow?.sources["source-1"]?.text).toBe("sing _");

    const reflowPlan = buildLyricDistributionPlan(distributed, selection, "verse", "sing _", {
      replaceExisting: true,
    });
    const reflowed = applyLyricDistributionPlan(distributed, reflowPlan, false, "source-1");
    expect(reflowed.lyricWorkflow!.sources["source-1"]!.tokens[0]!.id).toBe(firstTokenId);
  });

  it("transfers overlapping token ownership when a new source replaces lyrics", () => {
    const score = scoreWithEvents();
    const selection: SelectionState = {
      kind: "range",
      startElementId: "p0/m0/s0/event-1",
      endElementId: "p0/m0/s0/event-2",
    };
    const first = applyLyricDistributionPlan(
      score,
      buildLyricDistributionPlan(score, selection, "verse", "old _"),
      false,
      "source-a",
    );
    const replacement = applyLyricDistributionPlan(
      first,
      buildLyricDistributionPlan(first, selection, "verse", "new _", { replaceExisting: true }),
      false,
      "source-b",
    );

    expect(replacement.lyricWorkflow?.sources["source-a"]).toBeUndefined();
    expect(replacement.lyricWorkflow?.sources["source-b"]?.tokens).toHaveLength(2);
    expect(inspectLyricWorkflow(replacement)).toEqual([]);
  });

  it("reconstructs a reflow source from ordinary MNX lyrics", () => {
    const score = scoreWithEvents();
    const first = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    const second = score.parts[0]!.measures[0]!.sequences[0]!.content[1]!;
    if (first.type !== "event" || second.type !== "event") throw new Error("Expected note events");
    first.lyrics = { lines: { verse: { text: "Hel", type: "start" } } };
    second.lyrics = { lines: { verse: { text: "lo", type: "end" } } };

    expect(
      sourceTextFromSelection(
        score,
        {
          kind: "range",
          startElementId: "p0/m0/s0/event-1",
          endElementId: "p0/m0/s0/event-4",
        },
        "verse",
      ),
    ).toBe("Hel-lo _ _");
  });

  it("detects deleted and revoiced anchors and supports explicit repairs", () => {
    const score = scoreWithEvents();
    const selection: SelectionState = {
      kind: "range",
      startElementId: "p0/m0/s0/event-1",
      endElementId: "p0/m0/s0/event-2",
    };
    const distributed = applyLyricDistributionPlan(
      score,
      buildLyricDistributionPlan(score, selection, "verse", "hello _"),
      false,
      "source-1",
    );
    const revoiced = structuredClone(distributed);
    const event = revoiced.parts[0]!.measures[0]!.sequences[0]!.content.shift()!;
    revoiced.parts[0]!.measures[0]!.sequences[1]!.content.push(event);
    expect(inspectLyricWorkflow(revoiced).some((issue) => issue.kind === "revoiced")).toBe(true);

    const followed = repairLyricSource(revoiced, "source-1", "follow-event");
    expect(inspectLyricWorkflow(followed)).toEqual([]);

    const deletedEvent = structuredClone(distributed);
    deletedEvent.parts[0]!.measures[0]!.sequences[0]!.content.shift();
    const orphaned = inspectLyricWorkflow(deletedEvent).filter((issue) => issue.kind === "orphaned");
    expect(orphaned).toHaveLength(1);
    const detached = repairLyricSource(
      deletedEvent,
      "source-1",
      "detach",
      new Set(orphaned.map((issue) => issue.tokenId)),
    );
    expect(detached.lyricWorkflow?.sources["source-1"]?.tokens[0]?.eventId).toBeUndefined();
    expect(detached.lyricWorkflow?.sources["source-1"]?.tokens[1]?.eventId).toBe("event-2");
  });
});
