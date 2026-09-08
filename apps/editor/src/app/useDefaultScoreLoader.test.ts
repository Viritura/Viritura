import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
    expect(setFileError).toHaveBeenCalledWith(expect.stringContaining("Please include this message when reporting"));
    expect(loadScore).not.toHaveBeenCalled();
  });
});
