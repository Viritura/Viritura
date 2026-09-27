import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { useImportErrorLogStore } from "../importErrorLog";
import { useDefaultScoreLoader } from "./useDefaultScoreLoader";

describe("useDefaultScoreLoader", () => {
  it("surfaces opened-file schema failures through the on-screen error state", async () => {
    const loadScore = vi.fn();
    const setFileError = vi.fn();
    const openedFile = {
      filename: "legacy-score.mnx",
      mnxJson: JSON.stringify({
        mnx: { version: 4 },
        global: { measures: [{ id: "m1" }] },
        parts: [
          {
            measures: [
              {
                sequences: [
                  {
                    content: [
                      {
                        duration: { base: "quarter" },
                        markings: { accent: { pointing: "down" } },
                        notes: [{ pitch: { step: "C", octave: 4 } }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
      fileHandle: null,
    };

    renderHook(() =>
      useDefaultScoreLoader({
        store: { getState: () => ({ mnxJson: "" }) } as never,
        loadScore,
        resetHistory: vi.fn(),
        openedFile,
        setSelectedScoreIndex: vi.fn(),
        setFileHandle: vi.fn(),
        setFileError,
      }),
    );

    await waitFor(() => {
      expect(setFileError).toHaveBeenCalledWith(
        expect.stringContaining('Could not open "legacy-score.mnx".\nMNX schema validation failed'),
      );
    });
    expect(setFileError).toHaveBeenCalledWith(expect.stringContaining("/parts/0/measures/0/sequences/0/content/0"));
    expect(setFileError).toHaveBeenCalledWith(expect.stringContaining("Stack trace:"));
    expect(setFileError).toHaveBeenCalledWith(expect.stringContaining("Please include these details when reporting"));
    expect(loadScore).not.toHaveBeenCalled();
    expect(useImportErrorLogStore.getState().log).toMatchObject({ status: "failed", filename: "legacy-score.mnx" });
  });

  it("reports converter failures in the error log without loading the score", async () => {
    const loadScore = vi.fn();
    const setFileError = vi.fn();
    const openedFile = {
      filename: "broken.mnx",
      mnxJson: "{}",
      fileHandle: null,
      importRecovery: [],
      importFailure: "Denigma produced invalid MNX: / must have required property 'mnx'",
    };

    renderHook(() =>
      useDefaultScoreLoader({
        store: { getState: () => ({ mnxJson: "" }) } as never,
        loadScore,
        resetHistory: vi.fn(),
        openedFile,
        setSelectedScoreIndex: vi.fn(),
        setFileHandle: vi.fn(),
        setFileError,
      }),
    );

    await waitFor(() => {
      expect(useImportErrorLogStore.getState().log).toMatchObject({ status: "failed", filename: "broken.mnx" });
    });
    expect(setFileError).toHaveBeenCalledWith(expect.stringContaining("Denigma produced invalid MNX"));
    expect(loadScore).not.toHaveBeenCalled();
  });

  it("opens the valid sequences, drops the file handle, and shows the error log", async () => {
    useImportErrorLogStore.setState({ log: null });
    const loadScore = vi.fn();
    const setFileHandle = vi.fn();
    const openedFile = {
      filename: "crumbfill.mnx",
      mnxJson: readFileSync(
        resolve(process.cwd(), "../../packages/format/fixtures/recovery/malformed-tuplet-sequence.mnx"),
        "utf8",
      ),
      fileHandle: {} as FileSystemFileHandle,
    };

    renderHook(() =>
      useDefaultScoreLoader({
        store: { getState: () => ({ mnxJson: "" }) } as never,
        loadScore,
        resetHistory: vi.fn(),
        openedFile,
        setSelectedScoreIndex: vi.fn(),
        setFileHandle,
        setFileError: vi.fn(),
      }),
    );

    await waitFor(() => expect(loadScore).toHaveBeenCalled());
    const score = loadScore.mock.calls[0]![0] as Score;
    expect(score.parts[0]!.measures[1]!.sequences[0]!.content).toEqual([]);
    expect(score.parts[0]!.measures[1]!.expressions?.[0]?.text).toBe("Import error E1");
    expect(setFileHandle).toHaveBeenCalledWith(null);
    expect(useImportErrorLogStore.getState().log).toMatchObject({
      status: "recovered",
      sourceFilename: "crumbfill.musx",
      producer: "denigma 4.0.0 (0426d4215db4); mnxdom 3.1.0 (ee14988)",
      recovered: [expect.objectContaining({ logId: "E1", measureId: "m2", voice: "s1layer1" })],
    });
  });
});
