import type { LayoutContent, LayoutStaff, LayoutGroup, LayoutSource, LayoutDefinition, Part } from "@viritura/core";
import { resolveActiveInstrument } from "@viritura/core";

// ─── Condensed layout auto-generation ──────────────

/**
 * Build a condensed layout from a full-score layout.
 * Pairs initial instruments by catalog identity, falling back to part names.
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

function matchingInstruments(first: Part | undefined, second: Part | undefined): boolean {
  if (!first || !second) return false;
  const a = resolveActiveInstrument(first, 0);
  const b = resolveActiveInstrument(second, 0);
  const aId = a.instrument?.instrumentId ?? first._x?.viritura?.instrumentId;
  const bId = b.instrument?.instrumentId ?? second._x?.viritura?.instrumentId;
  const sameIdentity =
    aId && bId
      ? aId === bId
      : instrumentBaseName(a.instrument?.name ?? first.name) === instrumentBaseName(b.instrument?.name ?? second.name);
  const aInterval = a.transposition?.interval ?? { halfSteps: 0, staffDistance: 0 };
  const bInterval = b.transposition?.interval ?? { halfSteps: 0, staffDistance: 0 };
  return (
    Boolean(sameIdentity) &&
    aInterval.halfSteps === bInterval.halfSteps &&
    aInterval.staffDistance === bInterval.staffDistance
  );
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

function sourceKey(source: LayoutSource): string {
  return `${source.part}\u0000${source.staff ?? 1}`;
}

function collectMergedStaves(content: readonly LayoutContent[], out: LayoutStaff[] = []): LayoutStaff[] {
  for (const node of content) {
    if (node.type === "group") collectMergedStaves(node.content, out);
    else if (node.sources.length > 1 && new Set(node.sources.map((s) => s.part)).size === node.sources.length) {
      out.push(node);
    }
  }
  return out;
}

/**
 * Re-apply the multi-source (condensed) staves of `previous` onto `rebuilt`,
 * a regenerated one-staff-per-source layout. Each merged staff replaces the
 * first of its sources' staves; the remaining source staves are removed.
 * Merges whose sources are no longer all present as single staves are dropped.
 */
export function preserveCondensedStaves(rebuilt: LayoutContent[], previous: readonly LayoutContent[]): LayoutContent[] {
  const merges = new Map<string, { staff: LayoutStaff; keys: Set<string> }>();
  for (const staff of collectMergedStaves(previous)) {
    const merge = { staff, keys: new Set(staff.sources.map(sourceKey)) };
    for (const key of merge.keys) merges.set(key, merge);
  }
  if (merges.size === 0) return rebuilt;

  const singles = new Set<string>();
  const collectSingles = (content: readonly LayoutContent[]) => {
    for (const node of content) {
      if (node.type === "group") collectSingles(node.content);
      else if (node.sources.length === 1) singles.add(sourceKey(node.sources[0]!));
    }
  };
  collectSingles(rebuilt);

  const placed = new Set<LayoutStaff>();
  const apply = (content: readonly LayoutContent[]): LayoutContent[] =>
    content.flatMap((node): LayoutContent[] => {
      if (node.type === "group") {
        const groupContent = apply(node.content);
        return groupContent.length > 0 ? [{ ...node, content: groupContent }] : [];
      }
      const merge = node.sources.length === 1 ? merges.get(sourceKey(node.sources[0]!)) : undefined;
      if (!merge || ![...merge.keys].every((key) => singles.has(key))) return [node];
      if (placed.has(merge.staff)) return [];
      placed.add(merge.staff);
      return [{ ...merge.staff, sources: merge.staff.sources.map((s) => ({ ...s })) }];
    });
  return apply(rebuilt);
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

  // Pair initial instruments (skip string instruments which keep separate staves)
  const paired = new Set<number>();
  for (let i = 0; i < staves.length; i++) {
    if (paired.has(i)) continue;
    const current = staves[i]!;
    if (shouldSkipCondensing(current.baseName)) {
      newContent.push(current.node);
      continue;
    }
    // Find the next unpaired staff with the same initial instrument
    let pairIndex = -1;
    for (let j = i + 1; j < staves.length; j++) {
      const candidate = staves[j]!;
      if (
        !paired.has(j) &&
        candidate.partId !== current.partId &&
        matchingInstruments(partMap.get(current.partId), partMap.get(candidate.partId))
      ) {
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
