import type { LayoutContent, LayoutGroup } from "@viritura/core";
import type { NodePath } from "./treeOps";

// ─── Types ──────────────────────────────────────────────────────

export interface BarCell {
  groupPath: NodePath;
  groupNode: LayoutGroup;
  color: string;
  position: "first" | "middle" | "last" | "only";
  gapAbove?: boolean;
}

export interface FlatRowData {
  type: "staff" | "collapsed-group" | "empty-group" | "group-editing";
  node: LayoutContent;
  path: NodePath;
  depth: number;
  barCells: (BarCell | null)[];
  gapAbove?: boolean;
}

export interface AncestorInfo {
  depth: number;
  path: NodePath;
  node: LayoutGroup;
}

// ─── Builders ───────────────────────────────────────────────────

export function computeMaxGroupDepth(content: LayoutContent[], depth = 0): number {
  let max = depth;
  for (const node of content) {
    if (node.type === "group") {
      max = Math.max(max, computeMaxGroupDepth((node as LayoutGroup).content, depth + 1));
    }
  }
  return max;
}

function getSymbolColor(node: LayoutGroup): string {
  // Unified palette: viridian bracket, muted plum brace, dim line.
  // Matches PublishView accent vocabulary (rgba(58,142,122)).
  return node.symbol === "brace"
    ? "rgba(186, 104, 152, 0.65)"
    : node.symbol === "noSymbol"
      ? "rgba(120, 120, 130, 0.45)"
      : "rgba(33, 94, 78, 0.62)";
}

function buildBarCells(ancestors: AncestorInfo[], maxGroupDepth: number): (BarCell | null)[] {
  const cells: (BarCell | null)[] = new Array(maxGroupDepth).fill(null);
  for (const ancestor of ancestors) {
    const col = maxGroupDepth - 1 - ancestor.depth;
    cells[col] = {
      groupPath: ancestor.path,
      groupNode: ancestor.node,
      color: getSymbolColor(ancestor.node),
      position: "middle",
    };
  }
  return cells;
}

export function flattenLayoutTree(
  content: LayoutContent[],
  basePath: NodePath,
  depth: number,
  ancestors: AncestorInfo[],
  collapsedGroups: Set<string>,
  editingGroup: string | null,
  maxGroupDepth: number,
): FlatRowData[] {
  const rows: FlatRowData[] = [];
  for (let i = 0; i < content.length; i++) {
    const node = content[i]!;
    const path = [...basePath, i];
    const pathKey = path.join("-");
    if (node.type === "group") {
      const group = node as LayoutGroup;
      const currentAncestors = [...ancestors, { depth, path, node: group }];
      if (collapsedGroups.has(pathKey)) {
        rows.push({
          type: "collapsed-group",
          node: group,
          path,
          depth,
          barCells: buildBarCells(currentAncestors, maxGroupDepth),
        });
      } else if (group.content.length === 0) {
        rows.push({
          type: "empty-group",
          node: group,
          path,
          depth,
          barCells: buildBarCells(currentAncestors, maxGroupDepth),
        });
      } else {
        if (editingGroup === pathKey) {
          rows.push({
            type: "group-editing",
            node: group,
            path,
            depth,
            barCells: buildBarCells(currentAncestors, maxGroupDepth),
          });
        }
        rows.push(
          ...flattenLayoutTree(
            group.content,
            path,
            depth + 1,
            currentAncestors,
            collapsedGroups,
            editingGroup,
            maxGroupDepth,
          ),
        );
      }
    } else {
      rows.push({ type: "staff", node, path, depth, barCells: buildBarCells(ancestors, maxGroupDepth) });
    }
  }
  return rows;
}

export function assignBarPositions(rows: FlatRowData[]): void {
  const groupRanges = new Map<string, { first: number; last: number }>();
  for (let i = 0; i < rows.length; i++) {
    for (const cell of rows[i]!.barCells) {
      if (!cell) continue;
      const key = cell.groupPath.join("-");
      const existing = groupRanges.get(key);
      if (!existing) groupRanges.set(key, { first: i, last: i });
      else existing.last = i;
    }
  }
  for (const [key, range] of groupRanges) {
    for (let i = range.first; i <= range.last; i++) {
      for (const cell of rows[i]!.barCells) {
        if (!cell || cell.groupPath.join("-") !== key) continue;
        if (range.first === range.last) cell.position = "only";
        else if (i === range.first) cell.position = "first";
        else if (i === range.last) cell.position = "last";
      }
    }
  }
}

export function assignGroupGaps(rows: FlatRowData[]): void {
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!;
    const curr = rows[i]!;
    let hasAnyGap = false;
    for (let col = 0; col < curr.barCells.length; col++) {
      const prevCell = prev.barCells[col];
      const currCell = curr.barCells[col];
      if (
        prevCell &&
        currCell &&
        (prevCell.position === "last" || prevCell.position === "only") &&
        (currCell.position === "first" || currCell.position === "only")
      ) {
        currCell.gapAbove = true;
        hasAnyGap = true;
      }
    }
    if (hasAnyGap) curr.gapAbove = true;
  }
}
