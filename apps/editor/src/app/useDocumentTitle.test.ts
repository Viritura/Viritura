import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { createDocumentStore } from "../store/documentStore";
import { useDocumentTitle } from "./useDocumentTitle";

let appWindow: MediaQueryList;

beforeEach(() => {
  appWindow = window.matchMedia("(display-mode: standalone)");
  vi.spyOn(window, "matchMedia").mockReturnValue(appWindow);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.title = "";
});

function setAppWindow(matches: boolean): void {
  Object.defineProperty(appWindow, "matches", { configurable: true, value: matches });
  act(() => appWindow.dispatchEvent(new Event("change")));
}

function setup(title?: string, fileName = "", dirty = false) {
  const store = createDocumentStore();
  const score: Score = {
    mnx: { version: 1 },
    global: { measures: [] },
    parts: [],
    ...(title === undefined ? {} : { metadata: { title } }),
  };
  store.setState({ score, workingScore: score, fileName, dirty, mnxJson: dirty ? "edited" : "" });
  const hook = renderHook(() => useDocumentTitle(store));
  return { store, ...hook };
}

describe("editor document title", () => {
  it("uses the score title before the filename in browser tabs", () => {
    setup("  Nocturne  ", "imported-score.mnx");
    expect(document.title).toBe("Nocturne \u2014 Viritura");
  });

  it("uses the score title without duplicate branding in installed app windows", () => {
    setAppWindow(true);
    setup("Nocturne", "", true);
    expect(document.title).toBe("Nocturne \u2022");
    expect(window.matchMedia).toHaveBeenCalledWith(
      "(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)",
    );
  });

  it.each([undefined, "", "   "])("falls back to the filename for a missing or blank title (%s)", (title) => {
    setup(title, "score.mnx");
    expect(document.title).toBe("score.mnx \u2014 Viritura");
  });

  it("uses Untitled only when both the score title and filename are missing", () => {
    setAppWindow(true);
    setup();
    expect(document.title).toBe("Untitled");
  });

  it("updates after renaming, editing, saving, opening, and closing a document", () => {
    setAppWindow(true);
    const { store } = setup("Original");
    act(() => {
      const score = store.getState().score!;
      const renamed = { ...score, metadata: { title: "Renamed" } };
      store.setState({ score: renamed, workingScore: renamed, mnxJson: "renamed", dirty: true });
    });
    expect(document.title).toBe("Renamed \u2022");
    act(() => store.getState().markSaved(store.getState().mnxJson, store.getState().documentGeneration));
    expect(document.title).toBe("Renamed");
    act(() => store.getState().loadScore({ mnx: { version: 1 }, global: { measures: [] }, parts: [] }, "next.mnx"));
    expect(document.title).toBe("next.mnx");
    act(() => store.getState().newScore());
    expect(document.title).toBe("Untitled");
  });

  it("updates when moving between browser and installed display modes", () => {
    setup("Nocturne");
    setAppWindow(true);
    expect(document.title).toBe("Nocturne");
    setAppWindow(false);
    expect(document.title).toBe("Nocturne \u2014 Viritura");
  });

  it("clears the unsaved dot when undo restores the saved contents", () => {
    const { store } = setup("Nocturne", "", true);
    expect(document.title).toBe("Nocturne \u2022 \u2014 Viritura");
    act(() => store.setState({ mnxJson: store.getState().savedMnxJson }));
    expect(document.title).toBe("Nocturne \u2014 Viritura");
  });

  it("shows the unsaved dot for edits awaiting layout publication", () => {
    const { store } = setup("Nocturne");
    act(() => store.setState({ workingScore: { ...store.getState().score!, parts: [] } }));
    expect(document.title).toBe("Nocturne \u2022 \u2014 Viritura");
  });

  it("removes the display-mode listener on unmount", () => {
    const { unmount } = setup("Nocturne");
    unmount();
    document.title = "Another page";
    setAppWindow(true);
    expect(document.title).toBe("Another page");
  });
});
