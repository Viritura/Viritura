import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { ChordSymbol, NoteEvent, Score, Sequence, SequenceContent } from "@viritura/core";
import { useClipboardActions } from "./useClipboardActions";
import { createDocumentStore } from "../store/documentStore";
import { createHistoryStore } from "../store/historyStore";
import { addClipboardEntry, clearClipboardHistory, useClipboardHistoryStore } from "../store/clipboardHistoryStore";
import { useNoteInputStore } from "../store/noteInputStore";
import { lyricElementId } from "../score/ElementPath";
import { resetSelectionStore, useSelection, useSelectionActions, type SelectionState } from "../store/selectionStore";
import { sequenceContentBeats } from "../commands/noteCommands";
import type { ClipboardSelection } from "../commands/clipboardCommands";
import { FRAGMENT_VERSION, type ClipboardFragment } from "../clipboard/ClipboardFragment";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

const readText = vi.fn<() => Promise<string>>();
const writeText = vi.fn<(text: string) => Promise<void>>();

function scoreWithLyric(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "source",
                    duration: { base: "quarter" },
                    notes: [{ id: "source-note", pitch: { step: "C", octave: 4 } }],
                    lyrics: { lines: { verse: { text: "Sing" } } },
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

const noteSelection: SelectionState = { kind: "single", elementType: "event", elementId: "p0/m0/s0/source" };
const lyricSelection: SelectionState = {
  kind: "single",
  elementType: "lyric",
  elementId: lyricElementId("p0/m0/s0/source", "verse"),
};

function harness(selection: SelectionState = noteSelection, score = scoreWithLyric()) {
  const store = createDocumentStore();
  store.setState({ score });
  const updateScore = vi.fn<(next: Score) => void>();
  const selectElement = vi.fn();
  const selectRange = vi.fn();
  const hook = renderHook(() =>
    useClipboardActions({
      store,
      historyStore: createHistoryStore(),
      selection,
      updateScore,
      selectElement,
      selectRange,
      clearSelection: vi.fn(),
    }),
  );
  return { ...hook, score, updateScore, selectElement, selectRange };
}

function addHistory(): void {
  addClipboardEntry({
    type: "viritura/fragment",
    version: FRAGMENT_VERSION,
    timeSignature: { count: 4, unit: 4 },
    keySignature: { fifths: 0 },
    content: [
      {
        type: "event",
        id: "history",
        duration: { base: "quarter" },
        notes: [{ id: "history-note", pitch: { step: "E", octave: 4 } }],
      },
    ],
  });
}

function updatedEvent(updateScore: ReturnType<typeof harness>["updateScore"]): NoteEvent {
  return updateScore.mock.calls[0]![0].parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent;
}

function updatedSequence(updateScore: ReturnType<typeof harness>["updateScore"]): Sequence {
  return updateScore.mock.calls[0]![0].parts[0]!.measures[0]!.sequences[0]!;
}

beforeEach(() => {
  resetSelectionStore();
  clearClipboardHistory();
  useNoteInputStore.setState({ active: false });
  vi.stubGlobal("navigator", { clipboard: { readText, writeText } });
  readText.mockResolvedValue("");
  writeText.mockResolvedValue();
});

afterEach(() => {
  cleanup();
  resetSelectionStore();
  clearClipboardHistory();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("clipboard actions with a selected lyric", () => {
  it.each(["handleCopy", "handleCut"] as const)("writes lyric text without native notation on %s", async (action) => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockResolvedValue({ supported: true });
    const { result, updateScore } = harness(lyricSelection);
    await act(() => result.current[action]());
    expect(invoke).toHaveBeenCalledExactlyOnceWith("notation_clipboard_write", { text: "Sing" });
    expect(writeText).not.toHaveBeenCalled();
    expect(useClipboardHistoryStore.getState().entries).toHaveLength(0);
    if (action === "handleCut") expect(updatedEvent(updateScore).lyrics?.lines?.verse).toBeUndefined();
    else expect(updateScore).not.toHaveBeenCalled();
  });

  it("does not cut a selected lyric when native clipboard writing fails", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockRejectedValue("failed to open clipboard: Access is denied. (os error 5)");
    const { result, updateScore } = harness(lyricSelection);
    await act(() => result.current.handleCut());
    expect(updateScore).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Could not cut the selected lyric.");
  });

  it.each(["application/musescore/stafflist", "application/musescore/symbol", "application/musescore/symbollist"])(
    "does not replace a lyric with empty text when native %s is present",
    async (mime) => {
      vi.stubGlobal("__TAURI_INTERNALS__", {});
      vi.mocked(invoke).mockResolvedValue({ supported: true, text: "", museScore: { mime, xml: "<StaffList/>" } });
      const { result, updateScore, score } = harness(lyricSelection);
      await act(() => result.current.handlePaste());
      expect(updateScore).not.toHaveBeenCalled();
      expect((score.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent).lyrics?.lines?.verse?.text).toBe(
        "Sing",
      );
      expect(toast.info).toHaveBeenCalledWith("Select a note or rhythmic position to paste notation.");
    },
  );

  it.each(["<StaffList", '<StaffList version="4.70"/>', "<StaffList/>", "<SymbolList/>", "<EngravingItem/>"])(
    "recognizes plain-text notation before replacing a lyric: %s",
    async (xml) => {
      readText.mockResolvedValue(xml);
      const { result, updateScore } = harness(lyricSelection);
      await act(() => result.current.handlePaste());
      expect(updateScore).not.toHaveBeenCalled();
      expect(toast.info).toHaveBeenCalledOnce();
    },
  );

  it("still pastes ordinary lyric text", async () => {
    readText.mockResolvedValue("Song");
    const { result, updateScore } = harness(lyricSelection);
    await act(() => result.current.handlePaste());
    expect(updatedEvent(updateScore).lyrics?.lines?.verse?.text).toBe("Song");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("does not replace a lyric with a Viritura fragment", async () => {
    addHistory();
    readText.mockResolvedValue(JSON.stringify(useClipboardHistoryStore.getState().entries[0]!.fragment));
    const { result, updateScore } = harness(lyricSelection);
    await act(() => result.current.handlePaste());
    expect(updateScore).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("Select a note or rhythmic position to paste notation.");
  });

  it("copies only the selected lyric as browser text", async () => {
    const { result, updateScore } = harness(lyricSelection);
    await act(() => result.current.handleCopy());
    expect(writeText).toHaveBeenCalledExactlyOnceWith("Sing");
    expect(updateScore).not.toHaveBeenCalled();
    expect(useClipboardHistoryStore.getState().entries).toHaveLength(0);
  });

  it("cuts the selected lyric only after a successful browser write", async () => {
    const { result, updateScore } = harness(lyricSelection);
    await act(() => result.current.handleCut());
    expect(writeText).toHaveBeenCalledExactlyOnceWith("Sing");
    expect(updatedEvent(updateScore).lyrics?.lines?.verse).toBeUndefined();
    expect(updatedEvent(updateScore).notes?.[0]?.pitch.step).toBe("C");
    expect(useClipboardHistoryStore.getState().entries).toHaveLength(0);
  });

  it("does not cut the selected lyric after browser write permission denial", async () => {
    writeText.mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"));
    const { result, updateScore } = harness(lyricSelection);
    await act(() => result.current.handleCut());
    expect(updateScore).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Could not cut the selected lyric.");
  });
});

describe.each([false, true])("JSON-only notation actions (native=%s)", (native) => {
  it.each(["handleCopy", "handleCut"] as const)(
    "%s preserves unison ties, tremolo, slurs, and lyrics without export warnings",
    async (action) => {
      if (native) {
        vi.stubGlobal("__TAURI_INTERNALS__", {});
        vi.mocked(invoke).mockResolvedValue({ supported: true });
      }
      const score = scoreWithLyric();
      const content = score.parts[0]!.measures[0]!.sequences[0]!.content;
      const source = content[0] as NoteEvent;
      source.notes = [
        { id: "source-note", pitch: { step: "C", octave: 4 } },
        { id: "unison-note", pitch: { step: "C", octave: 4 }, ties: [{ target: "target-note" }] },
      ];
      source.markings = { tremolo: { marks: 3 } };
      source.slurs = [{ target: "target" }];
      content.push({
        type: "event",
        id: "target",
        duration: { base: "quarter" },
        notes: [{ id: "target-note", pitch: { step: "C", octave: 4 } }],
      });
      const snapshot = structuredClone(score);
      const { result, updateScore } = harness(
        { kind: "range", startElementId: "p0/m0/s0/source", endElementId: "p0/m0/s0/target" },
        score,
      );
      await act(() => result.current[action]());
      const text = native
        ? (vi.mocked(invoke).mock.calls[0]![1] as { text: string }).text
        : writeText.mock.calls[0]![0];
      expect(JSON.parse(text)).toMatchObject({ type: "viritura/fragment", content });
      expect(useClipboardHistoryStore.getState().entries[0]?.fragment.content).toEqual(content);
      expect(toast.warning).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      if (native) {
        expect(invoke).toHaveBeenCalledExactlyOnceWith("notation_clipboard_write", { text });
        expect(writeText).not.toHaveBeenCalled();
      } else {
        expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
        expect(invoke).not.toHaveBeenCalled();
      }
      if (action === "handleCut") {
        expect(updatedSequence(updateScore)).toMatchObject({
          content: [],
          fullMeasure: { visualDuration: { base: "whole" } },
        });
      } else expect(updateScore).not.toHaveBeenCalled();
      expect(score).toEqual(snapshot);
    },
  );
});

describe.each([false, true])("best-effort MuseScore paste (native=%s)", (native) => {
  function setXml(xml: string, mime = "application/musescore/stafflist") {
    if (native) {
      vi.stubGlobal("__TAURI_INTERNALS__", {});
      vi.mocked(invoke).mockResolvedValue({ supported: true, text: "unrelated text", museScore: { mime, xml } });
    } else {
      readText.mockResolvedValue(xml);
    }
  }

  function staffList(content: string) {
    return (
      '<StaffList version="4.70" tick="0/1" len="1/2" staff="0" staves="1">' +
      '<Staff id="0"><voiceOffset><voice id="0">0</voice></voiceOffset>' +
      content +
      "</Staff></StaffList>"
    );
  }

  const chord = "<Chord><durationType>quarter</durationType><Note><pitch>67</pitch><tpc>15</tpc></Note></Chord>";

  it("warns visibly while pasting supported events, markings and annotations at their original times", async () => {
    addHistory();
    const history = structuredClone(useClipboardHistoryStore.getState().entries);
    setXml(
      staffList(
        "<Dynamic><subtype>mf</subtype></Dynamic>" +
          chord.replace(
            "</Chord>",
            "<Articulation><subtype>articStaccatoAbove</subtype><direction>up</direction></Articulation>" +
              "<Articulation><subtype>unsupported-articulation</subtype></Articulation></Chord>",
          ) +
          "<Dynamic><subtype>other</subtype><text>custom</text></Dynamic>" +
          chord,
      ),
    );
    const { result, updateScore, score } = harness();
    const snapshot = structuredClone(score);
    await act(() => result.current.handlePaste());
    expect(updateScore).toHaveBeenCalledOnce();
    const measure = updateScore.mock.calls[0]![0].parts[0]!.measures[0]!;
    expect(eventTimeline(measure.sequences[0]!.content)).toEqual([
      { beat: 0, step: "G" },
      { beat: 1, step: "G" },
    ]);
    expect(updatedEvent(updateScore).markings).toHaveProperty("staccato");
    expect(measure.dynamics).toHaveLength(1);
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("Skipped unsupported MuseScore notation:"),
    );
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("unsupported-articulation"));
    expect(toast.error).not.toHaveBeenCalled();
    expect(score).toEqual(snapshot);
    expect(useClipboardHistoryStore.getState().entries).toEqual(history);
    expect(JSON.stringify(updateScore.mock.calls[0]![0])).not.toContain("diagnostics");
  });

  it("uses best-effort import for single-note symbols too", async () => {
    setXml(
      "<EngravingItem><duration>1/4</duration><Note><pitch>67</pitch><tpc>15</tpc>" +
        "<head>diamond</head></Note></EngravingItem>",
      "application/musescore/symbol",
    );
    const { result, updateScore } = harness();
    await act(() => result.current.handlePaste());
    expect(updatedEvent(updateScore).notes?.[0]?.pitch.step).toBe("G");
    expect(toast.warning).toHaveBeenCalledOnce();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", ""],
    ["all skipped", "<StaffText><text>Unsupported text</text></StaffText>"],
    ["unknown structure", chord + "<UnknownRhythm><duration>1/4</duration></UnknownRhythm>"],
    ["unknown duration", chord.replace("quarter", "unknown-duration")],
    ["nested unknown timing", chord.replace("</Chord>", "<offset><unknownTiming>1/4</unknownTiming></offset></Chord>")],
    ["malformed XML", chord + "<Chord>"],
  ])("never mutates the score or uses stale history for %s material", async (_label, content) => {
    addHistory();
    setXml(staffList(content));
    const { result, updateScore, selectElement, selectRange, score } = harness();
    const snapshot = structuredClone(score);
    const history = structuredClone(useClipboardHistoryStore.getState().entries);
    await act(() => result.current.handlePaste());
    expect(updateScore).not.toHaveBeenCalled();
    expect(selectElement).not.toHaveBeenCalled();
    expect(selectRange).not.toHaveBeenCalled();
    expect(score).toEqual(snapshot);
    expect(useClipboardHistoryStore.getState().entries).toEqual(history);
    expect(toast.error).toHaveBeenCalledOnce();
    expect(toast.warning).not.toHaveBeenCalled();
  });
});

describe("clipboard history fallback", () => {
  it.each(["application/musescore/stafflist", "application/musescore/symbol", "application/musescore/symbollist"])(
    "never uses stale history for recognized unsupported native %s",
    async (mime) => {
      addHistory();
      vi.stubGlobal("__TAURI_INTERNALS__", {});
      vi.mocked(invoke).mockResolvedValue({
        supported: true,
        text: "unrelated text",
        museScore: { mime, xml: '<StaffList version="9.0" tick="0/1" len="1/4" staff="0" staves="1"/>' },
      });
      const { result, updateScore } = harness();
      await act(() => result.current.handlePaste());
      expect(updateScore).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledOnce();
      expect(toast.warning).not.toHaveBeenCalled();
    },
  );

  it("does not add a failed native copy to history or fall back to browser writing", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockRejectedValue("failed to open clipboard: Access is denied. (os error 5)");
    const { result, updateScore } = harness();
    await act(() => result.current.handleCopy());
    expect(updateScore).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(useClipboardHistoryStore.getState().entries).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith("Could not write the system clipboard.");
  });

  it("warns and uses history when the native clipboard cannot be opened", async () => {
    addHistory();
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockRejectedValue("failed to open clipboard: Access is denied. (os error 5)");
    const { result, updateScore, selectElement } = harness();
    await act(() => result.current.handlePaste());
    expect(updatedEvent(updateScore).notes?.[0]?.pitch.step).toBe("E");
    expect(selectElement).toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith("Could not read the system clipboard.");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each([
    "MuseScore clipboard payload is invalid UTF-8: invalid utf-8 sequence",
    "MuseScore clipboard payload is empty",
  ])("reports malformed native data and never pastes history: %s", async (error) => {
    addHistory();
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockRejectedValue(error);
    const { result, updateScore } = harness();
    await act(() => result.current.handlePaste());
    expect(updateScore).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledOnce();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it.each(["<StaffList", '<StaffList version="9.0" tick="0/1" len="1/4" staff="0" staves="1"/>'])(
    "reports recognized unsupported notation instead of using history: %s",
    async (xml) => {
      addHistory();
      readText.mockResolvedValue(xml);
      const { result, updateScore } = harness();
      await act(() => result.current.handlePaste());
      expect(updateScore).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledOnce();
    },
  );

  it("still cuts to history after a best-effort native write fails", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockRejectedValue("failed to open clipboard: Access is denied. (os error 5)");
    const { result, updateScore } = harness();
    await act(() => result.current.handleCut());
    expect(updatedSequence(updateScore)).toMatchObject({
      content: [],
      fullMeasure: { visualDuration: { base: "whole" } },
    });
    const fragment = useClipboardHistoryStore.getState().entries[0]?.fragment;
    expect(fragment?.content[0]).toMatchObject({ notes: [{ pitch: { step: "C" } }] });
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith("Could not write the system clipboard.");
  });

  it.each(["", "ordinary text", "{invalid json"])("uses history for non-fragment browser text: %j", async (text) => {
    addHistory();
    readText.mockResolvedValue(text);
    const { result, updateScore } = harness();
    await act(() => result.current.handlePaste());
    expect(updatedEvent(updateScore).notes?.[0]?.pitch.step).toBe("E");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("uses history after browser read permission denial", async () => {
    addHistory();
    readText.mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"));
    const { result, updateScore } = harness();
    await act(() => result.current.handlePaste());
    expect(updatedEvent(updateScore).notes?.[0]?.pitch.step).toBe("E");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("leaves the score unchanged when browser read fails and history is empty", async () => {
    readText.mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"));
    const { result, updateScore } = harness();
    await act(() => result.current.handlePaste());
    expect(updateScore).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does not add a failed browser copy to history", async () => {
    writeText.mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"));
    const { result, updateScore } = harness();
    await act(() => result.current.handleCopy());
    expect(writeText).toHaveBeenCalledOnce();
    expect(updateScore).not.toHaveBeenCalled();
    expect(useClipboardHistoryStore.getState().entries).toHaveLength(0);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("still cuts to history after a best-effort browser write fails", async () => {
    writeText.mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"));
    const { result, updateScore } = harness();
    await act(() => result.current.handleCut());
    expect(updatedSequence(updateScore)).toMatchObject({
      content: [],
      fullMeasure: { visualDuration: { base: "whole" } },
    });
    const fragment = useClipboardHistoryStore.getState().entries[0]?.fragment;
    expect(fragment?.content[0]).toMatchObject({ notes: [{ pitch: { step: "C" } }] });
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("clipboard chord symbol placement", () => {
  it.each<[number, number]>([
    [1, 12],
    [31, 32],
  ])("preserves position %i/%i without replacing a nearby chord", async (numerator, denominator) => {
    const score = scoreWithLyric();
    const existing: ChordSymbol = {
      position: { fraction: [1, 16] },
      root: { step: "G" },
      quality: "major",
    };
    score.parts[0]!.measures[0]!.chordSymbols = [existing];
    const chordSymbol: ChordSymbol = {
      position: { fraction: [numerator, denominator] },
      root: { step: "C" },
      quality: "major",
    };
    const fragment: ClipboardFragment = {
      type: "viritura/fragment",
      version: FRAGMENT_VERSION,
      timeSignature: { count: 4, unit: 4 },
      keySignature: { fifths: 0 },
      content: [{ type: "event", duration: { base: "whole" }, rest: {} }],
      chordSymbols: [{ measureOffset: 0, chordSymbol, offset: [numerator, denominator] }],
    };
    readText.mockResolvedValue(JSON.stringify(fragment));
    const { result, updateScore } = harness(noteSelection, score);
    await act(() => result.current.handlePaste());
    const placed = updateScore.mock.calls[0]![0].parts[0]!.measures[0]!.chordSymbols!;
    expect(placed).toHaveLength(2);
    expect(placed[0]).toEqual(existing);
    expect(placed[1]).toMatchObject(chordSymbol);
    expect(score.parts[0]!.measures[0]!.chordSymbols).toEqual([existing]);
  });
});

function twoVoiceScore(): Score {
  const quarter = (id: string, step: "C" | "G"): NoteEvent => ({
    type: "event",
    id,
    duration: { base: "quarter" },
    notes: [{ id: `${id}-note`, pitch: { step, octave: 4 } }],
  });
  return {
    mnx: { version: 1 },
    global: { measures: Array.from({ length: 3 }, () => ({ time: { count: 4, unit: 4 } })) },
    parts: [
      {
        measures: [
          {
            sequences: [
              { staff: 1, content: [0, 1, 2, 3].map((beat) => quarter(`source-c-${beat}`, "C")) },
              {
                staff: 1,
                content: [
                  { type: "space", duration: [1, 4] },
                  quarter("source-g-1", "G"),
                  quarter("source-g-2", "G"),
                  { type: "space", duration: [1, 4] },
                ],
              },
            ],
          },
          ...Array.from({ length: 2 }, () => ({
            sequences: [
              { staff: 1, content: [] },
              { staff: 1, content: [] },
            ],
          })),
        ],
      },
    ],
  };
}

function liveHarness() {
  const score = twoVoiceScore();
  const store = createDocumentStore();
  const historyStore = createHistoryStore();
  store.setState({ score });
  const updateScore = (next: Score) => store.setState({ score: next });
  const hook = renderHook(() => {
    const selection = useSelection();
    const actions = useSelectionActions();
    return {
      selection,
      actions,
      ...useClipboardActions({ store, historyStore, selection, updateScore, ...actions }),
    };
  });
  act(() => hook.result.current.actions.selectMeasure(0, 0, 0));
  return { ...hook, store, score };
}

function eventTimeline(content: readonly SequenceContent[], startBeat = 0) {
  let beat = startBeat;
  return content.flatMap((item) => {
    const onset = beat;
    beat += sequenceContentBeats(item);
    return item.type === "event" && item.notes
      ? item.notes.map((note) => ({ beat: onset, step: note.pitch.step }))
      : [];
  });
}

function measureElementIds(score: Score, measureIndex: number): string[] {
  return score.parts[0]!.measures[measureIndex]!.sequences.flatMap((sequence, sequenceIndex) =>
    sequence.content.flatMap((item) =>
      item.type === "event" ? [`p0/m${measureIndex}/s${sequenceIndex}/${item.id}`] : [],
    ),
  );
}

function expectTwoVoiceCapture(capture: ClipboardSelection | null, measureIndex: number) {
  expect(capture).not.toBeNull();
  expect(capture!.captureOrigin).toEqual({ measureIndex, beat: 0 });
  expect(capture!.tracks).toHaveLength(2);
  for (const voiceIndex of [0, 1]) {
    const track = capture!.tracks!.find((item) => item.voiceIndex === voiceIndex)!;
    expect(track).toBeDefined();
    const leadIn = track.leadIn ? (track.leadIn[0] / track.leadIn[1]) * 4 : 0;
    expect(leadIn + track.content.reduce((beats, item) => beats + sequenceContentBeats(item), 0)).toBe(4);
    expect(eventTimeline(track.content, leadIn)).toEqual(
      voiceIndex === 0
        ? [0, 1, 2, 3].map((beat) => ({ beat, step: "C" }))
        : [1, 2].map((beat) => ({ beat, step: "G" })),
    );
  }
}

function expectPlacedSelection(
  score: Score,
  selection: SelectionState,
  measureIndex: number,
  previousIds: readonly string[],
) {
  const sequences = score.parts[0]!.measures[measureIndex]!.sequences;
  expect(sequences).toHaveLength(2);
  expect(eventTimeline(sequences[0]!.content)).toEqual([0, 1, 2, 3].map((beat) => ({ beat, step: "C" })));
  expect(eventTimeline(sequences[1]!.content)).toEqual([1, 2].map((beat) => ({ beat, step: "G" })));
  expect(selection.kind).toBe("multi");
  if (selection.kind !== "multi") throw new Error("Expected placed multi selection");
  expect([...selection.elementIds].sort()).toEqual(measureElementIds(score, measureIndex).sort());
  expect(selection.elementIds).toHaveLength(6);
  const previousEventIds = previousIds.map((id) => id.split("/").at(-1));
  for (const id of selection.elementIds) {
    expect(previousEventIds).not.toContain(id.split("/").at(-1));
  }
  expect(selection.rhythmicRange?.start).toEqual({ measureIndex, beat: 0 });
  const end = selection.rhythmicRange!.end;
  expect((end.measureIndex - measureIndex) * 4 + end.beat).toBe(4);
}

describe("clipboard actions with real selection state", () => {
  it("preserves timing as the third argument without changing the stable action bag", () => {
    const { result, rerender } = liveHarness();
    const actions = result.current.actions;
    const elementIds = ["p0/m0/s1/source-g-1"];
    const measureAnchor = { partIndex: 0, staffIndex: 0, measureIndex: 0 };
    const rhythmicRange = { start: { measureIndex: 0, beat: 0 }, end: { measureIndex: 0, beat: 4 } };
    act(() => actions.selectElements(elementIds, measureAnchor, rhythmicRange));
    rerender();
    expect(result.current.actions).toBe(actions);
    expect(result.current.selection).toEqual({ kind: "multi", elementIds, measureAnchor, rhythmicRange });
    act(() => actions.selectElements(elementIds));
    expect(result.current.selection).toEqual({ kind: "single", elementId: elementIds[0], elementType: "event" });
  });

  it("repeats both voices twice and recaptures the complete four-beat placement", () => {
    const { result, rerender, store, score } = liveHarness();
    const previousIds = measureElementIds(score, 0);
    expectTwoVoiceCapture(result.current.getClipboardSelection(), 0);

    for (const measureIndex of [1, 2]) {
      act(() => result.current.handleRepeat());
      rerender();
      const next = store.getState().score!;
      expectPlacedSelection(next, result.current.selection, measureIndex, previousIds);
      expectTwoVoiceCapture(result.current.getClipboardSelection(), measureIndex);
      previousIds.push(...measureElementIds(next, measureIndex));
    }
    expect(store.getState().score!.parts[0]!.measures[0]).toEqual(score.parts[0]!.measures[0]);
    expect(readText).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it.each(["system", "history"] as const)(
    "recaptures both voices and timing after %s paste auto-selection",
    async (source) => {
      const { result, rerender, store, score } = liveHarness();
      const capture = result.current.getClipboardSelection()!;
      const fragment: ClipboardFragment = {
        type: "viritura/fragment",
        version: FRAGMENT_VERSION,
        timeSignature: capture.timeSignature,
        keySignature: capture.keySignature,
        content: capture.events,
        tracks: capture.tracks,
      };
      if (source === "system") readText.mockResolvedValue(JSON.stringify(fragment));
      else addClipboardEntry(fragment);
      act(() => result.current.actions.selectMeasure(0, 0, 1));
      await act(() => result.current.handlePaste());
      rerender();

      expect(readText).toHaveBeenCalledOnce();
      expect(toast.error).not.toHaveBeenCalled();
      expectPlacedSelection(store.getState().score!, result.current.selection, 1, measureElementIds(score, 0));
      expectTwoVoiceCapture(result.current.getClipboardSelection(), 1);
      await act(() => result.current.handleCopy());
      const copied: ClipboardFragment = JSON.parse(writeText.mock.calls.at(-1)![0]);
      expect(copied.tracks).toEqual(result.current.getClipboardSelection()!.tracks);
      expect(useClipboardHistoryStore.getState().entries[0]!.fragment.tracks).toEqual(copied.tracks);
    },
  );
});
