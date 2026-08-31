import type { DiffNode } from "../diff/semanticDiff";

/** Find the first leaf node whose path contains the given measure index. */
export function findNodeByMeasure(node: DiffNode, measureIndex: number): DiffNode | null {
  const partsMatch = node.path.match(/parts\[\d+\]\.measures\[(\d+)\]/);
  const globalMatch = node.path.match(/global\.measures\[(\d+)\]/);
  const match = partsMatch ?? globalMatch;
  const nodeIdx = match?.[1] != null ? Number(match[1]) : null;

  if (nodeIdx === measureIndex && node.type !== "unchanged") {
    if (!node.children || node.children.length === 0) return node;
  }

  if (node.children) {
    for (const child of node.children) {
      const found = findNodeByMeasure(child, measureIndex);
      if (found) return found;
    }
  }

  if (nodeIdx === measureIndex && node.type !== "unchanged") return node;
  return null;
}
