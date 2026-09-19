import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { writeMuseScoreStaffList } from "@viritura/musescore-clipboard";
import { copyToClipboard, cutToClipboard } from "../../commands/clipboardCommands";
import { FRAGMENT_VERSION, type ClipboardFragment } from "../ClipboardFragment";
import { writeClipboardFragment } from "./museScoreAdapter";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@viritura/musescore-clipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@viritura/musescore-clipboard")>()),
  writeMuseScoreStaffList: vi.fn(),
}));

const writeText = vi.fn<(text: string) => Promise<void>>();

function fragment(): ClipboardFragment {
  return {
    type: "viritura/fragment",
    version: FRAGMENT_VERSION,
    timeSignature: { count: 4, unit: 4 },
    keySignature: { fifths: 0 },
    content: [{ type: "event", duration: { base: "quarter" }, notes: [{ pitch: { step: "F", octave: 1 } }] }],
    clef: { sign: "F", staffPosition: 2 },
    transposition: { interval: { halfSteps: 12, staffDistance: 7 }, prefersWrittenPitches: true },
    lyrics: { lineOrder: ["verse"], lineMetadata: { verse: { label: "Verse" } } },
  };
}

beforeEach(() => {
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  writeText.mockResolvedValue();
  vi.mocked(writeMuseScoreStaffList).mockReturnValue({ xml: "<StaffList/>" });
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("MuseScore application adapter", () => {
  it("retains complete app metadata in JSON without calling the package exporter", async () => {
    const source = fragment();
    source.tracks = [
      {
        partOffset: 0,
        voiceIndex: 1,
        staffOffset: 0,
        sourceStaff: 2,
        leadIn: [1, 12],
        content: source.content,
        clef: source.clef,
        transposition: source.transposition,
      },
    ];
    await writeClipboardFragment(source);
    expect(writeMuseScoreStaffList).not.toHaveBeenCalled();
    expect(JSON.parse(writeText.mock.calls[0]![0])).toMatchObject({
      clef: source.clef,
      transposition: source.transposition,
      lyrics: source.lyrics,
      tracks: [{ clef: source.clef, leadIn: [1, 12] }],
    });
  });

  it.each([false, true])("restores history without invoking a failing exporter (native=%s)", async (native) => {
    if (native) {
      vi.stubGlobal("__TAURI_INTERNALS__", {});
      vi.mocked(invoke).mockResolvedValue({ supported: true });
    }
    vi.mocked(writeMuseScoreStaffList).mockImplementation(() => {
      throw new Error("Unexpected export failure");
    });
    const source = fragment();
    await expect(writeClipboardFragment(source)).resolves.toBeUndefined();
    expect(writeMuseScoreStaffList).not.toHaveBeenCalled();
    if (native) {
      expect(invoke).toHaveBeenCalledExactlyOnceWith("notation_clipboard_write", { text: JSON.stringify(source) });
      expect(writeText).not.toHaveBeenCalled();
    } else {
      expect(JSON.parse(writeText.mock.calls[0]![0])).toEqual(source);
    }
  });

  describe.each([false, true])("notation commands (native=%s)", (native) => {
    it.each(["copy", "cut"] as const)("%s never calls the exporter or reports export warnings", async (action) => {
      if (native) {
        vi.stubGlobal("__TAURI_INTERNALS__", {});
        vi.mocked(invoke).mockResolvedValue({ supported: true });
      }
      vi.mocked(writeMuseScoreStaffList).mockReturnValue({ xml: null, warning: "Unsupported notation" });
      const source = fragment();
      const selection = {
        ...source,
        events: source.content,
        partIndex: 0,
        measureIndex: 0,
        sequenceIndex: 0,
        eventIndex: 0,
      };
      const warning = vi.fn();
      if (action === "copy") await expect(copyToClipboard(selection)).resolves.toBe(true);
      else await expect(cutToClipboard(selection, warning)).resolves.not.toBeNull();
      expect(writeMuseScoreStaffList).not.toHaveBeenCalled();
      expect(warning).not.toHaveBeenCalled();
      const text = native
        ? (vi.mocked(invoke).mock.calls[0]![1] as { text: string }).text
        : writeText.mock.calls[0]![0];
      expect(JSON.parse(text)).toEqual(source);
      if (native) expect(invoke).toHaveBeenCalledExactlyOnceWith("notation_clipboard_write", { text });
    });
  });
});
