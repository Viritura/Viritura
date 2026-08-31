import { useCallback, useEffect, useRef, useState } from "react";
import type { LayoutContent } from "@viritura/core";
import type { MenuItemDef } from "@viritura/ui";
import { allSameParent, normalizeGroupSelection, type NodePath } from "./treeOps";
import { collectSelectedPartIds, rangeSelect } from "./usePartListLayout";

export interface UsePartListSelectionArgs {
  layoutContent: LayoutContent[];
  collapsedGroups: Set<string>;
  hasScore: boolean;
  onSelectedPartsChange?: (partIds: string[]) => void;
  createGroupFromSelectionRaw: (selectedPaths: Set<string>, onDone: () => void) => void;
}

export interface UsePartListSelectionResult {
  selectedPaths: Set<string>;
  setSelectedPaths: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectionAnchor: string | null;
  setSelectionAnchor: React.Dispatch<React.SetStateAction<string | null>>;
  filterModeRef: React.MutableRefObject<boolean>;
  handleNodeClick: (e: React.MouseEvent, path: NodePath) => void;
  createGroupFromSelection: () => void;
  buildSelectionMenuItems: () => MenuItemDef[];
}

export function usePartListSelection({
  layoutContent,
  collapsedGroups,
  hasScore,
  onSelectedPartsChange,
  createGroupFromSelectionRaw,
}: UsePartListSelectionArgs): UsePartListSelectionResult {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const filterModeRef = useRef(false);

  const handleNodeClick = useCallback(
    (e: React.MouseEvent, path: NodePath) => {
      const pathKey = path.join("-");
      if (e.shiftKey && selectionAnchor) {
        filterModeRef.current = true;
        const next = rangeSelect(layoutContent, collapsedGroups, selectionAnchor, pathKey);
        if (next) setSelectedPaths(next);
      } else if (e.ctrlKey || e.metaKey) {
        filterModeRef.current = true;
        const next = new Set(selectedPaths);
        if (next.has(pathKey)) next.delete(pathKey);
        else next.add(pathKey);
        setSelectedPaths(next);
        if (!selectionAnchor) setSelectionAnchor(pathKey);
      } else {
        filterModeRef.current = false;
        setSelectedPaths(new Set([pathKey]));
        setSelectionAnchor(pathKey);
      }
    },
    [selectionAnchor, selectedPaths, layoutContent, collapsedGroups],
  );

  const createGroupFromSelection = useCallback(() => {
    createGroupFromSelectionRaw(selectedPaths, () => {
      setSelectedPaths(new Set());
      setSelectionAnchor(null);
    });
  }, [createGroupFromSelectionRaw, selectedPaths]);

  useEffect(() => {
    if (!onSelectedPartsChange || !hasScore) return;
    if (selectedPaths.size === 0 || !filterModeRef.current) {
      onSelectedPartsChange([]);
      return;
    }
    onSelectedPartsChange(collectSelectedPartIds(layoutContent, selectedPaths));
  }, [selectedPaths, layoutContent, hasScore, onSelectedPartsChange]);

  const buildSelectionMenuItems = useCallback((): MenuItemDef[] => {
    // Normalize first: drop children carried by a selected ancestor, and roll
    // fully-selected groups up to the group itself, so selecting all members of
    // adjacent groups groups those groups rather than their mixed-parent leaves.
    const keys = normalizeGroupSelection(layoutContent, Array.from(selectedPaths));
    if (keys.length < 2) return [];
    if (!allSameParent(keys)) return [{ label: "Create Group (must be siblings)", disabled: true }];
    return [{ label: `Create Group (${keys.length} items)`, action: createGroupFromSelection }];
  }, [selectedPaths, layoutContent, createGroupFromSelection]);

  return {
    selectedPaths,
    setSelectedPaths,
    selectionAnchor,
    setSelectionAnchor,
    filterModeRef,
    handleNodeClick,
    createGroupFromSelection,
    buildSelectionMenuItems,
  };
}
