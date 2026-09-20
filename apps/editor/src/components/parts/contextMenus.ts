import type { LayoutContent, LayoutGroup, LayoutStaff, Part, PartDisplayInfo } from "@viritura/core";
import type { MenuItemDef } from "@viritura/ui";
import { type NodePath, getNodeAt } from "./treeOps";
import { SYMBOL_OPTIONS } from "./styles";
import { CHORD_SYMBOL_VISIBILITY_OPTIONS, type PartChordSymbolUpdate } from "./chordSymbolVisibility";

function getPartDisplayName(displayMap: Map<string, PartDisplayInfo>, partId: string): string {
  return displayMap.get(partId)?.displayName ?? partId;
}

export interface GroupContextMenuDeps {
  removeGroup: (path: NodePath) => void;
  updateGroupProp: (path: NodePath, prop: "symbol" | "label", value: string) => void;
  setEditingGroup: (key: string | null) => void;
  setEditingGroupLabel: (label: string) => void;
}

export function buildGroupContextMenuItems(
  node: LayoutGroup,
  path: NodePath,
  deps: GroupContextMenuDeps,
): MenuItemDef[] {
  const { removeGroup, updateGroupProp, setEditingGroup, setEditingGroupLabel } = deps;
  const pathKey = path.join("-");
  return [
    {
      label: "Rename",
      action: () => {
        setEditingGroup(pathKey);
        setEditingGroupLabel(node.label ?? "");
      },
    },
    {
      label: "Symbol",
      children: SYMBOL_OPTIONS.map((opt) => ({
        label: opt.label,
        action: () => updateGroupProp(path, "symbol", opt.value),
        disabled: node.symbol === opt.value,
      })),
    },
    { separator: true },
    { label: "Ungroup", action: () => removeGroup(path) },
  ];
}

export interface StaffContextMenuDeps {
  partIdToScoreIndex: Map<string, number>;
  onSelectScore: (i: number) => void;
  ungroupStaff: (path: NodePath) => void;
  sourceParts: readonly Part[];
  onPartUpdate?: (partId: string, updates: PartChordSymbolUpdate) => void;
  onAddDoubling?: (path: NodePath, instrumentId: string) => void;
  onRemoveDoubling?: (path: NodePath, sourceIndex: number) => void;
  onRemoveInstrument?: (partId: string) => void;
  /** The score currently shown in the Layouts panel. */
  selectedScoreIndex: number;
  /** True when the active score is a multi-staff conductor score (can shed a part). */
  activeScoreIsConductor: boolean;
  /** Remove the part from the active score's layout, keeping it in the document. */
  onRemoveInstrumentFromScore?: (scoreIndex: number, partId: string) => void;
  /** Open the Drum Kit editor for this part (only offered for percussion). */
  onEditDrumKit?: (partId: string) => void;
  /** True when the part is unpitched percussion (has a kit to edit). */
  isPercussionPartId?: (partId: string) => boolean;
  layoutContent: LayoutContent[];
  partDisplayMap: Map<string, PartDisplayInfo>;
  setDoublingStaffPath: (path: NodePath) => void;
}

function chordSymbolVisibilityMenu(
  node: LayoutStaff,
  sourceParts: readonly Part[],
  displayMap: Map<string, PartDisplayInfo>,
  update: StaffContextMenuDeps["onPartUpdate"],
): MenuItemDef {
  const sourceIds = [...new Set(node.sources.map((source) => source.part))];
  const sources = sourceIds.map((id) => {
    const part = sourceParts.find((source) => source.id === id);
    const current = part?.chordSymbolVisibility ?? "auto";
    return {
      label: `${displayMap.get(id)?.displayName ?? part?.name ?? id} (${id})`,
      disabled: !part || !update,
      children: part
        ? CHORD_SYMBOL_VISIBILITY_OPTIONS.map(({ label, value }) => ({
            label,
            action: update ? () => update(id, { chordSymbolVisibility: value }) : undefined,
            disabled: !update || current === value,
          }))
        : undefined,
    };
  });
  return {
    label: "Chord Symbols",
    disabled: !update || sources.length === 0 || sources.every((source) => source.disabled),
    children: sources.length === 1 ? sources[0]?.children : sources,
  };
}

export function buildStaffContextMenuItems(
  partId: string,
  path: NodePath,
  depth: number,
  deps: StaffContextMenuDeps,
): MenuItemDef[] {
  const {
    partIdToScoreIndex,
    onSelectScore,
    ungroupStaff,
    sourceParts,
    onPartUpdate,
    onAddDoubling,
    onRemoveDoubling,
    onRemoveInstrument,
    selectedScoreIndex,
    activeScoreIsConductor,
    onRemoveInstrumentFromScore,
    onEditDrumKit,
    isPercussionPartId,
    layoutContent,
    partDisplayMap,
    setDoublingStaffPath,
  } = deps;
  const items: MenuItemDef[] = [];
  const scoreIndex = partIdToScoreIndex.get(partId);
  if (scoreIndex !== undefined) {
    items.push({ label: "Select Part", action: () => onSelectScore(scoreIndex) });
  }
  if (onEditDrumKit && isPercussionPartId?.(partId)) {
    items.push({ label: "Edit Percussion Map", action: () => onEditDrumKit(partId) });
  }
  const node = getNodeAt(layoutContent, path);
  if (node?.type === "staff") {
    items.push(chordSymbolVisibilityMenu(node, sourceParts, partDisplayMap, onPartUpdate));
  }
  if (depth > 0) {
    items.push({ label: "Move to Root", action: () => ungroupStaff(path) });
  }
  if (onAddDoubling) {
    if (items.length > 0) items.push({ separator: true });
    items.push({ label: "Add Doubling", action: () => setDoublingStaffPath(path) });
  }
  if (onRemoveDoubling && node?.type === "staff" && (node as LayoutStaff).sources.length > 1) {
    const staffNode = node as LayoutStaff;
    items.push({
      label: "Remove Doubling",
      children: staffNode.sources.map((src, idx) => ({
        label: getPartDisplayName(partDisplayMap, src.part),
        action: () => onRemoveDoubling(path, idx),
      })),
    });
  }
  if (onRemoveInstrumentFromScore && activeScoreIsConductor && partId) {
    if (items.length > 0 && !items[items.length - 1]?.separator) items.push({ separator: true });
    items.push({
      label: "Remove from this Score",
      action: () => onRemoveInstrumentFromScore(selectedScoreIndex, partId),
    });
  }
  if (onRemoveInstrument && partId) {
    if (items.length > 0 && !items[items.length - 1]?.separator) items.push({ separator: true });
    items.push({ label: "Remove Instrument", action: () => onRemoveInstrument(partId) });
  }
  return items;
}
