import type { LayoutContent, LayoutStaff, LayoutGroup } from "@viritura/core";

// ─── Doubling layout helpers ──────────────────────────────────

/** Add a part source to the staff at the given path within layout content. */
export function addSourceToStaffAt(content: LayoutContent[], path: number[], partId: string): LayoutContent[] {
  return content.map((node, i) => {
    if (path.length === 1 && i === path[0]) {
      if (node.type === "staff") {
        return { ...node, sources: [...node.sources, { part: partId }] } as LayoutStaff;
      }
      return node;
    }
    if (path.length > 1 && i === path[0] && node.type === "group") {
      return { ...node, content: addSourceToStaffAt(node.content, path.slice(1), partId) } as LayoutGroup;
    }
    return node;
  });
}

/** Remove a source by index from the staff at the given path. */
export function removeSourceFromStaffAt(
  content: LayoutContent[],
  path: number[],
  sourceIndex: number,
): LayoutContent[] {
  return content.map((node, i) => {
    if (path.length === 1 && i === path[0]) {
      if (node.type === "staff") {
        return { ...node, sources: node.sources.filter((_, si) => si !== sourceIndex) } as LayoutStaff;
      }
      return node;
    }
    if (path.length > 1 && i === path[0] && node.type === "group") {
      return { ...node, content: removeSourceFromStaffAt(node.content, path.slice(1), sourceIndex) } as LayoutGroup;
    }
    return node;
  });
}

/** Get the staff node at a given path (searches the first layout that contains any content). */
export function getStaffNodeAt(layouts: { content: LayoutContent[] }[], path: number[]): LayoutStaff | undefined {
  for (const layout of layouts) {
    let current: LayoutContent[] = layout.content;
    for (let i = 0; i < path.length - 1; i++) {
      const node = current[path[i]!];
      if (!node || node.type !== "group") break;
      current = node.content;
    }
    const node = current[path[path.length - 1]!];
    if (node?.type === "staff") return node as LayoutStaff;
  }
  return undefined;
}

/** Collect all part IDs referenced in layout content. */
export function collectPartIds(content: LayoutContent[], ids: Set<string>): void {
  for (const node of content) {
    if (node.type === "staff") {
      for (const src of node.sources) {
        if (src.part) ids.add(src.part);
      }
    } else if (node.type === "group") {
      collectPartIds(node.content, ids);
    }
  }
}
