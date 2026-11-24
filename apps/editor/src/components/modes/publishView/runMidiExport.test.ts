import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { exportScoreMidi } from "@viritura/playback";
import { triggerDownload } from "../../../publish/batchRender";
import { runMidiExport } from "./runMidiExport";

vi.mock("@viritura/playback", () => ({ exportScoreMidi: vi.fn() }));
vi.mock("../../../publish/batchRender", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../publish/batchRender")>()),
  triggerDownload: vi.fn(),
}));

const score: Score = {
  mnx: { version: 1 },
  metadata: { title: "Quartet" },
  global: { measures: [] },
  parts: [],
};
const bytes = new Uint8Array([0x4d, 0x54, 0x68, 0x64]);
const signal = new AbortController().signal;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exportScoreMidi).mockReturnValue({ bytes, warnings: ["MIDI warning."] });
});

describe("MIDI export delivery", () => {
  it("downloads a MIDI file and reports warnings", async () => {
    const result = await runMidiExport({
      score,
      filenamePattern: "%TITLE% - %PART% - %PART_NUMBER%",
      exportFolder: null,
      signal,
    });
    expect(result.text).toBe("Exported Quartet - Full Score - All.mid. MIDI warning.");
    expect(triggerDownload).toHaveBeenCalledExactlyOnceWith(bytes, "Quartet - Full Score - All.mid", "audio/midi");
  });

  it("writes to the selected folder and surfaces failures", async () => {
    const error = new Error("Disk is full");
    const abort = vi.fn().mockResolvedValue(undefined);
    const getFileHandle = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue({ write: vi.fn().mockRejectedValue(error), close: vi.fn(), abort }),
    });
    await expect(
      runMidiExport({
        score,
        filenamePattern: "%TITLE%",
        exportFolder: { name: "Project", getFileHandle },
        signal,
      }),
    ).rejects.toBe(error);
    expect(getFileHandle).toHaveBeenCalledWith("Quartet.mid", { create: true });
    expect(abort).toHaveBeenCalledOnce();
    expect(triggerDownload).not.toHaveBeenCalled();
  });

  it("writes to the selected folder without a download", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const getFileHandle = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue({ write, close, abort: vi.fn() }),
    });
    const result = await runMidiExport({
      score,
      filenamePattern: "%TITLE%",
      exportFolder: { name: "Project", getFileHandle },
      signal,
    });
    expect(result.text).toBe('Exported Quartet.mid to "Project". MIDI warning.');
    expect(getFileHandle).toHaveBeenCalledWith("Quartet.mid", { create: true });
    expect(write).toHaveBeenCalledWith(bytes);
    expect(close).toHaveBeenCalledOnce();
    expect(triggerDownload).not.toHaveBeenCalled();
  });
});
