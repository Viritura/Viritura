import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createDocumentStore } from "./documentStore";
import { useUnsavedChangesWarning } from "./useUnsavedChangesWarning";
import type { Score } from "@viritura/core";

function beforeUnload(): Event {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

function setup() {
  const store = createDocumentStore();
  const hook = renderHook(() => useUnsavedChangesWarning(store));
  return { store, ...hook };
}

describe("unsaved changes browser warning", () => {
  it("does not interrupt an empty or freshly loaded document", () => {
    const { store, unmount } = setup();
    expect(beforeUnload().defaultPrevented).toBe(false);
    act(() => store.setState({ mnxJson: "loaded", savedMnxJson: "loaded" }));
    expect(beforeUnload().defaultPrevented).toBe(false);
    unmount();
  });

  it("interrupts edits, clears after saving, and re-arms on the next edit", () => {
    const { store, unmount } = setup();
    act(() => store.setState({ mnxJson: "edited" }));
    expect(beforeUnload().defaultPrevented).toBe(true);
    act(() => store.getState().markSaved("edited", 0));
    expect(beforeUnload().defaultPrevented).toBe(false);
    act(() => store.setState({ mnxJson: "edited again" }));
    expect(beforeUnload().defaultPrevented).toBe(true);
    unmount();
  });

  it("does not clear newer edits when an earlier snapshot finishes saving", () => {
    const { store, unmount } = setup();
    act(() => {
      store.setState({ mnxJson: "newer" });
      store.getState().markSaved("older", 0);
    });
    expect(beforeUnload().defaultPrevented).toBe(true);
    unmount();
  });

  it("ignores a completed save from a previously opened document", () => {
    const { store, unmount } = setup();
    act(() => {
      store.setState({ mnxJson: "new document", savedMnxJson: "new document", documentGeneration: 1 });
      store.getState().markSaved("old document", 0);
    });
    expect(store.getState().savedMnxJson).toBe("new document");
    expect(beforeUnload().defaultPrevented).toBe(false);
    unmount();
  });

  it("protects edits awaiting layout publication", () => {
    const { store, unmount } = setup();
    const score: Score = { mnx: { version: 1 }, global: { measures: [] }, parts: [] };
    act(() => store.setState({ workingScore: score }));
    expect(beforeUnload().defaultPrevented).toBe(true);
    act(() => store.setState({ score, mnxJson: "published" }));
    expect(beforeUnload().defaultPrevented).toBe(true);
    unmount();
  });

  it("preserves the saved baseline during undo and redo loads", () => {
    const { store, unmount } = setup();
    const score: Score = { mnx: { version: 1 }, global: { measures: [] }, parts: [] };
    act(() => store.getState().loadScore(score, "score.mnx", "saved"));
    act(() => store.getState().loadScore(score, undefined, "edited", true));
    expect(beforeUnload().defaultPrevented).toBe(true);
    act(() => store.getState().loadScore(score, undefined, "saved", true));
    expect(beforeUnload().defaultPrevented).toBe(false);
    act(() => store.getState().loadScore(score, undefined, "edited", true));
    expect(beforeUnload().defaultPrevented).toBe(true);
    act(() => store.getState().newScore());
    expect(beforeUnload().defaultPrevented).toBe(false);
    unmount();
  });

  it("removes the listener and subscription on unmount", () => {
    const { store, unmount } = setup();
    const addListener = vi.spyOn(window, "addEventListener");
    act(() => store.setState({ mnxJson: "edited" }));
    unmount();
    expect(beforeUnload().defaultPrevented).toBe(false);
    addListener.mockClear();
    store.setState({ mnxJson: "another edit" });
    expect(addListener).not.toHaveBeenCalled();
    addListener.mockRestore();
  });
});
