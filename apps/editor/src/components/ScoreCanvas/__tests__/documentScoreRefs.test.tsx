import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { getGlobalPerfTracker } from "@viritura/renderer";

import { createDocumentStore } from "../../../store/documentStore";
import { useDocumentScoreRefs } from "../documentScoreRefs";

function scoreWithPart(id: string): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [{ id, name: "Flute", measures: [{ sequences: [{ content: [] }] }] }],
  };
}

describe("useDocumentScoreRefs", () => {
  it("exposes a loaded document before its fast layout captures the model", () => {
    const store = createDocumentStore();
    const published = scoreWithPart("old");
    store.getState().loadScore(published);
    const hook = renderHook(() => useDocumentScoreRefs(store, published));
    const perf = getGlobalPerfTracker();
    const priorCallback = perf.fastLayoutCallback;
    const loaded = scoreWithPart("loaded");
    let captured: Score | null = null;
    try {
      perf.fastLayoutCallback = () => {
        captured = hook.result.current.docScoreRef.current;
      };
      act(() => store.getState().loadScore(loaded));
      expect(captured).toBe(loaded);
      expect(hook.result.current.docScoreRef.current).toBe(loaded);
    } finally {
      perf.fastLayoutCallback = priorCallback;
      hook.unmount();
    }
  });

  it("keeps the live working score through unrelated rerenders before publication", () => {
    const published = scoreWithPart("published");
    const working = scoreWithPart("working");
    const store = createDocumentStore();
    store.setState({ score: published, workingScore: published });

    const hook = renderHook(({ score }) => useDocumentScoreRefs(store, score), {
      initialProps: { score: published },
    });

    act(() => store.setState({ workingScore: working }));
    expect(hook.result.current.docScoreRef.current).toBe(working);
    expect(hook.result.current.partIdByIndexRef.current).toEqual(["working"]);

    hook.rerender({ score: published });

    expect(hook.result.current.docScoreRef.current).toBe(working);
    expect(hook.result.current.partIdByIndexRef.current).toEqual(["working"]);
  });
});
