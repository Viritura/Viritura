import { describe, it, expect, vi } from "vitest";
import { fuzzyMatch, matchScore } from "../components/jumpBarMatch";
import {
  buildJumpBarActions,
  resolveJumpBarNavigationQuery,
  resolveJumpBarResults,
  type JumpBarCallbacks,
} from "../jumpBar";
import { ACTIVITY_DEFINITIONS } from "../components/activityRegistry";
import type { Score } from "@viritura/core";

// ═══════════════════════════════════════════
// fuzzyMatch
// ═══════════════════════════════════════════

describe("fuzzyMatch", () => {
  it("matches exact string", () => {
    expect(fuzzyMatch("Save", "Save")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(fuzzyMatch("save", "Save")).toBe(true);
    expect(fuzzyMatch("SAVE", "save")).toBe(true);
  });

  it("matches subsequence", () => {
    expect(fuzzyMatch("sv", "Save")).toBe(true);
    expect(fuzzyMatch("tni", "Toggle Note Input")).toBe(true);
  });

  it("rejects non-subsequence", () => {
    expect(fuzzyMatch("xyz", "Save")).toBe(false);
    expect(fuzzyMatch("vs", "Save")).toBe(false); // wrong order
  });

  it("matches empty query to anything", () => {
    expect(fuzzyMatch("", "Save")).toBe(true);
    expect(fuzzyMatch("", "")).toBe(true);
  });

  it("rejects non-empty query against empty target", () => {
    expect(fuzzyMatch("a", "")).toBe(false);
  });

  it("matches across word boundaries", () => {
    expect(fuzzyMatch("zi", "Zoom In")).toBe(true);
  });
});

// ═══════════════════════════════════════════
// matchScore
// ═══════════════════════════════════════════

describe("matchScore", () => {
  it("returns 0 for prefix match", () => {
    expect(matchScore("sav", "Save")).toBe(0);
    expect(matchScore("zoom", "Zoom In")).toBe(0);
  });

  it("returns 1 for substring match", () => {
    expect(matchScore("oom", "Zoom In")).toBe(1);
    expect(matchScore("ave", "Save")).toBe(1);
  });

  it("returns 1 for word-start match (also a substring)", () => {
    // Word-start matches are caught by substring check first
    expect(matchScore("in", "Zoom In")).toBe(1);
    expect(matchScore("note", "Toggle Note Input")).toBe(1);
  });

  it("returns 3 for fuzzy-only match", () => {
    expect(matchScore("zi", "Zoom In")).toBe(3);
    expect(matchScore("sv", "Save")).toBe(3);
  });

  it("prefix is preferred over substring", () => {
    expect(matchScore("zo", "Zoom In")).toBeLessThan(matchScore("oo", "Zoom In"));
  });

  it("substring is preferred over fuzzy-only", () => {
    expect(matchScore("oom", "Zoom In")).toBeLessThan(matchScore("zi", "Zoom In"));
  });
});

// ═══════════════════════════════════════════
// buildJumpBarActions
// ═══════════════════════════════════════════

describe("buildJumpBarActions", () => {
  const noop = () => {};
  const baseCallbacks: JumpBarCallbacks = {
    newScore: noop,
    openProject: noop,
    openFile: noop,
    save: noop,
    saveAs: noop,
    exportPdf: noop,
    exportSvg: noop,
    undo: noop,
    redo: noop,
    copy: noop,
    cut: noop,
    paste: noop,
    selectAll: noop,
    deleteSelection: noop,
    transpose: noop,
    splitOrchestralStaves: noop,
    zoomIn: noop,
    zoomOut: noop,
    resetZoom: noop,
    togglePanels: noop,
    showHelp: noop,
    toggleSourceView: noop,
    toggleNoteInput: noop,
    openClefMenu: noop,
    openBarlineMenu: noop,
    openKeySignatureMenu: noop,
    openTimeSignatureMenu: noop,
    openDynamicsMenu: noop,
    openOrnamentsMenu: noop,
    openTupletMenu: noop,
    openBreathFermataMenu: noop,
    openFingeringMenu: noop,
    openArticulationMenu: noop,
    openRepeatsMenu: noop,
    setTempo: noop,
    addStaffText: noop,
    enterLyrics: noop,
    repeatSelection: noop,
    goToActivity: noop,
    switchScore: noop,
    openSettings: noop,
  };
  const actions = buildJumpBarActions(baseCallbacks, {
    scoreEntries: [
      { index: 0, name: "Full Score", isScore: true },
      { index: 1, name: "Flute 1", isScore: false },
    ],
    settings: [{ id: "appearance", label: "Appearance", keywords: ["theme", "dark", "light"] }],
  });

  describe("compact navigation queries", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [{}, { number: 125, rehearsalMark: { text: "A" } }, { rehearsalMark: { text: "125" } }],
      },
      parts: [],
    };

    it.each(["m125", "M 125", "b125", "B 125"])("resolves %s to the displayed measure number", (query) => {
      expect(resolveJumpBarNavigationQuery(query, score)).toEqual({
        measureIndex: 1,
        label: "Go to measure 125",
      });
    });

    it("uses ordinary one-based measure numbers when no override exists", () => {
      expect(resolveJumpBarNavigationQuery("m3", score)).toEqual({
        measureIndex: 2,
        label: "Go to measure 3",
      });
    });

    it.each([
      ["rA", 1, "Go to rehearsal A"],
      ["r a", 1, "Go to rehearsal A"],
      ["r125", 2, "Go to rehearsal 125"],
    ])("resolves %s by rehearsal text", (query, measureIndex, label) => {
      expect(resolveJumpBarNavigationQuery(query, score)).toEqual({ measureIndex, label });
    });

    it("returns no direct target for missing measures or rehearsal marks", () => {
      expect(resolveJumpBarNavigationQuery("m999", score)).toBeNull();
      expect(resolveJumpBarNavigationQuery("rZ", score)).toBeNull();
    });

    it("prioritizes a resolved navigation target over fuzzy command results", () => {
      const command = { id: "edit.repeat", label: "Repeat Selection", category: "Edit", execute: () => {} };
      const direct = {
        id: "navigation.measure.1",
        label: "Go to measure 125",
        category: "Navigation",
        execute: () => {},
      };

      expect(resolveJumpBarResults([command], "m125", () => direct)).toEqual([direct]);
    });
  });

  it("returns a non-empty array of actions", () => {
    expect(actions.length).toBeGreaterThan(30);
  });

  it("labels the orchestral split as a Part operation", () => {
    expect(actions.find((action) => action.id === "edit.splitOrchestralStaves")?.label).toBe(
      "Split Combined Orchestral Parts…",
    );
  });

  it("each action has required fields", () => {
    for (const a of actions) {
      expect(a.id).toBeTruthy();
      expect(a.label).toBeTruthy();
      expect(a.category).toBeTruthy();
      expect(typeof a.execute).toBe("function");
    }
  });

  it("has unique IDs", () => {
    const ids = actions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes expected categories", () => {
    const categories = new Set(actions.map((a) => a.category));
    expect(categories.has("File")).toBe(true);
    expect(categories.has("Edit")).toBe(true);
    expect(categories.has("View")).toBe(true);
    expect(categories.has("Add")).toBe(true);
    expect(categories.has("Input")).toBe(true);
    expect(categories.has("Activity")).toBe(true);
    expect(categories.has("Scores & Parts")).toBe(true);
    expect(categories.has("Settings")).toBe(true);
  });

  it("includes file operations with shortcuts", () => {
    const save = actions.find((a) => a.id === "file.save");
    expect(save).toBeDefined();
    expect(save!.shortcut).toBe("Ctrl+S");

    const openProject = actions.find((a) => a.id === "file.openProject");
    expect(openProject).toBeDefined();
    expect(openProject!.shortcut).toBe("Ctrl+O");

    const openMnx = actions.find((a) => a.id === "file.openMnx");
    expect(openMnx).toBeDefined();
    expect(openMnx!.shortcut).toBe("Ctrl+Shift+O");
  });

  it("includes radial menu actions", () => {
    const clef = actions.find((a) => a.id === "add.clef");
    expect(clef).toBeDefined();
    expect(clef!.label).toBe("Clef Menu");
    expect(clef!.shortcut).toBe("Shift+C");
  });

  it("derives every registered activity", () => {
    const activityIds = new Set(actions.filter((action) => action.category === "Activity").map((action) => action.id));
    expect(activityIds).toEqual(new Set(ACTIVITY_DEFINITIONS.map((activity) => `activity.${activity.view}`)));
  });

  it("derives score, part, and settings destinations", () => {
    expect(actions.find((action) => action.id === "score.0")?.label).toBe("Switch to Full Score");
    expect(actions.find((action) => action.id === "score.1")?.keywords).toContain("instrumental part");
    expect(actions.find((action) => action.id === "settings.appearance")?.label).toBe("Settings: Appearance");
  });

  it("shows dynamic score destinations only after the user searches", () => {
    const defaultResults = resolveJumpBarResults(actions, "");
    expect(defaultResults[0]?.id).toBe("file.new");
    expect(defaultResults.some((action) => action.id === "score.0")).toBe(false);
    expect(resolveJumpBarResults(actions, "full score").map((action) => action.id)).toContain("score.0");
  });

  it("executes derived destination callbacks", () => {
    const goToActivity = vi.fn();
    const switchScore = vi.fn();
    const openSettings = vi.fn();
    const callbacks: JumpBarCallbacks = {
      ...baseCallbacks,
      goToActivity,
      switchScore,
      openSettings,
    };
    const derived = buildJumpBarActions(callbacks, {
      scoreEntries: [{ index: 3, name: "Clarinet", isScore: false }],
      settings: [{ id: "import", label: "Import", keywords: [] }],
    });

    derived.find((action) => action.id === "activity.picture")?.execute();
    derived.find((action) => action.id === "score.3")?.execute();
    derived.find((action) => action.id === "settings.import")?.execute();

    expect(goToActivity).toHaveBeenCalledWith("picture");
    expect(switchScore).toHaveBeenCalledWith(3);
    expect(openSettings).toHaveBeenCalledWith("import");
  });

  it("includes keyword search terms", () => {
    const tempo = actions.find((a) => a.id === "add.tempo");
    expect(tempo).toBeDefined();
    expect(tempo!.keywords).toContain("bpm");
    expect(tempo!.keywords).toContain("metronome");
  });

  it("actions with fuzzy search filter correctly", () => {
    // Simulate filtering like JumpBar does
    const query = "tempo";
    const filtered = actions.filter((a) => {
      const searchText = [a.label, a.category, a.shortcut ?? "", ...(a.keywords ?? [])].join(" ");
      return fuzzyMatch(query, searchText);
    });
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.some((a) => a.id === "add.tempo")).toBe(true);
  });

  it("keyword search finds actions by domain terms", () => {
    const query = "triplet";
    const filtered = actions.filter((a) => {
      const searchText = [a.label, a.category, a.shortcut ?? "", ...(a.keywords ?? [])].join(" ");
      return fuzzyMatch(query, searchText);
    });
    expect(filtered.some((a) => a.id === "add.tuplet")).toBe(true);
  });
});
