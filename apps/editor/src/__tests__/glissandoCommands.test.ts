import { describe, expect, it } from "vitest";
import type { NoteEvent, Score } from "@viritura/core";
import {
  addGlissando,
  removeGlissandoByElementId,
  resolveGlissandoSelectionEvents,
  setGlissandoProperties,
} from "../commands/glissandoCommands";
import { getEventAtLocation } from "../score/ElementPath";

function buildScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m1" }] },
    parts: [
      {
        id: "keyboard.piano",
        name: "Piano",
        staves: 2,
        measures: [
          {
            sequences: [
              {
                staff: 1,
                content: [
                  {
                    type: "event",
                    id: "source",
                    duration: { base: "quarter" },
                    notes: [{ id: "source-note", pitch: { step: "C", octave: 4 } }],
                  },
                ],
              },
              {
                staff: 2,
                content: [
                  {
                    type: "event",
                    id: "target",
                    duration: { base: "quarter" },
                    notes: [{ id: "target-note", pitch: { step: "G", octave: 3 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function sourceEvent(score: Score): NoteEvent {
  return score.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent;
}

describe("glissando commands", () => {
  it("preserves source-first click order when adding a repeat return to a shared target", () => {
    const score = buildScore();
    const entry = sourceEvent(score);
    const targetSequence = score.parts[0]!.measures[0]!.sequences.splice(1)[0]!;
    score.global.measures.push({ repeatStart: {} }, { repeatEnd: {} });
    const returnSource: NoteEvent = { ...entry, id: "return-source" };
    score.parts[0]!.measures.push({ sequences: [targetSequence] }, { sequences: [{ content: [returnSource] }] });
    addGlissando(score, { sourceEventId: "source", targetEventId: "target" });
    const endpoints = resolveGlissandoSelectionEvents(
      score,
      {
        kind: "multi",
        elementIds: ["p0/m2/s0/return-source/n0", "p0/m1/s0/target/n0"],
      },
      0,
    );
    expect(endpoints.map((location) => getEventAtLocation(score, location)?.id)).toEqual(["return-source", "target"]);
    addGlissando(score, { sourceEventId: "return-source", targetEventId: "target" });
    expect(entry.glissandos).toEqual([{ target: "target", kind: "glissando", style: "wavy" }]);
    expect(returnSource.glissandos).toEqual(entry.glissandos);
    const removed = removeGlissandoByElementId(score, "gliss/return-source/target")!;
    expect(sourceEvent(removed).glissandos).toEqual(entry.glissandos);
    expect((removed.parts[0]!.measures[2]!.sequences[0]!.content[0] as NoteEvent).glissandos).toBeUndefined();
  });

  it("creates a semantic portamento across staves", () => {
    const score = buildScore();

    addGlissando(score, {
      sourceEventId: "source",
      targetEventId: "target",
      kind: "portamento",
      style: "straight",
      text: "port.",
    });

    expect(sourceEvent(score).glissandos).toEqual([
      { target: "target", kind: "portamento", style: "straight", text: "port." },
    ]);
  });

  it("defaults glissandos to wavy lines and portamento to straight lines", () => {
    const gliss = buildScore();
    addGlissando(gliss, { sourceEventId: "source", targetEventId: "target", kind: "glissando" });
    expect(sourceEvent(gliss).glissandos?.[0]?.style).toBe("wavy");

    const port = buildScore();
    addGlissando(port, { sourceEventId: "source", targetEventId: "target", kind: "portamento" });
    expect(sourceEvent(port).glissandos?.[0]?.style).toBe("straight");
  });

  it("rejects endpoints in different parts", () => {
    const score = buildScore();
    score.parts.push({
      id: "strings.violin",
      name: "Violin",
      measures: [
        {
          sequences: [
            {
              content: [
                {
                  type: "event",
                  id: "other-part",
                  duration: { base: "quarter" },
                  notes: [{ pitch: { step: "D", octave: 5 } }],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(() => addGlissando(score, { sourceEventId: "source", targetEventId: "other-part" })).toThrow("same part");
  });

  it("edits and removes a selected line without removing either endpoint", () => {
    const score = buildScore();
    addGlissando(score, { sourceEventId: "source", targetEventId: "target" });

    setGlissandoProperties(score, {
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
      kind: "portamento",
      style: "wavy",
      text: null,
    });
    expect(sourceEvent(score).glissandos).toEqual([{ target: "target", kind: "portamento", style: "wavy" }]);

    const removed = removeGlissandoByElementId(score, "gliss/source/target");
    expect(removed).not.toBeNull();
    expect(sourceEvent(removed!).glissandos).toBeUndefined();
    expect(removed!.parts[0]!.measures[0]!.sequences[1]!.content[0]).toMatchObject({ id: "target" });
  });

  it("removes a rendered line whose model endpoint IDs contain slashes", () => {
    const score = buildScore();
    sourceEvent(score).id = "source/1";
    const target = score.parts[0]!.measures[0]!.sequences[1]!.content[0] as NoteEvent;
    target.id = "target/1";
    addGlissando(score, { sourceEventId: "source/1", targetEventId: "target/1" });

    const removed = removeGlissandoByElementId(score, "gliss/source_1/target_1");

    expect(removed).not.toBeNull();
    expect(sourceEvent(removed!).glissandos).toBeUndefined();
  });
});
