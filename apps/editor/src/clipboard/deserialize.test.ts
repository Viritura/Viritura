import { walkSequenceEvents, type NoteEvent } from "@viritura/core";
import { describe, expect, it } from "vitest";
import { assignFreshIds } from "./deserialize";

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
  it("remaps internal targets and drops targets outside the copied fragment", () => {
    const copied = assignFreshIds([note("source", "inside"), note("inside"), note("external-source", "outside")]);
    const events = [...walkSequenceEvents(copied)].map(({ event }) => event);

    expect(events[0]!.lyrics?.lines?.verse?.extender?.target).toBe(events[1]!.id);
    expect(events[0]!.id).not.toBe("source");
    expect(events[2]!.lyrics?.lines?.verse?.extender).toEqual({ show: true });
  });
});
