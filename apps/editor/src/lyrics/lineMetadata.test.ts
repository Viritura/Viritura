import { describe, expect, it } from "vitest";
import type { PartMeasure, Score, SequenceContent } from "@viritura/core";
import { produce } from "../score/scoreClone";
import { createDocumentStore } from "../store/documentStore";
import { scoreHasLyrics } from "./lineMetadata";

function measure(content: SequenceContent[]): PartMeasure {
  return { sequences: [{ content }] };
}

describe("scoreHasLyrics", () => {
  it("reuses unchanged parts and measures after a localized edit", () => {
    let reads = 0;
    const observedMeasure = (): PartMeasure => ({
      sequences: [
        {
          get content() {
            reads++;
            return [];
          },
        },
      ],
    });
    const original: Score = {
      mnx: { version: 1 },
      global: { measures: [{}, {}, {}] },
      parts: [
        { name: "One", measures: [observedMeasure(), observedMeasure(), observedMeasure()] },
        { name: "Two", measures: [observedMeasure(), observedMeasure(), observedMeasure()] },
      ],
    };
    expect(scoreHasLyrics(original)).toBe(false);
    expect(reads).toBe(6);

    const updated: Score = {
      ...original,
      parts: [
        { ...original.parts[0]!, measures: [observedMeasure(), ...original.parts[0]!.measures.slice(1)] },
        original.parts[1]!,
      ],
    };
    reads = 0;
    expect(scoreHasLyrics(updated)).toBe(false);
    expect(reads).toBe(1);

    const withLyrics: Score = {
      ...updated,
      parts: [
        {
          ...updated.parts[0]!,
          measures: [
            measure([
              {
                type: "event",
                duration: { base: "quarter" },
                lyrics: { lines: { "1": { text: "la" } } },
              },
            ]),
            ...updated.parts[0]!.measures.slice(1),
          ],
        },
        updated.parts[1]!,
      ],
    };
    expect(scoreHasLyrics(withLyrics)).toBe(true);
    expect(scoreHasLyrics(updated)).toBe(false);
  });

  it("invalidates shared measures when beat repair removes their last lyric", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Piano",
          measures: [
            measure([
              { type: "event", duration: { base: "half" }, rest: {} },
              {
                type: "event",
                duration: { base: "half" },
                notes: [{ pitch: { step: "C", octave: 4 } }],
                lyrics: { lines: { "1": { text: "la" } } },
              },
            ]),
          ],
        },
      ],
    };
    const store = createDocumentStore();
    store.getState().loadScore(score);
    const before = store.getState().workingScore!;
    expect(scoreHasLyrics(before)).toBe(true);

    const after = produce(before, (draft) => {
      draft.global.measures[0]!.time = { count: 2, unit: 4 };
    });
    expect(after.parts[0]).toBe(before.parts[0]);
    store.getState().updateScore(after, { start: 0, end: 0 });

    expect(store.getState().workingScore?.parts[0]?.measures[0]?.sequences[0]?.content).toHaveLength(1);
    expect(scoreHasLyrics(store.getState().workingScore!)).toBe(false);
  });
});
