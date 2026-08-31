import type { LayoutContent, LayoutGroup, LayoutStaff, ScoreDefinition } from "@viritura/core";

/** A path through the layout tree. Each element indexes into a `content[]`. */
export type NodePath = number[];

// ─── Counts ─────────────────────────────────────────────────────

/** Count leaf staff nodes in a layout content tree. */
export function countStaves(content: LayoutContent[]): number {
  let count = 0;
  for (const node of content) {
    if (node.type === "staff") count++;
    else if (node.type === "group") count += countStaves((node as LayoutGroup).content);
  }
  return count;
}

// ─── Tree mutation ──────────────────────────────────────────────

export function cloneContent(content: LayoutContent[]): LayoutContent[] {
  return JSON.parse(JSON.stringify(content));
}

export function pathsEqual(a: NodePath, b: NodePath): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function isAncestorOf(a: NodePath, b: NodePath): boolean {
  if (a.length >= b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export function removeNodeAt(
  content: LayoutContent[],
  path: NodePath,
): { tree: LayoutContent[]; removed: LayoutContent } {
  const tree = cloneContent(content);
  let parent: LayoutContent[] = tree;
  for (let i = 0; i < path.length - 1; i++) {
    const node = parent[path[i]!];
    if (!node || node.type !== "group") throw new Error("Invalid path");
    parent = node.content;
  }
  const [removed] = parent.splice(path[path.length - 1]!, 1);
  return { tree, removed: removed! };
}

export function insertNodeAt(content: LayoutContent[], path: NodePath, node: LayoutContent): LayoutContent[] {
  const tree = cloneContent(content);
  let parent: LayoutContent[] = tree;
  for (let i = 0; i < path.length - 1; i++) {
    const p = parent[path[i]!];
    if (!p || p.type !== "group") throw new Error("Invalid path");
    parent = p.content;
  }
  parent.splice(path[path.length - 1]!, 0, node);
  return tree;
}

export function getNodeAt(content: LayoutContent[], path: NodePath): LayoutContent | undefined {
  let current: LayoutContent[] = content;
  for (let i = 0; i < path.length - 1; i++) {
    const node = current[path[i]!];
    if (!node || node.type !== "group") return undefined;
    current = node.content;
  }
  return current[path[path.length - 1]!];
}

// ─── Selection helpers ──────────────────────────────────────────

/** Build a flat list of all visible node paths in tree order. */
export function flattenVisiblePaths(
  nodes: LayoutContent[],
  basePath: NodePath,
  collapsedGroups: Set<string>,
): string[] {
  const result: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const path = [...basePath, i];
    const pathKey = path.join("-");
    result.push(pathKey);
    const node = nodes[i]!;
    if (node.type === "group" && !collapsedGroups.has(pathKey)) {
      result.push(...flattenVisiblePaths((node as LayoutGroup).content, path, collapsedGroups));
    }
  }
  return result;
}

/** Parse a path key back into a NodePath. */
export function parsePathKey(key: string): NodePath {
  return key.split("-").map(Number);
}

/** Check if all paths share the same parent. */
export function allSameParent(pathKeys: string[]): boolean {
  if (pathKeys.length < 2) return true;
  const firstParent = parsePathKey(pathKeys[0]!).slice(0, -1).join("-");
  return pathKeys.every((k) => parsePathKey(k).slice(0, -1).join("-") === firstParent);
}

/**
 * Drop any selected path that is a descendant of another selected path.
 *
 * Range-selection over an *expanded* group includes the group's own visible
 * children (see {@link flattenVisiblePaths}). Those children are already
 * carried by their selected ancestor, so treating them as independent
 * selections both breaks the sibling check (their parent differs from the
 * top-level selection) and would double-remove them during grouping. Pruning
 * to the top-most selected nodes yields the set the user actually means.
 */
export function pruneDescendantPaths(pathKeys: string[]): string[] {
  const paths = pathKeys.map(parsePathKey);
  return pathKeys.filter((_key, i) => !paths.some((other, j) => j !== i && isAncestorOf(other, paths[i]!)));
}

/** Visit every group node in the tree, reporting its path and child count. */
function walkGroups(nodes: LayoutContent[], basePath: NodePath, visit: (path: NodePath, childCount: number) => void) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.type !== "group") continue;
    const path = [...basePath, i];
    const children = (node as LayoutGroup).content;
    visit(path, children.length);
    walkGroups(children, path, visit);
  }
}

/**
 * Collapse fully-selected groups to the group itself.
 *
 * When every child of a group is selected, the user means "this whole group",
 * so the group's path replaces its children in the selection. Applied to a
 * fixpoint so nested groups roll up too. This turns "select all four horn
 * staves" (leaves living in two separate condensing groups) into "the two horn
 * groups" — which are siblings and therefore groupable.
 */
export function collapseSelectionToGroups(content: LayoutContent[], pathKeys: string[]): string[] {
  const selected = new Set(pathKeys);
  let changed = true;
  while (changed) {
    changed = false;
    walkGroups(content, [], (groupPath, childCount) => {
      if (childCount === 0) return;
      const groupKey = groupPath.join("-");
      if (selected.has(groupKey)) return;
      for (let i = 0; i < childCount; i++) {
        if (!selected.has([...groupPath, i].join("-"))) return;
      }
      for (let i = 0; i < childCount; i++) selected.delete([...groupPath, i].join("-"));
      selected.add(groupKey);
      changed = true;
    });
  }
  return Array.from(selected);
}

/**
 * Normalize a raw selection into the set of nodes a "Create Group" should act
 * on: drop children already carried by a selected ancestor, then roll any
 * fully-selected group up to the group itself. After this, a contiguous
 * multi-group selection reduces to sibling groups.
 */
export function normalizeGroupSelection(content: LayoutContent[], pathKeys: string[]): string[] {
  return collapseSelectionToGroups(content, pruneDescendantPaths(pathKeys));
}

// ─── Score / part lookups ───────────────────────────────────────

/** Resolve the full-score layout ID from a score definition, checking top-level and page-level. */
export function resolveFullScoreLayoutId(scoreDefinitions: ScoreDefinition[]): string | undefined {
  const fullScoreDef = scoreDefinitions[0];
  return fullScoreDef?.layout ?? fullScoreDef?.pages?.[0]?.systems?.[0]?.layout;
}

/** Find the first part id by depth-first walk. */
export function findFirstPartId(content: LayoutContent[]): string | null {
  for (const node of content) {
    if (node.type === "staff") {
      const partId = (node as LayoutStaff).sources?.[0]?.part;
      if (partId) return partId;
    } else if (node.type === "group") {
      const result = findFirstPartId((node as LayoutGroup).content);
      if (result) return result;
    }
  }
  return null;
}

/** Same as findFirstPartId but returns undefined instead of null. */
export function firstPartId(content: LayoutContent[]): string | undefined {
  for (const node of content) {
    if (node.type === "staff") return (node as LayoutStaff).sources?.[0]?.part;
    if (node.type === "group") {
      const id = firstPartId((node as LayoutGroup).content);
      if (id) return id;
    }
  }
  return undefined;
}
