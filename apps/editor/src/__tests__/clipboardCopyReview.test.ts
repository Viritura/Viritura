import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteEvent, Score } from "@viritura/core";
import * as museScore from "../clipboard/museScore";
import { deserializeFragment } from "../clipboard/deserialize";
import { NotationClipboardError, readNotationClipboard, writeNotationClipboard } from "../clipboard/notationClipboard";
import {
  applyPaste,
  copyToClipboard,
  cutToClipboard,
  pasteFromClipboard,
  type ClipboardSelection,
} from "../commands/clipboardCommands";

vi.mock("../clipboard/notationClipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../clipboard/notationClipboard")>()),
  writeNotationClipboard: vi.fn(),
  readNotationClipboard: vi.fn(),
}));

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(writeNotationClipboard).mockReset();
  vi.mocked(readNotationClipboard).mockReset();
});

describe("clipboard export failure review", () => {
  it("still writes internal JSON and warns when the MuseScore converter throws", async () => {
    const source = selection();
    vi.spyOn(museScore, "writeMuseScoreStaffList").mockImplementation(() => {
      throw new Error("unsupported notation");
    });
    const warning = vi.fn();
    expect(await copyToClipboard(source, warning)).toBe(true);
    expect(warning).toHaveBeenCalledWith(expect.stringMatching(/MuseScore/));
    expect(writeNotationClipboard).toHaveBeenCalledTimes(1);
    const written = vi.mocked(writeNotationClipboard).mock.calls[0]![0];
    expect(written.museScore).toBeNull();
    expect(deserializeFragment(written.text)!.content).toEqual(source.events);
  });

  it("continues to write supported MuseScore data alongside internal JSON", async () => {
    const warning = vi.fn();
    expect(await copyToClipboard(selection(), warning)).toBe(true);
    const written = vi.mocked(writeNotationClipboard).mock.calls[0]![0];
    expect(written.museScore?.mime).toBe(museScore.MUSESCORE_STAFF_LIST_MIME);
    expect(written.museScore?.xml).toContain("<StaffList");
    expect(deserializeFragment(written.text)).not.toBeNull();
    expect(warning).not.toHaveBeenCalled();
  });

  it("keeps returned unsupported-export warnings while writing internal JSON", async () => {
    vi.spyOn(museScore, "writeMuseScoreStaffList").mockReturnValue({ xml: null, warning: "Unsupported selection" });
    const warning = vi.fn();
    expect(await copyToClipboard(selection(), warning)).toBe(true);
    expect(warning).toHaveBeenCalledWith("Unsupported selection");
    expect(writeNotationClipboard).toHaveBeenCalledWith({ text: expect.any(String), museScore: null });
  });

  it.each<{ name: string; event: Partial<NoteEvent>; warning: string }>([
    { name: "snare kit note", event: { kitNotes: [{ kitComponent: "snare" }] }, warning: "percussion kit" },
    { name: "rest slur", event: { rest: {}, slurs: [{ target: "next" }] }, warning: "slurs" },
    { name: "rest glissando", event: { rest: {}, glissandos: [{ target: "next" }] }, warning: "glissandos" },
    { name: "rest articulation", event: { rest: {}, markings: { accent: {} } }, warning: "rest markings" },
    { name: "rest ornament", event: { rest: {}, markings: { ornaments: ["mordent"] } }, warning: "ornaments" },
    { name: "implicit rest ornament", event: { markings: { ornaments: ["mordent"] } }, warning: "ornaments" },
    {
      name: "pitched ornament",
      event: { notes: [{ pitch: { step: "C", octave: 4 } }], markings: { ornaments: ["mordent"] } },
      warning: "ornaments",
    },
  ])("preserves $name as JSON with a warning, never a misleading StaffList rest", async ({ event, warning }) => {
    const source = selection();
    source.events = [{ type: "event", duration: { base: "quarter" }, ...event }];
    const snapshot = structuredClone(source);
    const warn = vi.fn();

    expect(await copyToClipboard(source, warn)).toBe(true);
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(warning));
    expect(writeNotationClipboard).toHaveBeenCalledTimes(1);
    const written = vi.mocked(writeNotationClipboard).mock.calls[0]![0];
    expect(written.museScore).toBeNull();
    expect(deserializeFragment(written.text)!.content).toEqual(source.events);
    expect(source).toEqual(snapshot);
  });

  it("warns and retains an unsupported ornament on a grace note instead of dropping it", async () => {
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
    const warn = vi.fn();
    expect(await copyToClipboard(source, warn)).toBe(true);
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("ornaments"));
    const written = vi.mocked(writeNotationClipboard).mock.calls[0]![0];
    expect(written.museScore).toBeNull();
    expect(deserializeFragment(written.text)!.content).toEqual(source.events);
  });

  it("does not silently change makeTime grace groups into stealFollowing", async () => {
    const source = selection();
    source.events.unshift({
      type: "grace",
      graceType: "makeTime",
      content: [structuredClone(source.events[0] as NoteEvent)],
    });
    const warn = vi.fn();
    expect(await copyToClipboard(source, warn)).toBe(true);
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("makeTime"));
    const written = vi.mocked(writeNotationClipboard).mock.calls[0]![0];
    expect(written.museScore).toBeNull();
    expect(deserializeFragment(written.text)!.content).toEqual(source.events);
  });

  it.each(["native", "browser"] as const)("keeps cut best-effort on %s write failure", async (backend) => {
    vi.mocked(writeNotationClipboard).mockRejectedValue(
      new NotationClipboardError("write", backend, new Error("denied")),
    );
    const source = selection();
    const snapshot = structuredClone(source);
    const cut = await cutToClipboard(source, vi.fn());
    expect(cut).toMatchObject({
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
      replacements: [{ type: "event", duration: { base: "quarter" }, rest: {} }],
    });
    expect(source).toEqual(snapshot);
  });

  it("uses shared fresh primary content when importing MuseScore data", async () => {
    const source = selection();
    const first = source.events[0] as NoteEvent;
    const second = structuredClone(first);
    second.id = "second";
    second.notes![0]!.id = "second-note";
    first.slurs = [{ target: second.id }];
    first.notes![0]!.ties = [{ target: second.notes![0]!.id }];
    vi.mocked(readNotationClipboard).mockResolvedValue({
      text: "",
      museScore: { mime: museScore.MUSESCORE_STAFF_LIST_MIME, xml: "<StaffList />" },
      nativeFormatsSupported: true,
    });
    vi.spyOn(museScore, "readMuseScoreClipboard").mockReturnValue({
      content: [second],
      tracks: [
        { partOffset: 0, staffOffset: 0, voiceIndex: 0, content: [first] },
        { partOffset: 0, staffOffset: 1, voiceIndex: 0, content: [second] },
      ],
    });
    const paste = (await pasteFromClipboard())!;
    const freshFirst = paste.tracks![0]!.content[0] as NoteEvent;
    const freshSecond = paste.content[0] as NoteEvent;
    expect(paste.content).toBe(paste.tracks![1]!.content);
    expect(freshFirst.slurs).toEqual([{ target: freshSecond.id }]);
    expect(freshFirst.notes![0]!.ties).toEqual([{ target: freshSecond.notes![0]!.id }]);
  });

  it.each(["breve", "longa"] as const)("round-trips a real MuseScore %s through cross-bar paste", async (base) => {
    const source = selection();
    (source.events[0] as NoteEvent).duration = { base };
    const xml = museScore.writeMuseScoreStaffList(source).xml!;
    expect(xml).toContain(`<durationType>${base}</durationType>`);
    vi.mocked(readNotationClipboard).mockResolvedValue({
      text: "",
      museScore: { mime: museScore.MUSESCORE_STAFF_LIST_MIME, xml },
      nativeFormatsSupported: true,
    });
    const paste = (await pasteFromClipboard())!;
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [{ measures: [{ sequences: [{ content: [] }] }] }],
    };
    const result = applyPaste(score, paste, 0, 0, 0, 0);
    const placed = result.parts[0]!.measures.map((measure) => measure.sequences[0]!.content[0] as NoteEvent);
    expect(placed).toHaveLength(base === "breve" ? 2 : 4);
    expect(placed[0]!.id).toBe((paste.content[0] as NoteEvent).id);
    expect(placed.every((event) => event.duration.base === "whole")).toBe(true);
    for (let index = 0; index < placed.length - 1; index++) {
      expect(placed[index]!.notes![0]!.ties).toEqual([{ target: placed[index + 1]!.notes![0]!.id }]);
    }
  });
});
