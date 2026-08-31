import { useCallback } from "react";
import type { LayoutContent, LayoutGroup, PartDisplayInfo } from "@viritura/core";
import type { ContextMenuState, MenuItemDef } from "@viritura/ui";
import { type NodePath } from "./treeOps";
import { buildGroupContextMenuItems, buildStaffContextMenuItems } from "./contextMenus";

export interface UsePartListContextMenusArgs {
  selectedPaths: Set<string>;
  buildSelectionMenuItems: () => MenuItemDef[];
  setContextMenu: (state: ContextMenuState | null) => void;
  removeGroup: (path: NodePath) => void;
  updateGroupProp: (path: NodePath, prop: "symbol" | "label", value: string) => void;
  setEditingGroup: (key: string | null) => void;
  setEditingGroupLabel: (label: string) => void;
  partIdToScoreIndex: Map<string, number>;
  onSelectScore: (i: number) => void;
  ungroupStaff: (path: NodePath) => void;
  onAddDoubling?: (path: NodePath, instrumentId: string) => void;
  onRemoveDoubling?: (path: NodePath, sourceIndex: number) => void;
  onRemoveInstrument?: (partId: string) => void;
  selectedScoreIndex: number;
  activeScoreIsConductor: boolean;
  onRemoveInstrumentFromScore?: (scoreIndex: number, partId: string) => void;
  onEditDrumKit?: (partId: string) => void;
  isPercussionPartId?: (partId: string) => boolean;
  layoutContent: LayoutContent[];
  partDisplayMap: Map<string, PartDisplayInfo>;
  setDoublingStaffPath: (path: NodePath) => void;
}

export interface UsePartListContextMenusResult {
  openGroupContextMenu: (e: React.MouseEvent, node: LayoutGroup, path: NodePath) => void;
  openStaffContextMenu: (e: React.MouseEvent, partId: string, path: NodePath, depth: number) => void;
}

export function usePartListContextMenus(args: UsePartListContextMenusArgs): UsePartListContextMenusResult {
  const {
    selectedPaths,
    buildSelectionMenuItems,
    setContextMenu,
    removeGroup,
    updateGroupProp,
    setEditingGroup,
    setEditingGroupLabel,
    partIdToScoreIndex,
    onSelectScore,
    ungroupStaff,
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
  } = args;

  const handleSelectionMenu = useCallback(
    (e: React.MouseEvent, pathKey: string): boolean => {
      if (selectedPaths.size >= 2 && selectedPaths.has(pathKey)) {
        const items = buildSelectionMenuItems();
        if (items.length > 0) {
          setContextMenu({ x: e.clientX, y: e.clientY, items });
          return true;
        }
      }
      return false;
    },
    [selectedPaths, buildSelectionMenuItems, setContextMenu],
  );

  const openGroupContextMenu = useCallback(
    (e: React.MouseEvent, node: LayoutGroup, path: NodePath) => {
      e.preventDefault();
      e.stopPropagation();
      if (handleSelectionMenu(e, path.join("-"))) return;
      const items = buildGroupContextMenuItems(node, path, {
        removeGroup,
        updateGroupProp,
        setEditingGroup,
        setEditingGroupLabel,
      });
      setContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    [handleSelectionMenu, removeGroup, updateGroupProp, setEditingGroup, setEditingGroupLabel, setContextMenu],
  );

  const openStaffContextMenu = useCallback(
    (e: React.MouseEvent, partId: string, path: NodePath, depth: number) => {
      e.preventDefault();
      e.stopPropagation();
      if (handleSelectionMenu(e, path.join("-"))) return;
      const items = buildStaffContextMenuItems(partId, path, depth, {
        partIdToScoreIndex,
        onSelectScore,
        ungroupStaff,
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
      });
      if (items.length > 0) {
        setContextMenu({ x: e.clientX, y: e.clientY, items });
      }
    },
    [
      handleSelectionMenu,
      partIdToScoreIndex,
      onSelectScore,
      ungroupStaff,
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
      setContextMenu,
    ],
  );

  return { openGroupContextMenu, openStaffContextMenu };
}
