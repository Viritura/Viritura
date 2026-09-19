import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteEvent } from "@viritura/core";
import { deserializeFragment } from "../clipboard/deserialize";
import { copyToClipboard, type ClipboardSelection } from "../commands/clipboardCommands";

function selection(): ClipboardSelection {
  return {
    events: [
      {
        type: "event",
        id: "event",
        duration: { base: "quarter" },
        notes: [{ id: "note", pitch: { step: "C", octave: 4 } }],
      },
    ],
    timeSignature: { count: 4, unit: 4 },
    keySignature: { fifths: 0 },
    partIndex: 0,
    measureIndex: 0,
    sequenceIndex: 0,
    eventIndex: 0,
  };
}

async function expectCopyRoundTrip(source: ClipboardSelection): Promise<void> {
  const snapshot = structuredClone(source);
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });

  expect(await copyToClipboard(source)).toBe(true);
  expect(writeText).toHaveBeenCalledTimes(1);
  const [text] = writeText.mock.calls[0]!;
  const fragment = deserializeFragment(text);
  expect(fragment).not.toBeNull();
  expect(fragment!.content).toEqual(snapshot.events);
  expect(fragment!.timeSignature).toEqual(snapshot.timeSignature);
  expect(fragment!.keySignature).toEqual(snapshot.keySignature);
  expect(source).toEqual(snapshot);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clipboard copy JSON fidelity review", () => {
  it.each<{ name: string; event: Partial<NoteEvent> }>([
    { name: "snare kit note", event: { kitNotes: [{ kitComponent: "snare" }] } },
    { name: "rest slur", event: { rest: {}, slurs: [{ target: "next" }] } },
    { name: "rest glissando", event: { rest: {}, glissandos: [{ target: "next" }] } },
    { name: "rest articulation", event: { rest: {}, markings: { accent: {} } } },
    { name: "rest ornament", event: { rest: {}, markings: { ornaments: ["mordent"] } } },
    { name: "implicit rest ornament", event: { markings: { ornaments: ["mordent"] } } },
    {
      name: "pitched ornament",
      event: { notes: [{ pitch: { step: "C", octave: 4 } }], markings: { ornaments: ["mordent"] } },
    },
  ])("preserves $name through JSON roundtrip without mutating the source", async ({ event }) => {
    const source = selection();
    source.events = [{ type: "event", duration: { base: "quarter" }, ...event }];

    await expectCopyRoundTrip(source);
  });

  it("preserves an ornament on a grace note through JSON roundtrip without mutating the source", async () => {
    const source = selection();
    source.events.unshift({
      type: "grace",
      content: [
        {
          type: "event",
          duration: { base: "eighth" },
          notes: [{ pitch: { step: "D", octave: 4 } }],
          markings: { ornaments: ["mordent"] },
        },
      ],
    });

    await expectCopyRoundTrip(source);
  });

  it("preserves makeTime grace groups through JSON roundtrip without mutating the source", async () => {
    const source = selection();
    source.events.unshift({
      type: "grace",
      graceType: "makeTime",
      content: [structuredClone(source.events[0] as NoteEvent)],
    });

    await expectCopyRoundTrip(source);
  });
});
