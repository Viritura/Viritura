import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { exportScoreAudio } from "@viritura/playback";
import { triggerDownload } from "../../../publish/batchRender";
import { runAudioExport, type RunAudioExportArgs } from "./runAudioExport";

vi.mock("@viritura/playback", () => ({ exportScoreAudio: vi.fn() }));
vi.mock("../../../desktopAudio", () => ({ getDesktopSoundfontLoader: () => undefined }));
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
const bytes = new Uint8Array([0xff, 0xfb, 1, 2]);

function args(overrides: Partial<RunAudioExportArgs> = {}): RunAudioExportArgs {
  return {
    score,
    encoding: { format: "mp3", bitrate: 192 },
    filenamePattern: "%TITLE% - %PART% - %PART_NUMBER%",
    exportFolder: null,
    signal: new AbortController().signal,
    onProgress: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exportScoreAudio).mockResolvedValue({ bytes, warnings: ["Playback warning."] });
});

describe("audio export delivery", () => {
  it("downloads an audio/mpeg file with the full-score filename and playback warnings", async () => {
    const options = args({ mix: [{ volume: 0.5, pan: -0.3, muted: true, ensembleEnabled: false }] });
    await expect(runAudioExport(options)).resolves.toEqual({
      kind: "ok",
      text: "Exported Quartet - Full Score - All.mp3. Playback warning.",
    });
    expect(exportScoreAudio).toHaveBeenCalledWith(
      score,
      { format: "mp3", bitrate: 192 },
      expect.objectContaining({ signal: options.signal, onProgress: options.onProgress, mix: options.mix }),
    );
    expect(triggerDownload).toHaveBeenCalledExactlyOnceWith(bytes, "Quartet - Full Score - All.mp3", "audio/mpeg");
  });

  it("downloads WAV exports as audio/wav", async () => {
    await runAudioExport(args({ encoding: { format: "wav", bitDepth: 24 } }));
    expect(triggerDownload).toHaveBeenCalledExactlyOnceWith(bytes, "Quartet - Full Score - All.wav", "audio/wav");
  });

  it("writes the MP3 to the selected folder without initiating a browser download", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const abort = vi.fn().mockResolvedValue(undefined);
    const getFileHandle = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue({ write, close, abort }),
    });
    const result = await runAudioExport(args({ exportFolder: { name: "Project", getFileHandle } }));

    expect(result.text).toContain('to "Project"');
    expect(getFileHandle).toHaveBeenCalledExactlyOnceWith("Quartet - Full Score - All.mp3", { create: true });
    expect(write).toHaveBeenCalledExactlyOnceWith(bytes);
    expect(close).toHaveBeenCalledOnce();
    expect(abort).not.toHaveBeenCalled();
    expect(triggerDownload).not.toHaveBeenCalled();
  });

  it("aborts an in-progress folder write rather than committing a cancelled export", async () => {
    let finishWrite: (() => void) | undefined;
    const write = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    const close = vi.fn().mockResolvedValue(undefined);
    const abort = vi.fn().mockResolvedValue(undefined);
    const getFileHandle = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue({ write, close, abort }),
    });
    const controller = new AbortController();
    const result = runAudioExport(
      args({ signal: controller.signal, exportFolder: { name: "Project", getFileHandle } }),
    );
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    const rejection = expect(result).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    finishWrite!();

    await rejection;
    expect(abort).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  it("surfaces folder write failures", async () => {
    const error = new Error("Disk is full");
    const abort = vi.fn().mockResolvedValue(undefined);
    const getFileHandle = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue({ write: vi.fn().mockRejectedValue(error), close: vi.fn(), abort }),
    });
    await expect(runAudioExport(args({ exportFolder: { name: "Project", getFileHandle } }))).rejects.toBe(error);
    expect(abort).toHaveBeenCalledOnce();
    expect(triggerDownload).not.toHaveBeenCalled();
  });
});
