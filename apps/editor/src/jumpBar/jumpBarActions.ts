/**
 * Jump bar action definitions.
 *
 * Every user-triggerable action in the editor should appear here so that it
 * is discoverable via the jump bar (Ctrl+Space).
 *
 * Actions are grouped by category and include optional shortcut hints and
 * extra keywords for fuzzy search.
 */

import type { JumpBarAction } from "../components/JumpBar";
import { ACTIVITY_DEFINITIONS, type ActivityView } from "../components/activityRegistry";
import type { ScoreEntry } from "../scoreSwitcher/scoreEntries";

interface JumpBarSettingsDestination {
  readonly id: string;
  readonly label: string;
  readonly keywords: readonly string[];
}

export interface JumpBarDestinations {
  readonly scoreEntries: readonly ScoreEntry[];
  readonly settings: readonly JumpBarSettingsDestination[];
}

const EMPTY_DESTINATIONS: JumpBarDestinations = { scoreEntries: [], settings: [] };

/**
 * Callbacks that App.tsx provides to assemble the action list.
 * Each field maps to an imperative operation in the editor.
 */
export interface JumpBarCallbacks {
  // File
  newScore: () => void;
  openProject: () => void;
  openFile: () => void;
  save: () => void;
  saveAs: () => void;
  exportPdf: () => void;
  exportSvg: () => void;

  // Edit
  undo: () => void;
  redo: () => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  selectAll: () => void;
  deleteSelection: () => void;

  // View
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  togglePanels: () => void;
  showHelp: () => void;
  toggleSourceView: () => void;

  // Score input
  toggleNoteInput: () => void;

  // Dialogs
  transpose: () => void;
  splitOrchestralStaves: () => void;

  // Radial menus
  openClefMenu: () => void;
  openBarlineMenu: () => void;
  openKeySignatureMenu: () => void;
  openTimeSignatureMenu: () => void;
  openDynamicsMenu: () => void;
  openOrnamentsMenu: () => void;
  openTupletMenu: () => void;
  openBreathFermataMenu: () => void;
  openFingeringMenu: () => void;
  openArticulationMenu: () => void;
  openRepeatsMenu: () => void;

  // Popovers
  setTempo: () => void;
  addStaffText: () => void;
  enterLyrics: () => void;

  // Repeat
  repeatSelection: () => void;

  // Derived destinations
  goToActivity: (view: ActivityView) => void;
  switchScore: (index: number) => void;
  openSettings: (id: string) => void;
}

/**
 * Build the flat action array from App-level callbacks.
 */
// eslint-disable-next-line max-lines-per-function -- declarative action catalog: one record per command-palette entry (File/Edit/View/Insert/Selection/Playback/...). Each record is 4-6 lines (id, label, shortcut, run). Splitting per category would just spread the same catalog across N files with no behavior to share.
export function buildJumpBarActions(
  cb: JumpBarCallbacks,
  destinations: JumpBarDestinations = EMPTY_DESTINATIONS,
): JumpBarAction[] {
  const activityActions: JumpBarAction[] = ACTIVITY_DEFINITIONS.map((activity) => ({
    id: `activity.${activity.view}`,
    label: `Go to ${activity.label}`,
    category: "Activity",
    keywords: [...activity.keywords, "activity", "workspace"],
    execute: () => cb.goToActivity(activity.view),
  }));
  const scoreActions: JumpBarAction[] = destinations.scoreEntries.map((entry) => ({
    id: `score.${entry.index}`,
    label: `Switch to ${entry.name}`,
    category: "Scores & Parts",
    keywords: [entry.isScore ? "score" : "instrumental part", "layout", "view"],
    hideWhenEmpty: true,
    execute: () => cb.switchScore(entry.index),
  }));
  const settingsActions: JumpBarAction[] = destinations.settings.map((setting) => ({
    id: `settings.${setting.id}`,
    label: `Settings: ${setting.label}`,
    category: "Settings",
    keywords: [...setting.keywords],
    execute: () => cb.openSettings(setting.id),
  }));

  return [
    // ─── File ───────────────────────────
    {
      id: "file.new",
      label: "New Project",
      category: "File",
      shortcut: "Ctrl+N",
      keywords: ["create", "blank"],
      execute: cb.newScore,
    },
    {
      id: "file.openProject",
      label: "Open Project Folder",
      category: "File",
      shortcut: "Ctrl+O",
      keywords: ["load", "folder", "git"],
      execute: cb.openProject,
    },
    {
      id: "file.openMnx",
      label: "Open MNX Score",
      category: "File",
      shortcut: "Ctrl+Shift+O",
      keywords: ["load", "import", "mnx"],
      execute: cb.openFile,
    },
    {
      id: "file.save",
      label: "Save",
      category: "File",
      shortcut: "Ctrl+S",
      keywords: ["export", "download"],
      execute: cb.save,
    },
    {
      id: "file.saveAs",
      label: "Save As…",
      category: "File",
      shortcut: "Ctrl+Shift+S",
      keywords: ["export", "download"],
      execute: cb.saveAs,
    },
    { id: "file.pdf", label: "Export PDF", category: "File", keywords: ["print", "pdf"], execute: cb.exportPdf },
    {
      id: "file.svg",
      label: "Export SVG",
      category: "File",
      keywords: ["vector", "svg", "image"],
      execute: cb.exportSvg,
    },

    // ─── Edit ───────────────────────────
    { id: "edit.undo", label: "Undo", category: "Edit", shortcut: "Ctrl+Z", execute: cb.undo },
    { id: "edit.redo", label: "Redo", category: "Edit", shortcut: "Ctrl+Y", execute: cb.redo },
    { id: "edit.copy", label: "Copy", category: "Edit", shortcut: "Ctrl+C", execute: cb.copy },
    { id: "edit.cut", label: "Cut", category: "Edit", shortcut: "Ctrl+X", execute: cb.cut },
    { id: "edit.paste", label: "Paste", category: "Edit", shortcut: "Ctrl+V", execute: cb.paste },
    { id: "edit.selectAll", label: "Select All", category: "Edit", shortcut: "Ctrl+A", execute: cb.selectAll },
    {
      id: "edit.delete",
      label: "Delete Selection",
      category: "Edit",
      shortcut: "Delete",
      keywords: ["remove", "backspace"],
      execute: cb.deleteSelection,
    },
    {
      id: "edit.repeat",
      label: "Repeat Selection",
      category: "Edit",
      shortcut: "R",
      keywords: ["duplicate", "copy", "clone", "again"],
      execute: cb.repeatSelection,
    },
    {
      id: "edit.transpose",
      label: "Transpose…",
      category: "Edit",
      keywords: ["key", "interval", "semitone"],
      execute: cb.transpose,
    },
    {
      id: "edit.splitOrchestralStaves",
      label: "Split Combined Orchestral Parts…",
      category: "Edit",
      keywords: ["orchestra", "players", "divisi", "parts"],
      execute: cb.splitOrchestralStaves,
    },

    // ─── View ───────────────────────────
    { id: "view.zoomIn", label: "Zoom In", category: "View", shortcut: "Ctrl+=", execute: cb.zoomIn },
    { id: "view.zoomOut", label: "Zoom Out", category: "View", shortcut: "Ctrl+-", execute: cb.zoomOut },
    { id: "view.resetZoom", label: "Reset Zoom", category: "View", shortcut: "Ctrl+0", execute: cb.resetZoom },
    {
      id: "view.togglePanels",
      label: "Toggle Panels",
      category: "View",
      shortcut: "Ctrl+\\",
      keywords: ["sidebar", "inspector", "hide", "show"],
      execute: cb.togglePanels,
    },
    {
      id: "view.source",
      label: "Toggle Source View",
      category: "View",
      keywords: ["mnx", "json", "code"],
      execute: cb.toggleSourceView,
    },
    {
      id: "view.help",
      label: "Show Help",
      category: "View",
      shortcut: "F1",
      keywords: ["shortcuts", "keyboard"],
      execute: cb.showHelp,
    },

    // ─── Input ──────────────────────────
    {
      id: "input.noteInput",
      label: "Toggle Note Input",
      category: "Input",
      shortcut: "N",
      keywords: ["entry", "mode", "notes"],
      execute: cb.toggleNoteInput,
    },
    {
      id: "input.lyrics",
      label: "Enter Lyrics",
      category: "Input",
      shortcut: "Shift+W",
      keywords: ["text", "words", "syllable"],
      execute: cb.enterLyrics,
    },

    // ─── Add ────────────────────────────
    {
      id: "add.tempo",
      label: "Set Tempo",
      category: "Add",
      shortcut: "Shift+T",
      keywords: ["bpm", "metronome", "speed"],
      execute: cb.setTempo,
    },
    {
      id: "add.staffText",
      label: "Add Staff Text",
      category: "Add",
      shortcut: "Shift+X",
      keywords: ["expression", "annotation", "text"],
      execute: cb.addStaffText,
    },
    {
      id: "add.clef",
      label: "Clef Menu",
      category: "Add",
      shortcut: "Shift+C",
      keywords: ["treble", "bass", "alto", "tenor"],
      execute: cb.openClefMenu,
    },
    {
      id: "add.barline",
      label: "Barline Menu",
      category: "Add",
      shortcut: "Shift+B",
      keywords: ["double", "final", "repeat", "dashed"],
      execute: cb.openBarlineMenu,
    },
    {
      id: "add.keySig",
      label: "Key Signature Menu",
      category: "Add",
      shortcut: "Shift+5",
      keywords: ["sharp", "flat", "major", "minor"],
      execute: cb.openKeySignatureMenu,
    },
    {
      id: "add.timeSig",
      label: "Time Signature Menu",
      category: "Add",
      shortcut: "Shift+M",
      keywords: ["meter", "4/4", "3/4", "6/8"],
      execute: cb.openTimeSignatureMenu,
    },
    {
      id: "add.dynamic",
      label: "Dynamics Menu",
      category: "Add",
      shortcut: "Shift+D",
      keywords: ["piano", "forte", "crescendo", "ff", "pp", "mf", "mp"],
      execute: cb.openDynamicsMenu,
    },
    {
      id: "add.ornament",
      label: "Ornaments Menu",
      category: "Add",
      shortcut: "Shift+O",
      keywords: ["trill", "mordent", "turn", "tremolo"],
      execute: cb.openOrnamentsMenu,
    },
    {
      id: "add.tuplet",
      label: "Tuplet Menu",
      category: "Add",
      shortcut: "Shift+3",
      keywords: ["triplet", "quintuplet", "sextuplet"],
      execute: cb.openTupletMenu,
    },
    {
      id: "add.breathFermata",
      label: "Breath / Fermata Menu",
      category: "Add",
      shortcut: "Shift+H",
      keywords: ["pause", "hold", "breath mark"],
      execute: cb.openBreathFermataMenu,
    },
    {
      id: "add.fingering",
      label: "Fingering Menu",
      category: "Add",
      shortcut: "Shift+F",
      keywords: ["finger", "number", "1234"],
      execute: cb.openFingeringMenu,
    },
    {
      id: "add.articulation",
      label: "Articulation Menu",
      category: "Add",
      shortcut: "Shift+A",
      keywords: ["staccato", "accent", "tenuto", "marcato"],
      execute: cb.openArticulationMenu,
    },
    {
      id: "add.repeat",
      label: "Repeats / Tremolo Menu",
      category: "Add",
      shortcut: "Shift+R",
      keywords: ["volta", "da capo", "dal segno", "coda", "tremolo"],
      execute: cb.openRepeatsMenu,
    },
    ...activityActions,
    ...settingsActions,
    ...scoreActions,
  ];
}
