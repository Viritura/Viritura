import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeMuseScoreStaffList } from "@viritura/musescore-clipboard";
import { FRAGMENT_VERSION, type ClipboardFragment } from "../ClipboardFragment";
import { writeClipboardFragment } from "./museScoreAdapter";

vi.mock("@viritura/musescore-clipboard", () => ({
  MUSESCORE_STAFF_LIST_MIME: "application/musescore/stafflist",
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
  it("passes only portable notation to the writer, retaining app metadata in JSON", async () => {
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
    expect(writeMuseScoreStaffList).toHaveBeenCalledExactlyOnceWith({
      events: source.content,
      tracks: [
        {
          partOffset: 0,
          voiceIndex: 1,
          staffOffset: 0,
          sourceStaff: 2,
          leadIn: [1, 12],
          content: source.content,
          transposition: source.transposition,
          dynamics: undefined,
        },
      ],
      transposition: source.transposition,
      dynamics: undefined,
      chordSymbols: undefined,
      measureRepeats: undefined,
    });
    expect(JSON.parse(writeText.mock.calls[0]![0])).toMatchObject({
      clef: source.clef,
      transposition: source.transposition,
      lyrics: source.lyrics,
      tracks: [{ clef: source.clef, leadIn: [1, 12] }],
    });
  });

  it("keeps lossless JSON available even if the package writer unexpectedly throws", async () => {
    vi.mocked(writeMuseScoreStaffList).mockImplementation(() => {
      throw new Error("Unexpected export failure");
    });
    const source = fragment();
    const warning = vi.fn();
    await expect(writeClipboardFragment(source, warning)).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledExactlyOnceWith(
      "This selection cannot be exported to MuseScore. Viritura clipboard content is still available.",
    );
    expect(JSON.parse(writeText.mock.calls[0]![0])).toEqual(source);
  });

  it("reports the package warning while still writing the complete fragment", async () => {
    vi.mocked(writeMuseScoreStaffList).mockReturnValue({ xml: null, warning: "Unsupported notation" });
    const source = fragment();
    const warning = vi.fn();
    await writeClipboardFragment(source, warning);
    expect(warning).toHaveBeenCalledExactlyOnceWith("Unsupported notation");
    expect(JSON.parse(writeText.mock.calls[0]![0])).toEqual(source);
  });
});
