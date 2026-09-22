/**
 * Menu-bar content: the declarative File/Edit/View/Help item trees.
 *
 * Kept beside the component rather than inside it so the `.tsx` file exports
 * components only, and so the item definitions stay readable as data.
 */

import type { MenuItemDef } from "@viritura/ui";
import type { Barline, Clef, RepeatStart, RepeatEnd, Ending } from "@viritura/core";

export interface SampleScore {
  readonly name: string;
  readonly file: string;
}

/** A single entry in the File → Open Recent submenu. */
export interface RecentMenuEntry {
  readonly id: string;
  /** Display label (file or folder name). */
  readonly label: string;
  /** Optional secondary label (e.g. score path inside a project). */
  readonly sublabel?: string;
}

export interface MenuBarCallbacks {
  readonly onNewScore?: () => void;
  readonly onOpenFile?: () => void;
  readonly onOpenProject?: () => void;
  /** Import a MusicXML, MXL, or Finale MUSX file (converted to MNX on load). */
  readonly onImport?: () => void;
  /** Show the Start Center launch dialog. */
  readonly onShowStartCenter?: () => void;
  /** Open a recent entry by id (matches `recentEntries[].id`). */
  readonly onSelectRecentEntry?: (id: string) => void;
  readonly onSave?: () => void;
  readonly onSaveAs?: () => void;
  readonly onSelectSampleScore?: (file: string) => void;
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
  readonly onCut?: () => void;
  readonly onCopy?: () => void;
  readonly onPaste?: () => void;
  /** Paste, merging pitches into the destination chords instead of replacing them. */
  readonly onPasteMerge?: () => void;
  readonly onDelete?: () => void;
  readonly onSelectAll?: () => void;
  readonly onZoomIn?: () => void;
  readonly onZoomOut?: () => void;
  readonly onResetZoom?: () => void;
  readonly onTranspose?: () => void;
  readonly onExplodeSelection?: () => void;
  readonly onReduceSelection?: () => void;
  readonly onSelectChordTopNote?: () => void;
  readonly onSelectChordBottomNote?: () => void;
  readonly onSplitOrchestralStaves?: () => void;
  readonly onSetTimeSignature?: (time: { count: number; unit: number; display?: "common" | "cut" }) => void;
  readonly onSetKeySignature?: (key: { fifths: number }) => void;
  readonly onSetRepeatStart?: (repeatStart: RepeatStart | null) => void;
  readonly onSetRepeatEnd?: (repeatEnd: RepeatEnd | null) => void;
  readonly onSetEnding?: (ending: Ending | null) => void;
  readonly onSetBarline?: (barline: Barline) => void;
  readonly onSetClef?: (clef: Clef) => void;
  readonly onShowHelp?: () => void;
  /** Open the external Viritura documentation site. */
  readonly onOpenDocs?: () => void;
  readonly onToggleSource?: () => void;
  readonly onPageSetup?: () => void;
  readonly onExportPdf?: () => void;
  readonly onExportSvg?: () => void;
  readonly onShare?: () => void;
  readonly onOpenPublish?: () => void;
}

export interface MenuBarState {
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
  readonly hasSelection?: boolean;
  readonly canTranspose?: boolean;
  readonly hasDocument?: boolean;
}

export interface TopLevelMenu {
  readonly label: string;
  readonly id: string;
  readonly items: MenuItemDef[];
}

const IS_MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
const MOD = IS_MAC ? "⌘" : "Ctrl+";

const SEPARATOR: MenuItemDef = { label: "separator", separator: true };

/** Recents shown in the File menu; capped to keep the submenu compact. */
const MAX_RECENT_ENTRIES = 10;

function fileItems(
  callbacks: MenuBarCallbacks,
  state: MenuBarState,
  sampleScores: readonly SampleScore[],
  recentEntries: readonly RecentMenuEntry[],
): MenuItemDef[] {
  const exampleScores: MenuItemDef[] = sampleScores.map((sample) => ({
    label: sample.name,
    action: () => callbacks.onSelectSampleScore?.(sample.file),
  }));

  // When there are no recents we still show the entry with a disabled
  // placeholder so it's discoverable on first launch.
  const recents: MenuItemDef[] =
    recentEntries.length === 0
      ? [{ label: "(no recent items)", disabled: true }]
      : recentEntries.slice(0, MAX_RECENT_ENTRIES).map((entry) => ({
          label: entry.sublabel ? `${entry.label} — ${entry.sublabel}` : entry.label,
          action: () => callbacks.onSelectRecentEntry?.(entry.id),
        }));

  return [
    { label: "New Project", action: callbacks.onNewScore },
    { label: "Open Project Folder", shortcut: `${MOD}O`, action: callbacks.onOpenProject },
    { label: "Open MNX Score", shortcut: `${MOD}⇧O`, action: callbacks.onOpenFile },
    { label: "Open Recent", children: recents },
    SEPARATOR,
    { label: "Import", action: callbacks.onImport },
    SEPARATOR,
    { label: "Start Center", action: callbacks.onShowStartCenter },
    SEPARATOR,
    { label: "Save", shortcut: `${MOD}S`, action: callbacks.onSave, disabled: !state.hasDocument },
    {
      label: "Save As",
      shortcut: IS_MAC ? "⇧⌘S" : "Ctrl+Shift+S",
      action: callbacks.onSaveAs,
      disabled: !state.hasDocument,
    },
    { label: "Share", action: callbacks.onShare, disabled: !state.hasDocument },
    ...(exampleScores.length > 0 ? [SEPARATOR, { label: "Example Scores", children: exampleScores }] : []),
    SEPARATOR,
    { label: "Publish", shortcut: `${MOD}P`, action: callbacks.onOpenPublish, disabled: !state.hasDocument },
  ];
}

function editItems(callbacks: MenuBarCallbacks, state: MenuBarState): MenuItemDef[] {
  return [
    { label: "Undo", shortcut: `${MOD}Z`, action: callbacks.onUndo, disabled: !callbacks.onUndo || !state.canUndo },
    {
      label: "Redo",
      shortcut: IS_MAC ? "⇧⌘Z" : "Ctrl+Y",
      action: callbacks.onRedo,
      disabled: !callbacks.onRedo || !state.canRedo,
    },
    SEPARATOR,
    { label: "Cut", shortcut: `${MOD}X`, action: callbacks.onCut, disabled: !state.hasSelection },
    { label: "Copy", shortcut: `${MOD}C`, action: callbacks.onCopy, disabled: !state.hasSelection },
    { label: "Paste", shortcut: `${MOD}V`, action: callbacks.onPaste, disabled: !callbacks.onPaste },
    {
      label: "Paste and Merge",
      shortcut: IS_MAC ? "⇧⌘V" : "Ctrl+Shift+V",
      action: callbacks.onPasteMerge,
      disabled: !callbacks.onPasteMerge,
    },
    { label: "Delete", shortcut: "Del", action: callbacks.onDelete, disabled: !state.hasSelection },
    SEPARATOR,
    { label: "Transpose Selection", action: callbacks.onTranspose, disabled: !state.canTranspose },
    {
      label: "Split Combined Orchestral Parts",
      action: callbacks.onSplitOrchestralStaves,
      disabled: !state.hasDocument,
    },
    SEPARATOR,
    {
      label: "Explode to Staves",
      action: callbacks.onExplodeSelection,
      disabled: !state.hasSelection,
    },
    { label: "Reduce to Staff", action: callbacks.onReduceSelection, disabled: !state.hasSelection },
    {
      label: "Select Top Note of Chords",
      action: callbacks.onSelectChordTopNote,
      disabled: !state.hasSelection,
    },
    {
      label: "Select Bottom Note of Chords",
      action: callbacks.onSelectChordBottomNote,
      disabled: !state.hasSelection,
    },
    SEPARATOR,
    { label: "Select All", shortcut: `${MOD}A`, action: callbacks.onSelectAll, disabled: !callbacks.onSelectAll },
  ];
}

function viewItems(callbacks: MenuBarCallbacks, state: MenuBarState): MenuItemDef[] {
  return [
    { label: "Zoom In", shortcut: `${MOD}+`, action: callbacks.onZoomIn, disabled: !callbacks.onZoomIn },
    { label: "Zoom Out", shortcut: `${MOD}−`, action: callbacks.onZoomOut, disabled: !callbacks.onZoomOut },
    { label: "Reset Zoom", shortcut: `${MOD}0`, action: callbacks.onResetZoom, disabled: !callbacks.onResetZoom },
    SEPARATOR,
    {
      label: "MNX Source",
      action: callbacks.onToggleSource,
      disabled: !state.hasDocument || !callbacks.onToggleSource,
    },
  ];
}

function helpItems(callbacks: MenuBarCallbacks): MenuItemDef[] {
  return [
    { label: "Keyboard Shortcuts", shortcut: "F1", action: callbacks.onShowHelp },
    { label: "Documentation", action: callbacks.onOpenDocs },
  ];
}

/** Build the full menu-bar tree for the current callbacks and state. */
export function buildMenuBarMenus(
  callbacks: MenuBarCallbacks,
  state: MenuBarState,
  sampleScores: readonly SampleScore[],
  recentEntries: readonly RecentMenuEntry[],
): TopLevelMenu[] {
  return [
    { label: "File", id: "file", items: fileItems(callbacks, state, sampleScores, recentEntries) },
    { label: "Edit", id: "edit", items: editItems(callbacks, state) },
    { label: "View", id: "view", items: viewItems(callbacks, state) },
    { label: "Help", id: "help", items: helpItems(callbacks) },
  ];
}
