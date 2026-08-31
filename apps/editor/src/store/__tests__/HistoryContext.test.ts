import { describe, it, expect } from "vitest";
import { createHistoryStore, historyReducer, MAX_HISTORY, type HistoryState } from "../historyStore";

function makeState(entries: Array<{ mnxJson: string; description: string }>, currentIndex: number): HistoryState {
  return { entries, currentIndex };
}

function emptyState(): HistoryState {
  return { entries: [], currentIndex: -1 };
}

function initialState(mnxJson = '{"initial":true}'): HistoryState {
  return {
    entries: [{ mnxJson, description: "Initial state" }],
    currentIndex: 0,
  };
}

describe("historyReducer", () => {
  describe("push", () => {
    it("pushes first entry onto empty state", () => {
      const state = emptyState();
      const next = historyReducer(state, {
        type: "push",
        mnxJson: '{"v":1}',
        description: "Add note",
      });
      expect(next.entries).toHaveLength(1);
      expect(next.currentIndex).toBe(0);
      expect(next.entries[0]?.mnxJson).toBe('{"v":1}');
      expect(next.entries[0]?.description).toBe("Add note");
    });

    it("appends entry after initial state", () => {
      const state = initialState();
      const next = historyReducer(state, {
        type: "push",
        mnxJson: '{"v":2}',
        description: "Change pitch",
      });
      expect(next.entries).toHaveLength(2);
      expect(next.currentIndex).toBe(1);
      expect(next.entries[1]?.mnxJson).toBe('{"v":2}');
    });

    it("discards redo entries when pushing after undo", () => {
      const state = makeState(
        [
          { mnxJson: '{"v":1}', description: "A" },
          { mnxJson: '{"v":2}', description: "B" },
          { mnxJson: '{"v":3}', description: "C" },
        ],
        0, // After two undos, we're at index 0
      );

      const next = historyReducer(state, {
        type: "push",
        mnxJson: '{"v":4}',
        description: "D",
      });

      // Should have only entries[0] + new entry, entries B and C are gone
      expect(next.entries).toHaveLength(2);
      expect(next.currentIndex).toBe(1);
      expect(next.entries[0]?.description).toBe("A");
      expect(next.entries[1]?.description).toBe("D");
    });

    it("caps history at MAX_HISTORY entries", () => {
      // Build a state with MAX_HISTORY - 1 entries
      const entries = Array.from({ length: MAX_HISTORY }, (_, i) => ({
        mnxJson: `{"v":${i}}`,
        description: `Entry ${i}`,
      }));
      const state = makeState(entries, MAX_HISTORY - 1);

      // Push one more — should still be MAX_HISTORY entries, oldest removed
      const next = historyReducer(state, {
        type: "push",
        mnxJson: '{"v":overflow}',
        description: "Overflow",
      });

      expect(next.entries).toHaveLength(MAX_HISTORY);
      expect(next.currentIndex).toBe(MAX_HISTORY - 1);
      // First entry should now be Entry 1 (Entry 0 was dropped)
      expect(next.entries[0]?.description).toBe("Entry 1");
      expect(next.entries[next.entries.length - 1]?.description).toBe("Overflow");
    });
  });

  describe("undo", () => {
    it("decrements currentIndex when possible", () => {
      const state = makeState(
        [
          { mnxJson: '{"v":1}', description: "A" },
          { mnxJson: '{"v":2}', description: "B" },
        ],
        1,
      );

      const next = historyReducer(state, { type: "undo" });
      expect(next.currentIndex).toBe(0);
      expect(next.entries).toHaveLength(2); // entries untouched
    });

    it("does nothing when already at the beginning", () => {
      const state = initialState();
      const next = historyReducer(state, { type: "undo" });
      expect(next).toBe(state); // Same reference — no change
    });

    it("does nothing on empty state", () => {
      const state = emptyState();
      const next = historyReducer(state, { type: "undo" });
      expect(next).toBe(state);
    });

    it("allows multiple sequential undos", () => {
      const state = makeState(
        [
          { mnxJson: '{"v":1}', description: "A" },
          { mnxJson: '{"v":2}', description: "B" },
          { mnxJson: '{"v":3}', description: "C" },
        ],
        2,
      );

      const after1 = historyReducer(state, { type: "undo" });
      expect(after1.currentIndex).toBe(1);

      const after2 = historyReducer(after1, { type: "undo" });
      expect(after2.currentIndex).toBe(0);

      const after3 = historyReducer(after2, { type: "undo" });
      expect(after3).toBe(after2); // Can't undo past 0
    });
  });

  describe("redo", () => {
    it("increments currentIndex when there are entries ahead", () => {
      const state = makeState(
        [
          { mnxJson: '{"v":1}', description: "A" },
          { mnxJson: '{"v":2}', description: "B" },
        ],
        0,
      );

      const next = historyReducer(state, { type: "redo" });
      expect(next.currentIndex).toBe(1);
    });

    it("does nothing when already at the end", () => {
      const state = makeState(
        [
          { mnxJson: '{"v":1}', description: "A" },
          { mnxJson: '{"v":2}', description: "B" },
        ],
        1,
      );

      const next = historyReducer(state, { type: "redo" });
      expect(next).toBe(state);
    });

    it("does nothing on empty state", () => {
      const state = emptyState();
      const next = historyReducer(state, { type: "redo" });
      expect(next).toBe(state);
    });
  });

  describe("reset", () => {
    it("resets to a single initial entry", () => {
      const state = makeState(
        [
          { mnxJson: '{"v":1}', description: "A" },
          { mnxJson: '{"v":2}', description: "B" },
          { mnxJson: '{"v":3}', description: "C" },
        ],
        1,
      );

      const next = historyReducer(state, {
        type: "reset",
        mnxJson: '{"fresh":true}',
      });

      expect(next.entries).toHaveLength(1);
      expect(next.currentIndex).toBe(0);
      expect(next.entries[0]?.mnxJson).toBe('{"fresh":true}');
      expect(next.entries[0]?.description).toBe("Initial state");
    });
  });

  describe("undo + redo round-trip", () => {
    it("undo then redo returns to the same state", () => {
      const state = makeState(
        [
          { mnxJson: '{"v":1}', description: "A" },
          { mnxJson: '{"v":2}', description: "B" },
        ],
        1,
      );

      const afterUndo = historyReducer(state, { type: "undo" });
      expect(afterUndo.currentIndex).toBe(0);

      const afterRedo = historyReducer(afterUndo, { type: "redo" });
      expect(afterRedo.currentIndex).toBe(1);
      expect(afterRedo.entries[afterRedo.currentIndex]?.mnxJson).toBe('{"v":2}');
    });

    it("push after undo discards redo branch", () => {
      const state = makeState(
        [
          { mnxJson: '{"v":1}', description: "A" },
          { mnxJson: '{"v":2}', description: "B" },
          { mnxJson: '{"v":3}', description: "C" },
        ],
        2,
      );

      // Undo twice
      const afterUndo1 = historyReducer(state, { type: "undo" });
      const afterUndo2 = historyReducer(afterUndo1, { type: "undo" });
      expect(afterUndo2.currentIndex).toBe(0);

      // Push new state — should discard B and C
      const afterPush = historyReducer(afterUndo2, {
        type: "push",
        mnxJson: '{"v":4}',
        description: "D",
      });

      expect(afterPush.entries).toHaveLength(2);
      expect(afterPush.entries[0]?.description).toBe("A");
      expect(afterPush.entries[1]?.description).toBe("D");

      // Redo should do nothing now — no redo branch
      const afterRedo = historyReducer(afterPush, { type: "redo" });
      expect(afterRedo).toBe(afterPush);
    });
  });

  describe("edit-then-undo scenario", () => {
    it("simulates adding a note then undoing removes it", () => {
      // Start with initial empty score
      let state = initialState('{"measures":[{"events":[]}]}');

      // Add a note → push the new state
      state = historyReducer(state, {
        type: "push",
        mnxJson: '{"measures":[{"events":["C4"]}]}',
        description: "Add note C4",
      });
      expect(state.entries[state.currentIndex]?.mnxJson).toContain("C4");

      // Undo → back to empty
      state = historyReducer(state, { type: "undo" });
      expect(state.entries[state.currentIndex]?.mnxJson).not.toContain("C4");

      // Redo → note is back
      state = historyReducer(state, { type: "redo" });
      expect(state.entries[state.currentIndex]?.mnxJson).toContain("C4");
    });
  });
});

describe("history cursor restoration", () => {
  it("reverses advancing and rewinding cursor edits through undo and redo", () => {
    const restored: Array<{ mnx: string; cursor: { beatPosition: number } | null | undefined }> = [];
    const store = createHistoryStore('{"v":0}', {
      current: (mnx, cursor) => restored.push({ mnx, cursor }),
    });
    const atStart = { measureIndex: 0, beatPosition: 0, partIndex: 0 };
    const advanced = { measureIndex: 0, beatPosition: 1, partIndex: 0 };

    store.getState().pushState('{"v":1}', "Insert note", atStart, advanced);
    store.getState().undo();
    expect(restored.at(-1)).toEqual({ mnx: '{"v":0}', cursor: atStart });
    store.getState().redo();
    expect(restored.at(-1)).toEqual({ mnx: '{"v":1}', cursor: advanced });

    store.getState().pushState('{"v":2}', "Delete note", advanced, atStart);
    store.getState().undo();
    expect(restored.at(-1)).toEqual({ mnx: '{"v":1}', cursor: advanced });
    store.getState().redo();
    expect(restored.at(-1)).toEqual({ mnx: '{"v":2}', cursor: atStart });
  });
});
