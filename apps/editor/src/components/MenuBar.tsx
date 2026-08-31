import * as Menubar from "@radix-ui/react-menubar";
import type { MenuItemDef } from "@viritura/ui";
import type { Barline, Clef, RepeatStart, RepeatEnd, Ending } from "@viritura/core";
import styles from "./MenuBar.module.css";

interface SampleScore {
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
  /** Import a MusicXML/MXL file (converted to MNX on load). */
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
  readonly onDelete?: () => void;
  readonly onSelectAll?: () => void;
  readonly onZoomIn?: () => void;
  readonly onZoomOut?: () => void;
  readonly onResetZoom?: () => void;
  readonly onTranspose?: () => void;
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
  readonly onOpenPublish?: () => void;
}

export interface MenuBarState {
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
  readonly hasSelection?: boolean;
  readonly canTranspose?: boolean;
  readonly hasDocument?: boolean;
}

interface MenuBarProps {
  readonly callbacks: MenuBarCallbacks;
  readonly state?: MenuBarState;
  readonly sampleScores?: readonly SampleScore[];
  /** Recent projects + files for the File → Open Recent submenu. */
  readonly recentEntries?: readonly RecentMenuEntry[];
}

const IS_MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
const MOD = IS_MAC ? "⌘" : "Ctrl+";

/** Renders a single MenuItemDef as a Radix Menubar item, separator, or sub-menu. */
function RenderItem({ item }: { readonly item: MenuItemDef }) {
  if (item.separator) {
    return <Menubar.Separator className={styles.separator} />;
  }

  if (item.children && item.children.length > 0) {
    return (
      <Menubar.Sub>
        <Menubar.SubTrigger className={styles.menuItem}>
          <span>{item.label}</span>
          <span className={styles.submenuArrow}>&#x25B8;</span>
        </Menubar.SubTrigger>
        <Menubar.Portal>
          <Menubar.SubContent className={styles.submenu} sideOffset={2} alignOffset={-4}>
            {item.children.map((child, i) => (
              <RenderItem key={i} item={child} />
            ))}
          </Menubar.SubContent>
        </Menubar.Portal>
      </Menubar.Sub>
    );
  }

  return (
    <Menubar.Item className={styles.menuItem} disabled={item.disabled} onSelect={item.action}>
      <span>{item.label}</span>
      {item.shortcut && <span className={styles.shortcut}>{item.shortcut}</span>}
    </Menubar.Item>
  );
}

export function MenuBar({ callbacks, state = {}, sampleScores = [], recentEntries = [] }: MenuBarProps) {
  const exampleScoresSubmenu: MenuItemDef[] = sampleScores.map((s) => ({
    label: s.name,
    action: () => callbacks.onSelectSampleScore?.(s.file),
  }));

  // File → Open Recent submenu — built from the merged recents list (newest
  // first; capped at 10 to keep the menu compact). When empty we still show
  // the entry with a disabled placeholder so it's discoverable on first launch.
  const recentSubmenu: MenuItemDef[] =
    recentEntries.length === 0
      ? [{ label: "(no recent items)", disabled: true }]
      : recentEntries.slice(0, 10).map((entry) => ({
          label: entry.sublabel ? `${entry.label} — ${entry.sublabel}` : entry.label,
          action: () => callbacks.onSelectRecentEntry?.(entry.id),
        }));

  const fileItems: MenuItemDef[] = [
    { label: "New Project…", action: callbacks.onNewScore },
    { label: "Open Project Folder…", shortcut: `${MOD}O`, action: callbacks.onOpenProject },
    { label: "Open MNX Score…", shortcut: `${MOD}⇧O`, action: callbacks.onOpenFile },
    {
      label: "Open Recent",
      children: recentSubmenu,
    },
    { label: "separator", separator: true },
    { label: "Import…", action: callbacks.onImport },
    { label: "separator", separator: true },
    { label: "Start Center…", action: callbacks.onShowStartCenter },
    { label: "separator", separator: true },
    {
      label: "Save",
      shortcut: `${MOD}S`,
      action: callbacks.onSave,
      disabled: !state.hasDocument,
    },
    {
      label: "Save As…",
      shortcut: IS_MAC ? "⇧⌘S" : "Ctrl+Shift+S",
      action: callbacks.onSaveAs,
      disabled: !state.hasDocument,
    },
    ...(exampleScoresSubmenu.length > 0
      ? [
          { label: "separator", separator: true },
          {
            label: "Example Scores",
            children: exampleScoresSubmenu,
          } as MenuItemDef,
        ]
      : []),
    { label: "separator", separator: true },
    {
      label: "Publish…",
      shortcut: `${MOD}P`,
      action: callbacks.onOpenPublish,
      disabled: !state.hasDocument,
    },
  ];

  const editItems: MenuItemDef[] = [
    {
      label: "Undo",
      shortcut: `${MOD}Z`,
      action: callbacks.onUndo,
      disabled: !callbacks.onUndo || !state.canUndo,
    },
    {
      label: "Redo",
      shortcut: IS_MAC ? "⇧⌘Z" : "Ctrl+Y",
      action: callbacks.onRedo,
      disabled: !callbacks.onRedo || !state.canRedo,
    },
    { label: "separator", separator: true },
    {
      label: "Cut",
      shortcut: `${MOD}X`,
      action: callbacks.onCut,
      disabled: !state.hasSelection,
    },
    {
      label: "Copy",
      shortcut: `${MOD}C`,
      action: callbacks.onCopy,
      disabled: !state.hasSelection,
    },
    {
      label: "Paste",
      shortcut: `${MOD}V`,
      action: callbacks.onPaste,
      disabled: !callbacks.onPaste,
    },
    {
      label: "Delete",
      shortcut: "Del",
      action: callbacks.onDelete,
      disabled: !state.hasSelection,
    },
    { label: "separator", separator: true },
    {
      label: "Transpose Selection…",
      action: callbacks.onTranspose,
      disabled: !state.canTranspose,
    },
    {
      label: "Split Combined Orchestral Parts…",
      action: callbacks.onSplitOrchestralStaves,
      disabled: !state.hasDocument,
    },
    { label: "separator", separator: true },
    {
      label: "Select All",
      shortcut: `${MOD}A`,
      action: callbacks.onSelectAll,
      disabled: !callbacks.onSelectAll,
    },
  ];

  const viewItems: MenuItemDef[] = [
    {
      label: "Zoom In",
      shortcut: `${MOD}+`,
      action: callbacks.onZoomIn,
      disabled: !callbacks.onZoomIn,
    },
    {
      label: "Zoom Out",
      shortcut: `${MOD}−`,
      action: callbacks.onZoomOut,
      disabled: !callbacks.onZoomOut,
    },
    {
      label: "Reset Zoom",
      shortcut: `${MOD}0`,
      action: callbacks.onResetZoom,
      disabled: !callbacks.onResetZoom,
    },
    { label: "separator", separator: true },
    {
      label: "MNX Source",
      action: callbacks.onToggleSource,
      disabled: !state.hasDocument || !callbacks.onToggleSource,
    },
  ];

  const helpItems: MenuItemDef[] = [
    {
      label: "Keyboard Shortcuts",
      shortcut: "F1",
      action: callbacks.onShowHelp,
    },
    {
      label: "Documentation",
      action: callbacks.onOpenDocs,
    },
  ];

  const menus: { label: string; id: string; items: MenuItemDef[] }[] = [
    { label: "File", id: "file", items: fileItems },
    { label: "Edit", id: "edit", items: editItems },
    { label: "View", id: "view", items: viewItems },
    { label: "Help", id: "help", items: helpItems },
  ];

  return (
    <Menubar.Root className={styles.menuBar} aria-label="Menu bar">
      <span className={styles.appMark} aria-hidden="true">
        <img src="/favicon.svg" alt="" draggable={false} />
      </span>
      {menus.map((menu) => (
        <Menubar.Menu key={menu.id}>
          <Menubar.Trigger className={styles.trigger}>{menu.label}</Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Content className={styles.dropdown} align="start" sideOffset={2}>
              {menu.items.map((item, i) => (
                <RenderItem key={i} item={item} />
              ))}
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>
      ))}
    </Menubar.Root>
  );
}
