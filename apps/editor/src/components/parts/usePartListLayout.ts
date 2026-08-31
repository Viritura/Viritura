import { useCallback, useMemo, useState } from "react";
import {
  type LayoutContent,
  type LayoutDefinition,
  type LayoutGroup,
  type LayoutStaff,
  type Part,
  type Score,
  type ScoreDefinition,
  type PartDisplayInfo,
  resolvePartDisplayNames,
} from "@viritura/core";
import {
  type NodePath,
  cloneContent,
  countStaves,
  findFirstPartId,
  flattenVisiblePaths,
  getNodeAt,
  insertNodeAt,
  isAncestorOf,
  parsePathKey,
  pathsEqual,
  normalizeGroupSelection,
  removeNodeAt,
  resolveFullScoreLayoutId,
  allSameParent,
} from "./treeOps";
import {
  assignBarPositions,
  assignGroupGaps,
  computeMaxGroupDepth,
  flattenLayoutTree,
  type FlatRowData,
} from "./treeFlatten";

export interface DragState {
  path: NodePath;
}
export interface DropTarget {
  path: NodePath;
  position: "before" | "after" | "inside";
}

export interface UsePartListLayoutArgs {
  score: Score | null | undefined;
  scoreDefinitions: readonly ScoreDefinition[];
  selectedScoreIndex: number;
  collapsedGroups: Set<string>;
  editingGroup: string | null;
  onLayoutChange?: (layouts: LayoutDefinition[]) => void;
}

export interface UsePartListLayoutResult {
  // derived layout
  fullScoreLayoutId: string | undefined;
  activeLayoutId: string | undefined;
  layoutContent: LayoutContent[];
  maxGroupDepth: number;
  activeStaffCount: number;
  flatRows: FlatRowData[];
  partDisplayMap: Map<string, PartDisplayInfo>;
  partIdToScoreIndex: Map<string, number>;
  visibleScores: { index: number; sd: ScoreDefinition }[];
  staffCountByScoreIndex: Map<number, number>;
  partsSectionStart: number;
  // mutations
  commitLayoutChange: (newContent: LayoutContent[]) => void;
  removeGroup: (path: NodePath) => void;
  updateGroupProp: (path: NodePath, prop: "symbol" | "label", value: string) => void;
  ungroupStaff: (path: NodePath) => void;
  createGroupFromSelection: (selectedPaths: Set<string>, onDone: () => void) => void;
  // drag/drop state + handlers
  dragState: DragState | null;
  dropTarget: DropTarget | null;
  setDropTarget: (v: DropTarget | null) => void;
  handleDragStart: (path: NodePath) => void;
  handleDragOver: (e: React.DragEvent, targetPath: NodePath, targetType: "staff" | "group") => void;
  handleDrop: (e: React.DragEvent) => void;
  handleDragEnd: () => void;
}

function buildPartDisplayMap(
  parts: readonly Pick<Part, "id" | "name" | "shortName" | "transposition">[],
): Map<string, PartDisplayInfo> {
  const map = new Map<string, PartDisplayInfo>();
  const infos = resolvePartDisplayNames(parts);
  for (let i = 0; i < parts.length; i++) {
    const partId = parts[i]!.id;
    if (partId) map.set(partId, infos[i]!);
  }
  return map;
}

function adjustDropPath(dragPath: NodePath, target: NodePath): NodePath {
  const adjusted = [...target];
  if (dragPath.length !== adjusted.length) return adjusted;
  const commonLen = dragPath.length - 1;
  const sameParent = dragPath.slice(0, commonLen).every((v, i) => v === adjusted[i]);
  if (!sameParent) return adjusted;
  const dragIdx = dragPath[commonLen]!;
  const targetIdx = adjusted[commonLen]!;
  if (dragIdx < targetIdx) adjusted[commonLen] = targetIdx - 1;
  return adjusted;
}

export function usePartListLayout({
  score,
  scoreDefinitions,
  selectedScoreIndex,
  collapsedGroups,
  editingGroup,
  onLayoutChange,
}: UsePartListLayoutArgs): UsePartListLayoutResult {
  const fullScoreLayoutId = useMemo(() => resolveFullScoreLayoutId([...scoreDefinitions]), [scoreDefinitions]);

  const fullScoreLayout = useMemo(() => {
    if (!score || !fullScoreLayoutId) return undefined;
    return (score.layouts ?? []).find((l) => l.id === fullScoreLayoutId);
  }, [score, fullScoreLayoutId]);

  const activeLayoutId = useMemo(() => {
    const sd = scoreDefinitions[selectedScoreIndex];
    if (!sd) return fullScoreLayoutId;
    return sd.layout ?? sd.pages?.[0]?.systems?.[0]?.layout ?? fullScoreLayoutId;
  }, [scoreDefinitions, selectedScoreIndex, fullScoreLayoutId]);

  const activeLayout = useMemo(() => {
    if (!score || !activeLayoutId) return undefined;
    return (score.layouts ?? []).find((l) => l.id === activeLayoutId);
  }, [score, activeLayoutId]);

  const layoutContent = useMemo(
    () => activeLayout?.content ?? fullScoreLayout?.content ?? [],
    [activeLayout, fullScoreLayout],
  );

  const maxGroupDepth = useMemo(() => computeMaxGroupDepth(layoutContent), [layoutContent]);
  const activeStaffCount = useMemo(() => countStaves(layoutContent), [layoutContent]);

  const flatRows = useMemo(() => {
    if (!score || layoutContent.length === 0) return [];
    const rows = flattenLayoutTree(layoutContent, [], 0, [], collapsedGroups, editingGroup, maxGroupDepth);
    assignBarPositions(rows);
    assignGroupGaps(rows);
    return rows;
  }, [layoutContent, collapsedGroups, editingGroup, maxGroupDepth, score]);

  const partDisplayMap = useMemo(() => {
    if (!score) return new Map<string, PartDisplayInfo>();
    return buildPartDisplayMap(score.parts);
  }, [score]);

  const partIdToScoreIndex = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 1; i < scoreDefinitions.length; i++) {
      const sd = scoreDefinitions[i]!;
      const partLayout = (score?.layouts ?? []).find((l) => l.id === sd.layout);
      if (partLayout) {
        const partId = findFirstPartId(partLayout.content);
        if (partId) map.set(partId, i);
      }
    }
    return map;
  }, [score, scoreDefinitions]);

  const visibleScores = useMemo(() => {
    const entries: { index: number; sd: ScoreDefinition }[] = [];
    for (let i = 0; i < scoreDefinitions.length; i++) {
      entries.push({ index: i, sd: scoreDefinitions[i]! });
    }
    return entries;
  }, [scoreDefinitions]);

  const staffCountByScoreIndex = useMemo(() => {
    const map = new Map<number, number>();
    if (!score) return map;
    const layouts = score.layouts ?? [];
    for (const { index, sd } of visibleScores) {
      const layoutId = sd.layout ?? sd.pages?.[0]?.systems?.[0]?.layout ?? fullScoreLayoutId;
      const layout = layoutId ? layouts.find((l) => l.id === layoutId) : undefined;
      map.set(index, countStaves(layout?.content ?? []));
    }
    return map;
  }, [score, visibleScores, fullScoreLayoutId]);

  const partsSectionStart = useMemo(() => {
    let sawMulti = false;
    for (let pos = 0; pos < visibleScores.length; pos++) {
      const idx = visibleScores[pos]!.index;
      const count = staffCountByScoreIndex.get(idx) ?? 0;
      if (count > 1) sawMulti = true;
      else if (sawMulti) return pos;
    }
    return -1;
  }, [visibleScores, staffCountByScoreIndex]);

  // ── Mutations ──
  const commitLayoutChange = useCallback(
    (newContent: LayoutContent[]) => {
      const layoutId = activeLayoutId ?? fullScoreLayoutId;
      if (!score || !layoutId || !onLayoutChange) return;
      const newLayouts = (score.layouts ?? []).map((l) => (l.id === layoutId ? { ...l, content: newContent } : l));
      onLayoutChange(newLayouts);
    },
    [score, activeLayoutId, fullScoreLayoutId, onLayoutChange],
  );

  const removeGroup = useCallback(
    (path: NodePath) => {
      const node = getNodeAt(layoutContent, path);
      if (!node || node.type !== "group") return;
      const tree = cloneContent(layoutContent);
      let parent: LayoutContent[] = tree;
      for (let i = 0; i < path.length - 1; i++) {
        const p = parent[path[i]!];
        if (!p || p.type !== "group") return;
        parent = p.content;
      }
      const idx = path[path.length - 1]!;
      const group = parent[idx] as LayoutGroup;
      parent.splice(idx, 1, ...group.content);
      commitLayoutChange(tree);
    },
    [layoutContent, commitLayoutChange],
  );

  const updateGroupProp = useCallback(
    (path: NodePath, prop: "symbol" | "label", value: string) => {
      const tree = cloneContent(layoutContent);
      let parent: LayoutContent[] = tree;
      for (let i = 0; i < path.length - 1; i++) {
        const p = parent[path[i]!];
        if (!p || p.type !== "group") return;
        parent = p.content;
      }
      const node = parent[path[path.length - 1]!];
      if (node && node.type === "group") {
        if (prop === "symbol") node.symbol = value;
        else node.label = value;
      }
      commitLayoutChange(tree);
    },
    [layoutContent, commitLayoutChange],
  );

  const ungroupStaff = useCallback(
    (path: NodePath) => {
      if (path.length < 2) return;
      const { tree, removed } = removeNodeAt(layoutContent, path);
      const parentPath = path.slice(0, -1);
      let parentContainer: LayoutContent[] = tree;
      for (let i = 0; i < parentPath.length - 1; i++) {
        const node = parentContainer[parentPath[i]!];
        if (node?.type === "group") parentContainer = (node as LayoutGroup).content;
      }
      const parentIndex = parentPath[parentPath.length - 1]!;
      parentContainer.splice(parentIndex + 1, 0, removed);
      commitLayoutChange(tree);
    },
    [layoutContent, commitLayoutChange],
  );

  const createGroupFromSelection = useCallback(
    (selectedPaths: Set<string>, onDone: () => void) => {
      // Normalize the raw selection: drop children carried by a selected
      // ancestor, then roll fully-selected groups up to the group itself. A
      // contiguous run that fully covers several adjacent groups thus reduces to
      // those top-level sibling groups, which wrap into one new bracket while the
      // existing groups are preserved as nested sub-brackets.
      const keys = normalizeGroupSelection(layoutContent, Array.from(selectedPaths));
      if (keys.length < 2) return;
      if (!allSameParent(keys)) return;
      const paths = keys.map(parsePathKey).sort((a, b) => b[b.length - 1]! - a[a.length - 1]!);
      const parentPath = paths[0]!.slice(0, -1);
      const tree = cloneContent(layoutContent);
      const removed: LayoutContent[] = [];
      for (const p of paths) {
        let parent: LayoutContent[] = tree;
        for (let i = 0; i < p.length - 1; i++) {
          const node = parent[p[i]!];
          if (!node || node.type !== "group") return;
          parent = (node as LayoutGroup).content;
        }
        removed.push(parent.splice(p[p.length - 1]!, 1)[0]!);
      }
      removed.reverse();
      const newGroup: LayoutGroup = { type: "group", symbol: "bracket", label: "", content: removed };
      const insertIdx = Math.min(...paths.map((p) => p[p.length - 1]!));
      let parent: LayoutContent[] = tree;
      for (const idx of parentPath) {
        const node = parent[idx];
        if (!node || node.type !== "group") return;
        parent = (node as LayoutGroup).content;
      }
      parent.splice(insertIdx, 0, newGroup);
      commitLayoutChange(tree);
      onDone();
    },
    [layoutContent, commitLayoutChange],
  );

  // ── Drag/drop ──
  const dnd = useLayoutDnd(layoutContent, commitLayoutChange);

  return {
    fullScoreLayoutId,
    activeLayoutId,
    layoutContent,
    maxGroupDepth,
    activeStaffCount,
    flatRows,
    partDisplayMap,
    partIdToScoreIndex,
    visibleScores,
    staffCountByScoreIndex,
    partsSectionStart,
    commitLayoutChange,
    removeGroup,
    updateGroupProp,
    ungroupStaff,
    createGroupFromSelection,
    dragState: dnd.dragState,
    dropTarget: dnd.dropTarget,
    setDropTarget: dnd.setDropTarget,
    handleDragStart: dnd.handleDragStart,
    handleDragOver: dnd.handleDragOver,
    handleDrop: dnd.handleDrop,
    handleDragEnd: dnd.handleDragEnd,
  };
}

function getNodePartIds(layoutContent: LayoutContent[], pathKey: string): string[] {
  const path = parsePathKey(pathKey);
  const node = getNodeAt(layoutContent, path);
  if (!node || node.type !== "staff") return [];
  const ids: string[] = [];
  for (const src of (node as LayoutStaff).sources) {
    if (src.part && !ids.includes(src.part)) ids.push(src.part);
  }
  return ids;
}

function useLayoutDnd(layoutContent: LayoutContent[], commitLayoutChange: (next: LayoutContent[]) => void) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const handleDragStart = useCallback((path: NodePath) => {
    setDragState({ path });
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, targetPath: NodePath, targetType: "staff" | "group") => {
      e.preventDefault();
      e.stopPropagation();
      if (!dragState) return;
      if (pathsEqual(dragState.path, targetPath)) return;
      if (isAncestorOf(dragState.path, targetPath)) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const height = rect.height;
      let position: "before" | "after" | "inside";
      if (targetType === "group") {
        if (y < height * 0.25) position = "before";
        else if (y > height * 0.75) position = "after";
        else position = "inside";
      } else {
        position = y < height / 2 ? "before" : "after";
      }
      setDropTarget({ path: targetPath, position });
    },
    [dragState],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!dragState || !dropTarget) {
        setDragState(null);
        setDropTarget(null);
        return;
      }
      const { tree, removed } = removeNodeAt(layoutContent, dragState.path);
      const targetPath = adjustDropPath(dragState.path, dropTarget.path);
      let newTree: LayoutContent[];
      if (dropTarget.position === "inside") {
        const groupNode = getNodeAt(tree, targetPath);
        if (groupNode && groupNode.type === "group") {
          newTree = insertNodeAt(tree, [...targetPath, groupNode.content.length], removed);
        } else {
          newTree = tree;
        }
      } else {
        const insertIdx =
          dropTarget.position === "after" ? targetPath[targetPath.length - 1]! + 1 : targetPath[targetPath.length - 1]!;
        newTree = insertNodeAt(tree, [...targetPath.slice(0, -1), insertIdx], removed);
      }
      commitLayoutChange(newTree);
      setDragState(null);
      setDropTarget(null);
    },
    [layoutContent, dragState, dropTarget, commitLayoutChange],
  );

  const handleDragEnd = useCallback(() => {
    setDragState(null);
    setDropTarget(null);
  }, []);

  return { dragState, dropTarget, setDropTarget, handleDragStart, handleDragOver, handleDrop, handleDragEnd };
}

export function collectSelectedPartIds(layoutContent: LayoutContent[], selectedPaths: Set<string>): string[] {
  const partIds: string[] = [];
  for (const pathKey of selectedPaths) {
    for (const id of getNodePartIds(layoutContent, pathKey)) {
      if (!partIds.includes(id)) partIds.push(id);
    }
  }
  return partIds;
}

export function rangeSelect(
  layoutContent: LayoutContent[],
  collapsedGroups: Set<string>,
  anchorKey: string,
  currentKey: string,
): Set<string> | null {
  const visible = flattenVisiblePaths(layoutContent, [], collapsedGroups);
  const anchorIdx = visible.indexOf(anchorKey);
  const currentIdx = visible.indexOf(currentKey);
  if (anchorIdx === -1 || currentIdx === -1) return null;
  const start = Math.min(anchorIdx, currentIdx);
  const end = Math.max(anchorIdx, currentIdx);
  return new Set(visible.slice(start, end + 1));
}
