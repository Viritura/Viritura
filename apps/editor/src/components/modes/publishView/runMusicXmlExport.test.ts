import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import type { Score } from "@viritura/core";
import { convertMusicXmlToMnx, convertMxlToMnx, MUSICXML_MIME } from "@viritura/musicxml";
import { triggerDownload } from "../../../publish/batchRender";
import { runMusicXmlExport } from "./runMusicXmlExport";

vi.mock("../../../publish/batchRender", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../publish/batchRender")>()),
  triggerDownload: vi.fn(),
}));

const score: Score = {
  mnx: { version: 1 },
  metadata: { title: "Duet" },
  global: { measures: [{ time: { count: 4, unit: 4 } }] },
  parts: ["Violin", "Cello"].map((name, index) => ({
    id: `p${index}`,
    name,
    measures: [
      {
        sequences: [
          {
            content: [
              { type: "event", duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 4 - index } }] },
            ],
          },
        ],
      },
    ],
  })),
  layouts: [
    {
      id: "full",
      content: [
        { type: "staff", sources: [{ part: "p0" }] },
        { type: "staff", sources: [{ part: "p1" }] },
      ],
    },
    { id: "violin", content: [{ type: "staff", sources: [{ part: "p0" }] }] },
    { id: "cello", content: [{ type: "staff", sources: [{ part: "p1" }] }] },
  ],
  scores: [
    { name: "Full Score", layout: "full" },
    { name: "Violin", layout: "violin" },
    { name: "Cello", layout: "cello" },
  ],
};
const args = () => ({
  score,
  scoreIndices: [1],
  format: "musicxml" as const,
  bundleMode: "zip" as const,
  filenamePattern: "%TITLE% - %PART%",
  exportFolder: null,
  signal: new AbortController().signal,
  onProgress: vi.fn(),
});

beforeEach(() => vi.clearAllMocks());

describe("MusicXML export delivery", () => {
  it("downloads a single selected part as an interoperable MusicXML file", async () => {
    const options = args();
    const result = await runMusicXmlExport(options);
    const [bytes, name, mime] = vi.mocked(triggerDownload).mock.calls[0]!;
    expect(name).toBe("Duet - Violin.musicxml");
    expect(mime).toBe(MUSICXML_MIME);
    expect(convertMusicXmlToMnx(new TextDecoder().decode(bytes)).parts.map((part) => part.name)).toEqual(["Violin"]);
    expect(options.onProgress).toHaveBeenCalledExactlyOnceWith(1, 1, "Violin");
    expect(result.text).toBe("Exported 1 MusicXML file.");
  });

  it("packages selected scores in stable score order without exporting unselected views", async () => {
    await runMusicXmlExport({ ...args(), scoreIndices: [2, 0], filenamePattern: "%PART_NUMBER% - %PART%" });
    const [bytes, name, mime] = vi.mocked(triggerDownload).mock.calls[0]!;
    expect(name).toBe("All - Parts.zip");
    expect(mime).toBe("application/zip");
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toEqual(["01 - Full Score.musicxml", "03 - Cello.musicxml"]);
    expect(
      convertMusicXmlToMnx(await zip.file("03 - Cello.musicxml")!.async("string")).parts.map((part) => part.name),
    ).toEqual(["Cello"]);
  });

  it("saves compressed parts separately and disambiguates matching filenames before writing", async () => {
    const written: Uint8Array[] = [];
    const close = vi.fn().mockResolvedValue(undefined);
    const getFileHandle = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue({
        write: async (bytes: Uint8Array) => {
          written.push(bytes);
        },
        close,
        abort: vi.fn(),
      }),
    });
    const result = await runMusicXmlExport({
      ...args(),
      scoreIndices: [1, 2],
      format: "mxl",
      bundleMode: "separate",
      filenamePattern: "%TITLE%",
      exportFolder: { name: "Parts", getFileHandle },
    });
    expect(getFileHandle.mock.calls.map(([name]) => name)).toEqual(["Duet.mxl", "Duet (2).mxl"]);
    expect((await convertMxlToMnx(written[0]!)).parts.map((part) => part.name)).toEqual(["Violin"]);
    expect((await convertMxlToMnx(written[1]!)).parts.map((part) => part.name)).toEqual(["Cello"]);
    expect(result.warnings?.some((message) => message.includes("numeric suffixes"))).toBe(true);
    expect(close).toHaveBeenCalledTimes(2);
    expect(triggerDownload).not.toHaveBeenCalled();
  });

  it("surfaces write failures and aborts the writable instead of reporting success", async () => {
    const error = new Error("Disk is full");
    const abort = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const getFileHandle = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue({ write: vi.fn().mockRejectedValue(error), close, abort }),
    });
    await expect(
      runMusicXmlExport({ ...args(), bundleMode: "separate", exportFolder: { name: "Parts", getFileHandle } }),
    ).rejects.toBe(error);
    expect(abort).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(triggerDownload).not.toHaveBeenCalled();
  });

  it("does not deliver cancelled or invalid selections", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runMusicXmlExport({ ...args(), signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(runMusicXmlExport({ ...args(), scoreIndices: [] })).rejects.toThrow(/Select at least/);
    await expect(runMusicXmlExport({ ...args(), scoreIndices: [1, 1] })).rejects.toThrow(/duplicate/);
    await expect(runMusicXmlExport({ ...args(), bundleMode: "separate" })).rejects.toThrow(/Choose a folder/);
    expect(triggerDownload).not.toHaveBeenCalled();
  });
});
