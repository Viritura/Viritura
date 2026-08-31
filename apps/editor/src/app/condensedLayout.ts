import type { LayoutContent, LayoutStaff, LayoutGroup, LayoutSource, LayoutDefinition, Part } from "@viritura/core";

// ─── Condensed layout auto-generation ──────────────

/**
 * Build a condensed layout from a full-score layout.
 * Pairs instruments by matching part names (e.g., "Flute 1" + "Flute 2" → one staff).
 * Solo instruments and multi-staff instruments keep their own staves.
 */
export function buildCondensedLayoutContent(fullContent: LayoutContent[], parts: Part[]): LayoutContent[] {
  const partMap = new Map<string, Part>();
  for (const p of parts) {
    if (p.id) partMap.set(p.id, p);
  }
  const result: LayoutContent[] = [];

  for (const node of fullContent) {
    if (node.type === "group") {
      // Process group: try to pair staves within the group
      const condensedGroup = condenseGroupContent(node, partMap);
      result.push(condensedGroup);
    } else {
      // Single staff — keep as-is
      result.push(node);
    }
  }
  // Ensure excluded instruments are not condensed (handles stale saved layouts)
  return uncondenseExcludedInstruments(result, partMap);
}

/** Strip trailing numbers and whitespace to get the instrument base name. */
function instrumentBaseName(name: string): string {
  return name.replace(/\s*(?:\d+|[IVX]+)\s*$/i, "").trim();
}

/** Instruments that should not be condensed (each section keeps its own staff). */
const NO_CONDENSE_INSTRUMENTS = new Set([
  "violin",
  "viola",
  "cello",
  "violoncello",
  "contrabass",
  "double bass",
  "bass",
  "vln",
  "vla",
  "vlc",
  "vc",
  "cb",
  "db",
]);

/** Check if an instrument base name should be excluded from condensing. */
function shouldSkipCondensing(baseName: string): boolean {
  return NO_CONDENSE_INSTRUMENTS.has(baseName.toLowerCase());
}

/** Split any condensed staves whose instruments should not be condensed. */
function uncondenseExcludedInstruments(content: LayoutContent[], partMap: Map<string, Part>): LayoutContent[] {
  return content.flatMap((item): LayoutContent[] => {
    if (item.type === "group") {
      return [{ ...item, content: uncondenseExcludedInstruments(item.content, partMap) }];
    }
    if (item.type === "staff" && item.sources.length > 1) {
      const hasExcluded = item.sources.some((s) => {
        const part = partMap.get(s.part);
        return part && shouldSkipCondensing(instrumentBaseName(part.name));
      });
      if (hasExcluded) {
        return item.sources.map((src) => ({
          type: "staff" as const,
          sources: [src],
          ...(item.labelref ? { labelref: item.labelref } : {}),
        }));
      }
    }
    return [item];
  });
}

/** Find an existing layout with identical content, or return undefined. */
function findDuplicateLayout(layouts: LayoutDefinition[], content: LayoutContent[]): string | undefined {
  const contentJson = JSON.stringify(content);
  for (const layout of layouts) {
    if (JSON.stringify(layout.content) === contentJson) {
      return layout.id;
    }
  }
  return undefined;
}

/** Add a layout, deduplicating against existing layouts. Returns the layout ID. */
export function addOrReuseLayout(layouts: LayoutDefinition[], id: string, content: LayoutContent[]): string {
  const existing = findDuplicateLayout(layouts, content);
  if (existing) return existing;
  layouts.push({ id, content });
  return id;
}

/** Process a group node: pair same-instrument staves into multi-source staves. */
function condenseGroupContent(group: LayoutGroup, partMap: Map<string, Part>): LayoutGroup {
  const newContent: LayoutContent[] = [];
  // Collect staves with their part info for pairing
  const staves: { node: LayoutStaff; partId: string; baseName: string }[] = [];
  const subGroups: { node: LayoutGroup; index: number }[] = [];

  for (let i = 0; i < group.content.length; i++) {
    const child = group.content[i]!;
    if (child.type === "staff") {
      const partId = child.sources[0]?.part;
      if (partId) {
        const part = partMap.get(partId);
        const name = part?.name ?? partId;
        staves.push({ node: child, partId, baseName: instrumentBaseName(name) });
      } else {
        newContent.push(child);
      }
    } else {
      // Sub-group (e.g., brace for piano) — check if it contains only single-source staves
      const isMultiStaffInstrument = child.content.every((c) => c.type === "staff" && c.sources.length === 1);
      if (isMultiStaffInstrument && child.symbol === "brace") {
        // Multi-staff instrument (piano, harp) — keep as-is
        newContent.push(child);
      } else {
        // Nested bracket group — recurse
        const condensedChild = condenseGroupContent(child, partMap);
        subGroups.push({ node: condensedChild, index: newContent.length });
        newContent.push(condensedChild);
      }
    }
  }

  // Pair staves by base name (skip string instruments which keep separate staves)
  const paired = new Set<number>();
  for (let i = 0; i < staves.length; i++) {
    if (paired.has(i)) continue;
    const current = staves[i]!;
    if (shouldSkipCondensing(current.baseName)) {
      newContent.push(current.node);
      continue;
    }
    // Find the next unpaired staff with the same base name
    let pairIndex = -1;
    for (let j = i + 1; j < staves.length; j++) {
      if (!paired.has(j) && staves[j]!.baseName === current.baseName) {
        pairIndex = j;
        break;
      }
    }

    if (pairIndex >= 0) {
      // Create a condensed multi-source staff with condensing mode enabled.
      // No explicit stem directions — merge analysis determines per-measure rendering.
      const partner = staves[pairIndex]!;
      paired.add(i);
      paired.add(pairIndex);
      const combinedSources: LayoutSource[] = [
        ...current.node.sources.map((s) => ({ ...s })),
        ...partner.node.sources.map((s) => ({ ...s })),
      ];
      newContent.push({
        type: "staff",
        sources: combinedSources,
        label: current.node.label,
        labelref: current.node.labelref,
      } as LayoutStaff);
    } else {
      // Solo — keep as-is
      newContent.push(current.node);
    }
  }

  return { ...group, content: newContent };
}
