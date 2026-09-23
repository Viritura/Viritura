/**
 * Score context-menu content: the editing commands offered when right-clicking
 * the canvas.
 *
 * Built from the same `MenuBarCallbacks`/`MenuBarState` the menu bar consumes,
 * so a command cannot be enabled in one surface and disabled in the other.
 */

import type { MenuItemDef } from "@viritura/ui";
import type { MenuBarCallbacks, MenuBarState } from "./menuBarItems";
import type { SelectionMenuContext } from "./ScoreCanvas/types";
import { IS_MAC, MOD } from "./menuShortcutLabels";

const SEPARATOR: MenuItemDef = { label: "separator", separator: true };

/**
 * Drop separators that would render at the very top or bottom, or next to
 * another separator, once unavailable commands have been filtered out.
 */
function collapseSeparators(items: readonly MenuItemDef[]): MenuItemDef[] {
  const collapsed: MenuItemDef[] = [];
  for (const item of items) {
    if (item.separator) {
      if (collapsed.length === 0 || collapsed[collapsed.length - 1]?.separator) continue;
    }
    collapsed.push(item);
  }
  while (collapsed[collapsed.length - 1]?.separator) collapsed.pop();
  return collapsed;
}

export function buildSelectionContextMenuItems(
  callbacks: MenuBarCallbacks,
  state: MenuBarState,
  context: SelectionMenuContext,
): MenuItemDef[] {
  const hasSelection = context.hasSelection || Boolean(state.hasSelection);
  const canDistribute = hasSelection && Boolean(state.hasDocument);
  const items: MenuItemDef[] = [
    { label: "Cut", shortcut: `${MOD}X`, action: callbacks.onCut, disabled: !hasSelection },
    { label: "Copy", shortcut: `${MOD}C`, action: callbacks.onCopy, disabled: !hasSelection },
    { label: "Paste", shortcut: `${MOD}V`, action: callbacks.onPaste, disabled: !callbacks.onPaste },
    {
      label: "Paste and Merge",
      shortcut: IS_MAC ? "⇧⌘V" : "Ctrl+Shift+V",
      action: callbacks.onPasteMerge,
      disabled: !callbacks.onPasteMerge,
    },
    SEPARATOR,
    { label: "Delete", shortcut: "Del", action: callbacks.onDelete, disabled: !hasSelection },
    SEPARATOR,
    { label: "Explode to Staves", action: callbacks.onExplodeSelection, disabled: !canDistribute },
    { label: "Reduce to Staff", action: callbacks.onReduceSelection, disabled: !canDistribute },
    SEPARATOR,
    { label: "Select Top Note of Chords", action: callbacks.onSelectChordTopNote, disabled: !hasSelection },
    { label: "Select Bottom Note of Chords", action: callbacks.onSelectChordBottomNote, disabled: !hasSelection },
    SEPARATOR,
    { label: "Select All", shortcut: `${MOD}A`, action: callbacks.onSelectAll, disabled: !callbacks.onSelectAll },
  ];
  return collapseSeparators(items.filter((item) => item.separator || item.action !== undefined));
}
