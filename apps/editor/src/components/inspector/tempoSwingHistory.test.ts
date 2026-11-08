import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Score, Swing } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { createHistoryStore } from "../../store/historyStore";
import { useTempoHandlers } from "./useNotationInspectorActions";

describe("tempo swing inspector history", () => {
  it("persists exact settings through undo/redo/save/load without changing printed text or BPM", () => {
    const source: Score = {
      mnx: { version: 1 },
      global: { measures: [{ tempos: [{ bpm: 90, value: { base: "quarter" }, text: [{ text: "J-Pop" }] }] }] },
      parts: [{ measures: [{ sequences: [{ content: [] }] }] }],
    };
    let current = source;
    const history = createHistoryStore(JSON.stringify(serializeMnx(source)), { current: undefined });
    const updateScore = (score: Score) => {
      current = score;
      history.getState().pushState(JSON.stringify(serializeMnx(score)), "Tempo swing");
    };
    const target = { elementId: "m0/tempo0", elementType: "tempo0", measureIndex: 0, partIndex: 0 };
    const { result, rerender } = renderHook(({ score }) => useTempoHandlers({ score, target, updateScore }), {
      initialProps: { score: source },
    });
    const swing: Swing = { mode: "swing", subdivision: "16th", ratio: [2, 1] };
    act(() => result.current.handleTempoSwingChange(swing));
    rerender({ score: current });
    expect(result.current.selectedTempo?.swing).toEqual(swing);
    expect(current.global.measures[0].tempos?.[0].bpm).toBe(90);
    expect(current.global.measures[0].tempos?.[0].text).toEqual([{ text: "J-Pop" }]);
    const undone = history.getState().undo();
    expect(parseMnx(JSON.parse(undone!)).global.measures[0].tempos?.[0].swing).toBeUndefined();
    const redone = history.getState().redo();
    expect(parseMnx(JSON.parse(redone!)).global.measures[0].tempos?.[0].swing).toEqual(swing);
    act(() => result.current.handleTempoSwingChange(undefined));
    expect(current.global.measures[0].tempos?.[0].swing).toBeUndefined();
  });

  it("keeps a swing-only instruction selectable and retains its text when changing to inherit", () => {
    const source: Score = {
      mnx: { version: 1 },
      global: { measures: [{ tempos: [{ swing: { mode: "straight" }, text: [{ text: "Straight" }] }] }] },
      parts: [{ measures: [{ sequences: [{ content: [] }] }] }],
    };
    let current = source;
    const { result } = renderHook(() =>
      useTempoHandlers({
        score: source,
        target: { elementId: "m0/tempo0", elementType: "tempo0", measureIndex: 0, partIndex: 0 },
        updateScore: (score) => {
          current = score;
        },
      }),
    );
    expect(result.current.isTempoSelected).toBe(true);
    expect(result.current.selectedTempo?.bpm).toBeUndefined();
    act(() => result.current.handleTempoSwingChange(undefined));
    const restored = parseMnx(serializeMnx(current));
    expect(restored.global.measures[0].tempos?.[0].text).toEqual([{ text: "Straight" }]);
    expect(restored.global.measures[0].tempos?.[0].swing).toBeUndefined();
    expect(restored.global.measures[0].tempos?.[0].bpm).toBeUndefined();
  });
});
