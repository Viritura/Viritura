import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { Note, NoteEvent } from "@viritura/core";
import { copyToClipboard, pasteFromClipboard, type ClipboardSelection } from "../../commands/clipboardCommands";
import { deserializeFragment } from "../deserialize";
import type { NotationClipboardWrite } from "../notationClipboard";
import { writeMuseScoreStaffList } from "@viritura/musescore-clipboard";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function sharp(id: string, target?: string): Note {
  return { id, pitch: { step: "C", octave: 4, alter: 1 }, ...(target ? { ties: [{ target }] } : {}) };
}

function flat(id: string, target?: string): Note {
  return { ...sharp(id, target), pitch: { step: "D", octave: 4, alter: -1 } };
}

function selection(...chords: Note[][]): ClipboardSelection {
  return {
    events: chords.map((notes): NoteEvent => ({ type: "event", duration: { base: "quarter" }, notes })),
    timeSignature: { count: 4, unit: 4 },
    keySignature: { fifths: 0 },
    partIndex: 0,
    measureIndex: 0,
    sequenceIndex: 0,
    eventIndex: 0,
  };
}

function reviewRepro(): ClipboardSelection {
  return selection([sharp("A"), sharp("B", "D"), flat("C", "E")], [sharp("D"), flat("E")]);
}

afterEach(() => {
  vi.mocked(invoke).mockReset();
  vi.unstubAllGlobals();
});

describe("ambiguous unison-chord tie export", () => {
  it("copies unchanged Viritura JSON with a specific warning and pastes the original tie identities", async () => {
    const source = reviewRepro();
    const before = structuredClone(source);
    const warning = vi.fn();
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockResolvedValue({ supported: true });

    expect(writeMuseScoreStaffList(source)).toMatchObject({
      xml: null,
      warning: expect.stringMatching(/unison-chord ties/),
    });
    expect(await copyToClipboard(source, warning)).toBe(true);
    expect(warning).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/unison-chord ties/));
    expect(invoke).toHaveBeenCalledExactlyOnceWith("notation_clipboard_write", {
      text: expect.any(String),
      museScore: null,
    });
    const written = vi.mocked(invoke).mock.calls[0]![1] as NotationClipboardWrite;
    expect(written.museScore).toBeNull();
    expect(deserializeFragment(written.text)!.content).toEqual(source.events);
    expect(source).toEqual(before);

    vi.mocked(invoke).mockResolvedValue({ ...written, supported: true });
    const pasted = await pasteFromClipboard();
    const [from, to] = pasted!.content as NoteEvent[];
    expect(from!.notes!.map((note) => note.pitch)).toEqual(
      (source.events[0] as NoteEvent).notes!.map((note) => note.pitch),
    );
    expect(to!.notes!.map((note) => note.pitch)).toEqual(
      (source.events[1] as NoteEvent).notes!.map((note) => note.pitch),
    );
    expect(from!.notes![0]!.ties).toBeUndefined();
    expect(from!.notes![1]!.ties).toEqual([{ target: to!.notes![0]!.id }]);
    expect(from!.notes![2]!.ties).toEqual([{ target: to!.notes![1]!.id }]);
    expect(source).toEqual(before);
  });
});
