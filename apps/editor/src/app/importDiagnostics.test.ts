import { act, renderHook } from "@testing-library/react";
import type { DragEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  convertImportedMusicFile,
  importMusicFile,
  validateMnxJson,
  type OpenFileResult,
} from "../commands/fileCommands";
import type { DocumentStore } from "../store/documentStore";
import { formatImportWarning } from "./importDiagnostics";
import { useDragAndDrop } from "./useDragAndDrop";
import { useFileMenuActions, type FileMenuDeps } from "./useFileMenuActions";

vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock("../commands/fileCommands", () => ({
  convertImportedMusicFile: vi.fn(),
  importMusicFile: vi.fn(),
  validateMnxJson: vi.fn(),
  isMusicImportFilename: (name: string) => /\.(musx|musicxml|mxl|xml)$/i.test(name),
}));
vi.mock("../store/projectStore", () => ({
  useProjectStore: { getState: () => ({ setAdapter: vi.fn() }) },
}));

const unsupported = "Unsupported chord text at measure 2 was omitted.";
const conflict = "Conflicting staff harmony at measure 4: kept the topmost source staff.";

function imported(importDiagnostics?: OpenFileResult["importDiagnostics"]): OpenFileResult {
  return { mnxJson: "{}", filename: "Finale Score.mnx", fileHandle: null, importDiagnostics };
}

function harness(route: "menu" | "start center" | "drop", extension = "musx") {
  const setOpenedFile = vi.fn();
  const setFileError = vi.fn();
  const deps: FileMenuDeps = {
    store: { getState: () => ({ score: null }) } as unknown as DocumentStore,
    loadScore: vi.fn(),
    resetHistory: vi.fn(),
    loadDefaultScore: vi.fn(),
    loadSampleScore: vi.fn(),
    handleOpenProject: vi.fn(),
    setSelectedScoreIndex: vi.fn(),
    setFileHandle: vi.fn(),
    setOpenedFile,
    setFileError,
    suppressTrackBanner: false,
    onChooseProjectLocation: vi.fn(),
    onNewScore: vi.fn(),
  };
  const { result } = renderHook(() => ({
    menu: useFileMenuActions(deps),
    drop: useDragAndDrop({
      openFolderHandle: vi.fn(),
      setIsDragOver: vi.fn(),
      setFileError,
      setOpenedFile,
    }),
  }));
  const run = () => {
    if (route === "menu") return result.current.menu.handleImportFile();
    if (route === "start center") return result.current.menu.handleStartCenterImport();
    return result.current.drop.handleDrop({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { items: [], files: [new File(["source"], `Finale Score.${extension}`)] },
    } as unknown as DragEvent);
  };
  return { run, setOpenedFile, setFileError };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(validateMnxJson).mockReturnValue(null);
});

describe("import diagnostic summary", () => {
  it("deduplicates normalized warning details, ignoring informational and empty messages", () => {
    expect(
      formatImportWarning(
        imported([
          { severity: "warning", message: unsupported },
          { severity: "warning", message: `  ${unsupported}\n` },
          { severity: "info", message: "Converted successfully" },
          { severity: "verbose", message: "Read archive" },
          { severity: "warning", message: " \n " },
          { severity: "warning", message: conflict },
        ]),
      ),
    ).toEqual({
      message: "Imported Finale Score.mnx with 2 warnings",
      description: `${unsupported}\n${conflict}`,
    });
  });

  it("bounds both individual messages and detail count without mutating retained diagnostics", () => {
    const result = imported(
      Array.from({ length: 20 }, (_, index) => ({
        severity: "warning",
        message: `${index}: ${"long source detail ".repeat(100)}`,
      })),
    );
    const before = structuredClone(result);
    const summary = formatImportWarning(result)!;
    expect(summary.message).toContain("20 warnings");
    const lines = summary.description.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines.slice(0, 3).every((line) => line.length === 240 && line.endsWith("…"))).toBe(true);
    expect(lines[3]).toBe("And 17 more warnings.");
    expect(result).toEqual(before);
  });

  it("does not suppress a distinct warning just because its truncated prefix is identical", () => {
    const prefix = "x".repeat(250);
    expect(
      formatImportWarning(
        imported([
          { severity: "warning", message: `${prefix} one` },
          { severity: "warning", message: `${prefix} two` },
        ]),
      )?.message,
    ).toContain("2 warnings");
  });
});

describe.each(["menu", "start center", "drop"] as const)("%s import warnings", (route) => {
  it.each(["musx", "musicxml", "mxl"])(
    "shows converter details once for %s and still opens the score",
    async (extension) => {
      const file = imported([
        { severity: "warning", message: unsupported },
        { severity: "warning", message: unsupported },
        { severity: "warning", message: conflict },
      ]);
      vi.mocked(importMusicFile).mockResolvedValue(file);
      vi.mocked(convertImportedMusicFile).mockResolvedValue(file);
      const { run, setOpenedFile, setFileError } = harness(route, extension);
      await act(run);
      expect(setOpenedFile).toHaveBeenCalledExactlyOnceWith(file);
      expect(setFileError).toHaveBeenCalledExactlyOnceWith(null);
      expect(toast.warning).toHaveBeenCalledExactlyOnceWith("Imported Finale Score.mnx with 2 warnings", {
        description: `${unsupported}\n${conflict}`,
      });
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, [], [{ severity: "info", message: "Converted successfully" }]] as const)(
    "does not warn for a clean import (%j)",
    async (diagnostics) => {
      const file = imported(diagnostics ? [...diagnostics] : undefined);
      vi.mocked(importMusicFile).mockResolvedValue(file);
      vi.mocked(convertImportedMusicFile).mockResolvedValue(file);
      const { run, setOpenedFile } = harness(route);
      await act(run);
      expect(setOpenedFile).toHaveBeenCalledExactlyOnceWith(file);
      expect(toast.warning).not.toHaveBeenCalled();
      if (route !== "drop") expect(toast.success).toHaveBeenCalledExactlyOnceWith("Imported Finale Score.mnx");
    },
  );

  it("does not report a successful import when conversion fails", async () => {
    vi.mocked(importMusicFile).mockRejectedValue(new Error("Invalid source"));
    vi.mocked(convertImportedMusicFile).mockRejectedValue(new Error("Invalid source"));
    const { run, setOpenedFile, setFileError } = harness(route);
    await act(run);
    expect(setOpenedFile).not.toHaveBeenCalled();
    expect(setFileError).toHaveBeenLastCalledWith("Invalid source");
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

it("does not warn when the import picker is cancelled", async () => {
  vi.mocked(importMusicFile).mockResolvedValue(null);
  const { run, setOpenedFile } = harness("menu");
  await act(run);
  expect(setOpenedFile).not.toHaveBeenCalled();
  expect(toast.warning).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});

it("does not warn or open a dropped conversion rejected by validation", async () => {
  vi.mocked(convertImportedMusicFile).mockResolvedValue(imported([{ severity: "warning", message: unsupported }]));
  vi.mocked(validateMnxJson).mockReturnValue("Invalid notation");
  const { run, setOpenedFile, setFileError } = harness("drop");
  await act(run);
  expect(setOpenedFile).not.toHaveBeenCalled();
  expect(setFileError).toHaveBeenLastCalledWith("Finale Score.mnx: Invalid notation");
  expect(toast.warning).not.toHaveBeenCalled();
});
