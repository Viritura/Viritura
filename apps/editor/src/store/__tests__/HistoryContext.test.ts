import { describe, it, expect } from "vitest";
import { createHistoryStore, MAX_HISTORY, type HistoryStore } from "../historyStore";

function makeStore(initial?: string): { store: HistoryStore; restored: string[] } {
  const restored: string[] = [];
  const store = createHistoryStore(initial, { current: (mnx) => restored.push(mnx) });
  return { store, restored };
}

function contentsOf(store: HistoryStore): Array<string | undefined> {
  const { entries, getEntryMnxJson } = store.getState();
  return entries.map((_, index) => getEntryMnxJson(index));
}

describe("history store", () => {
  describe("push", () => {
    it("pushes first entry onto empty state", () => {
      const { store } = makeStore();
      store.getState().pushState('{"v":1}', "Add note");
      const state = store.getState();
      expect(state.entries).toHaveLength(1);
      expect(state.currentIndex).toBe(0);
      expect(state.currentMnxJson).toBe('{"v":1}');
      expect(state.entries[0]?.description).toBe("Add note");
    });

    it("appends entry after initial state", () => {
      const { store } = makeStore('{"initial":true}');
      store.getState().pushState('{"v":2}', "Change pitch");
      expect(store.getState().currentIndex).toBe(1);
      expect(contentsOf(store)).toEqual(['{"initial":true}', '{"v":2}']);
    });

    it("discards redo entries when pushing after undo", () => {
      const { store } = makeStore('{"v":1}');
      store.getState().pushState('{"v":2}', "B");
      store.getState().pushState('{"v":3}', "C");
      store.getState().undo();
      store.getState().undo();
      store.getState().pushState('{"v":4}', "D");

      const state = store.getState();
      expect(state.entries.map((e) => e.description)).toEqual(["Initial state", "D"]);
      expect(state.canRedo).toBe(false);
      expect(contentsOf(store)).toEqual(['{"v":1}', '{"v":4}']);
    });

    it("caps history at MAX_HISTORY entries and keeps the oldest reconstructible", () => {
      const { store } = makeStore('{"v":0}');
      for (let i = 1; i <= MAX_HISTORY; i++) store.getState().pushState(`{"v":${i}}`, `Entry ${i}`);

      const state = store.getState();
      expect(state.entries).toHaveLength(MAX_HISTORY);
      expect(state.currentIndex).toBe(MAX_HISTORY - 1);
      expect(state.entries[0]?.description).toBe("Entry 1");
      expect(state.getEntryMnxJson(0)).toBe('{"v":1}');
      expect(state.jumpTo(0)).toBe('{"v":1}');
    });
  });

  describe("undo / redo / jump", () => {
    it("walks back and forth through every entry", () => {
      const { store, restored } = makeStore('{"v":1}');
      store.getState().pushState('{"v":2}', "B");
      store.getState().pushState('{"v":3}', "C");

      expect(store.getState().undo()).toBe('{"v":2}');
      expect(store.getState().undo()).toBe('{"v":1}');
      expect(store.getState().undo()).toBeUndefined();
      expect(store.getState().redo()).toBe('{"v":2}');
      expect(store.getState().redo()).toBe('{"v":3}');
      expect(store.getState().redo()).toBeUndefined();
      expect(restored).toEqual(['{"v":2}', '{"v":1}', '{"v":2}', '{"v":3}']);
    });

    it("jumps across many steps in both directions", () => {
      const { store } = makeStore("");
      const texts = [""];
      for (let i = 1; i <= 40; i++) {
        const next = `${texts[i - 1]}[m${i}]`.replace(`[m${i - 3}]`, `[x${i}]`);
        texts.push(next);
        store.getState().pushState(next, `Step ${i}`);
      }
      expect(store.getState().jumpTo(3)).toBe(texts[3]);
      expect(store.getState().jumpTo(38)).toBe(texts[38]);
      expect(store.getState().jumpTo(0)).toBe(texts[0]);
      expect(contentsOf(store)).toEqual(texts);
    });

    it("does nothing on empty state", () => {
      const { store } = makeStore();
      expect(store.getState().undo()).toBeUndefined();
      expect(store.getState().redo()).toBeUndefined();
      expect(store.getState().getEntryMnxJson(0)).toBeUndefined();
    });
  });

  describe("reset", () => {
    it("resets to a single initial entry", () => {
      const { store } = makeStore('{"v":1}');
      store.getState().pushState('{"v":2}', "B");
      store.getState().undo();
      store.getState().reset('{"fresh":true}');

      const state = store.getState();
      expect(state.entries).toHaveLength(1);
      expect(state.currentIndex).toBe(0);
      expect(state.currentMnxJson).toBe('{"fresh":true}');
      expect(state.entries[0]?.description).toBe("Initial state");
    });
  });

  describe("lookup by id", () => {
    it("reconstructs pinned snapshots until they are evicted", () => {
      const { store } = makeStore('{"v":0}');
      store.getState().pushState('{"v":1}', "A");
      const pinned = store.getState().currentEntryId!;
      store.getState().pushState('{"v":2}', "B");
      expect(store.getState().getEntryMnxJsonById(pinned)).toBe('{"v":1}');

      store.getState().reset('{"v":9}');
      expect(store.getState().getEntryMnxJsonById(pinned)).toBeUndefined();
    });
  });

  it("round-trips randomized edit sequences exactly", () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const alphabet = 'ab{}[]":,\u00e9\ud834\udd1e';
    const randomText = (length: number) =>
      Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");

    let text = randomText(200);
    const texts = [text];
    const { store } = makeStore(text);
    for (let i = 0; i < 120; i++) {
      const start = Math.floor(random() * (text.length + 1));
      const end = Math.min(text.length, start + Math.floor(random() * 12));
      text = text.slice(0, start) + randomText(Math.floor(random() * 12)) + text.slice(end);
      texts.push(text);
      store.getState().pushState(text, "Edit");
      if (random() < 0.2) store.getState().jumpTo(Math.floor(random() * texts.length));
      if (store.getState().currentIndex !== texts.length - 1) {
        texts.splice(store.getState().currentIndex + 1);
        text = texts[texts.length - 1]!;
      }
    }
    expect(contentsOf(store)).toEqual(texts);
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
