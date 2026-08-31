import type { SelectableElementType } from "../score/elementTypes";

/**
 * A single navigable entry in the score.
 * Can represent an event (note/rest), a measure-level annotation,
 * or a global element (tempo, rehearsal mark, etc.).
 */
export interface NavigationEntry {
  /** Element ID matching the Rust engine format */
  elementId: string;
  /** Parsed element type for filtering navigation */
  elementType: SelectableElementType;
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
  /** For top-level events: index in seq.content. For tuplet inner events: index within tuplet.content. */
  eventIndex: number;
  /**
   * For events inside a tuplet or tremolo: the index of the container in seq.content.
   * Undefined for top-level events.
   */
  tupletIndex?: number;
  /** Whether this event is a rest (only meaningful for event/rest types) */
  isRest: boolean;
  /** Sort key within a measure for deterministic ordering */
  sortKey: number;
}

/**
 * A pre-built index of all navigable elements in the score,
 * sorted by (part, measure, sortKey).
 */
export interface NavigationIndex {
  entries: NavigationEntry[];
}

// uildNavigationIndex lives in a sibling so this file stays under the
// max-lines lint threshold and is purely query/navigation surface.
export { buildNavigationIndex } from "./navigationIndexBuilder";

/**
 * Whether an entry is an event (note or rest).
 * Used for backward-compatible navigation that only walks events.
 */
function isEventEntry(entry: NavigationEntry): boolean {
  return entry.elementType === "event" || entry.elementType === "rest";
}

/**
 * Check if an entry matches an optional element type filter.
 * If no filter is provided, matches only events (backward compatible).
 */
function matchesFilter(entry: NavigationEntry, filter?: readonly SelectableElementType[]): boolean {
  if (!filter) return isEventEntry(entry);
  return filter.includes(entry.elementType);
}

/**
 * Find the index of an entry by element ID.
 * Returns -1 if not found.
 */
export function findEntryIndex(navIndex: NavigationIndex, elementId: string): number {
  return navIndex.entries.findIndex((e) => e.elementId === elementId);
}

/**
 * Get the next event in the same voice (same part + sequence).
 * Returns undefined if at the end.
 * Only walks events (notes/rests) for backward compatibility.
 */
export function findNextInVoice(navIndex: NavigationIndex, currentId: string): string | undefined {
  const idx = findEntryIndex(navIndex, currentId);
  if (idx < 0) return undefined;
  const current = navIndex.entries[idx]!;

  for (let i = idx + 1; i < navIndex.entries.length; i++) {
    const entry = navIndex.entries[i]!;
    if (!isEventEntry(entry)) continue;
    if (entry.partIndex === current.partIndex && entry.sequenceIndex === current.sequenceIndex) {
      return entry.elementId;
    }
    // Past our voice — stop searching
    if (entry.partIndex > current.partIndex) break;
  }
  return undefined;
}

/**
 * Get the previous event in the same voice (same part + sequence).
 * Returns undefined if at the beginning.
 * Only walks events (notes/rests) for backward compatibility.
 */
export function findPrevInVoice(navIndex: NavigationIndex, currentId: string): string | undefined {
  const idx = findEntryIndex(navIndex, currentId);
  if (idx < 0) return undefined;
  const current = navIndex.entries[idx]!;

  for (let i = idx - 1; i >= 0; i--) {
    const entry = navIndex.entries[i]!;
    if (!isEventEntry(entry)) continue;
    if (entry.partIndex === current.partIndex && entry.sequenceIndex === current.sequenceIndex) {
      return entry.elementId;
    }
  }
  return undefined;
}

/**
 * Get the first event of the next measure in the same voice.
 * Only walks events for backward compatibility.
 */
export function findNextMeasure(navIndex: NavigationIndex, currentId: string): string | undefined {
  const idx = findEntryIndex(navIndex, currentId);
  if (idx < 0) return undefined;
  const current = navIndex.entries[idx]!;

  for (let i = idx + 1; i < navIndex.entries.length; i++) {
    const entry = navIndex.entries[i]!;
    if (!isEventEntry(entry)) continue;
    if (
      entry.partIndex === current.partIndex &&
      entry.sequenceIndex === current.sequenceIndex &&
      entry.measureIndex > current.measureIndex
    ) {
      return entry.elementId;
    }
    if (entry.partIndex > current.partIndex) break;
  }
  return undefined;
}

/**
 * Get the first event of the previous measure in the same voice.
 * Only walks events for backward compatibility.
 */
export function findPrevMeasure(navIndex: NavigationIndex, currentId: string): string | undefined {
  const idx = findEntryIndex(navIndex, currentId);
  if (idx < 0) return undefined;
  const current = navIndex.entries[idx]!;

  // Find first event in previous measure (same voice)
  let result: string | undefined;
  for (let i = idx - 1; i >= 0; i--) {
    const entry = navIndex.entries[i]!;
    if (!isEventEntry(entry)) continue;
    if (
      entry.partIndex === current.partIndex &&
      entry.sequenceIndex === current.sequenceIndex &&
      entry.measureIndex < current.measureIndex
    ) {
      result = entry.elementId;
      // Keep going back to find the first event of that measure
      const targetMeasure = entry.measureIndex;
      for (let j = i - 1; j >= 0; j--) {
        const prev = navIndex.entries[j]!;
        if (!isEventEntry(prev)) continue;
        if (
          prev.partIndex === current.partIndex &&
          prev.sequenceIndex === current.sequenceIndex &&
          prev.measureIndex === targetMeasure
        ) {
          result = prev.elementId;
        } else {
          break;
        }
      }
      return result;
    }
  }
  return undefined;
}

/**
 * Get the first navigable event in the score.
 */
export function findFirst(navIndex: NavigationIndex): string | undefined {
  const entry = navIndex.entries.find(isEventEntry);
  return entry?.elementId;
}

/**
 * Get the last navigable event in the score.
 */
export function findLast(navIndex: NavigationIndex): string | undefined {
  for (let i = navIndex.entries.length - 1; i >= 0; i--) {
    const entry = navIndex.entries[i]!;
    if (isEventEntry(entry)) return entry.elementId;
  }
  return undefined;
}

/**
 * Find the next event of the same type (rest vs. note) in any voice/measure.
 * Used for Tab navigation. Only walks events.
 */
export function findNextSameType(navIndex: NavigationIndex, currentId: string): string | undefined {
  const idx = findEntryIndex(navIndex, currentId);
  if (idx < 0) return undefined;
  const current = navIndex.entries[idx]!;

  for (let i = idx + 1; i < navIndex.entries.length; i++) {
    const entry = navIndex.entries[i]!;
    if (!isEventEntry(entry)) continue;
    if (entry.isRest === current.isRest) {
      return entry.elementId;
    }
  }
  // Wrap around to beginning
  for (let i = 0; i < idx; i++) {
    const entry = navIndex.entries[i]!;
    if (!isEventEntry(entry)) continue;
    if (entry.isRest === current.isRest) {
      return entry.elementId;
    }
  }
  return undefined;
}

/**
 * Find the corresponding event in the voice above (lower sequence index) or below
 * (higher sequence index) in the same measure. Only walks events.
 */
export function findAdjacentVoice(
  navIndex: NavigationIndex,
  currentId: string,
  direction: "up" | "down",
): string | undefined {
  const idx = findEntryIndex(navIndex, currentId);
  if (idx < 0) return undefined;
  const current = navIndex.entries[idx]!;

  const targetSeq = direction === "up" ? current.sequenceIndex - 1 : current.sequenceIndex + 1;

  // Find first event in the target sequence in the same measure
  for (const entry of navIndex.entries) {
    if (!isEventEntry(entry)) continue;
    if (
      entry.partIndex === current.partIndex &&
      entry.measureIndex === current.measureIndex &&
      entry.sequenceIndex === targetSeq
    ) {
      return entry.elementId;
    }
  }
  return undefined;
}

/**
 * Find the corresponding event in an adjacent part (staff) at the same
 * measure and closest sequence/event position.
 * "up" means lower partIndex (the staff above), "down" means higher.
 */
export function findAdjacentPart(
  navIndex: NavigationIndex,
  currentId: string,
  direction: "up" | "down",
): string | undefined {
  const idx = findEntryIndex(navIndex, currentId);
  if (idx < 0) return undefined;
  const current = navIndex.entries[idx]!;

  const targetPart = direction === "up" ? current.partIndex - 1 : current.partIndex + 1;
  if (targetPart < 0) return undefined;

  // Find the first event in the target part at the same measure
  let best: NavigationEntry | undefined;
  for (const entry of navIndex.entries) {
    if (!isEventEntry(entry)) continue;
    if (entry.partIndex === targetPart && entry.measureIndex === current.measureIndex) {
      // Prefer same sequence index and event index, fall back to first event
      if (!best) {
        best = entry;
      }
      if (entry.sequenceIndex === current.sequenceIndex && entry.eventIndex === current.eventIndex) {
        return entry.elementId;
      }
    }
  }
  return best?.elementId;
}

/**
 * Get the entry for a given element ID.
 */
export function getEntry(navIndex: NavigationIndex, elementId: string): NavigationEntry | undefined {
  const idx = findEntryIndex(navIndex, elementId);
  if (idx < 0) return undefined;
  return navIndex.entries[idx];
}

// ═══════════════════════════════════════════
// Filtered navigation (supports non-event elements)
// ═══════════════════════════════════════════

/**
 * Find the next entry matching the given filter.
 * If no filter is provided, walks events only (backward compatible).
 * Searches forward from the current entry in index order.
 */
export function findNext(
  navIndex: NavigationIndex,
  currentId: string,
  filter?: readonly SelectableElementType[],
): NavigationEntry | undefined {
  const idx = findEntryIndex(navIndex, currentId);
  if (idx < 0) return undefined;

  for (let i = idx + 1; i < navIndex.entries.length; i++) {
    const entry = navIndex.entries[i]!;
    if (matchesFilter(entry, filter)) {
      return entry;
    }
  }
  return undefined;
}

/**
 * Find the previous entry matching the given filter.
 * If no filter is provided, walks events only (backward compatible).
 * Searches backward from the current entry in index order.
 */
export function findPrev(
  navIndex: NavigationIndex,
  currentId: string,
  filter?: readonly SelectableElementType[],
): NavigationEntry | undefined {
  const idx = findEntryIndex(navIndex, currentId);
  if (idx < 0) return undefined;

  for (let i = idx - 1; i >= 0; i--) {
    const entry = navIndex.entries[i]!;
    if (matchesFilter(entry, filter)) {
      return entry;
    }
  }
  return undefined;
}

/**
 * Get all entries in the same measure as the given element.
 * Optionally filtered by element types.
 */
export function findEntriesInMeasure(
  navIndex: NavigationIndex,
  elementId: string,
  filter?: readonly SelectableElementType[],
): NavigationEntry[] {
  const idx = findEntryIndex(navIndex, elementId);
  if (idx < 0) return [];
  const current = navIndex.entries[idx]!;

  return navIndex.entries.filter(
    (entry) =>
      entry.measureIndex === current.measureIndex &&
      (current.partIndex === -1 || entry.partIndex === -1 || entry.partIndex === current.partIndex) &&
      matchesFilter(entry, filter),
  );
}

// ═══════════════════════════════════════════
// Tab-cycle navigation (position-based)
// ═══════════════════════════════════════════

/**
 * Tolerance for comparing beat positions. Two elements are considered at
 * the same position if their sortKeys differ by less than this amount.
 */
const BEAT_TOLERANCE = 0.001;

/**
 * Find the next element at the same beat position but different element type.
 * Used for Tab-cycle navigation: note → dynamic → hairpin → back to note.
 * Wraps around within the position group.
 * Global entries (partIndex -1) are included alongside part entries.
 */
export function findNextAtPosition(navIndex: NavigationIndex, currentId: string): string | undefined {
  const idx = findEntryIndex(navIndex, currentId);
  if (idx < 0) return undefined;
  const current = navIndex.entries[idx]!;

  // Collect all entries at the same position (same measure, compatible part, ~same beat)
  const atPosition: NavigationEntry[] = [];
  for (const entry of navIndex.entries) {
    if (
      entry.measureIndex === current.measureIndex &&
      // Match same part, or either side is global (partIndex -1)
      (entry.partIndex === current.partIndex || entry.partIndex === -1 || current.partIndex === -1) &&
      Math.abs(entry.sortKey - current.sortKey) < BEAT_TOLERANCE
    ) {
      atPosition.push(entry);
    }
  }

  if (atPosition.length <= 1) return undefined;

  // Find current entry's position within this group
  const currentIdx = atPosition.findIndex((e) => e.elementId === currentId);
  if (currentIdx < 0) return undefined;

  // Wrap around to next entry in the group
  const nextIdx = (currentIdx + 1) % atPosition.length;
  const next = atPosition[nextIdx];
  return next && next.elementId !== currentId ? next.elementId : undefined;
}

/**
 * Find the previous element at the same beat position but different element type.
 * Used for Shift+Tab reverse-cycle navigation.
 * Wraps around within the position group.
 * Global entries (partIndex -1) are included alongside part entries.
 */
export function findPrevAtPosition(navIndex: NavigationIndex, currentId: string): string | undefined {
  const idx = findEntryIndex(navIndex, currentId);
  if (idx < 0) return undefined;
  const current = navIndex.entries[idx]!;

  // Collect all entries at the same position (same measure, compatible part, ~same beat)
  const atPosition: NavigationEntry[] = [];
  for (const entry of navIndex.entries) {
    if (
      entry.measureIndex === current.measureIndex &&
      (entry.partIndex === current.partIndex || entry.partIndex === -1 || current.partIndex === -1) &&
      Math.abs(entry.sortKey - current.sortKey) < BEAT_TOLERANCE
    ) {
      atPosition.push(entry);
    }
  }

  if (atPosition.length <= 1) return undefined;

  const currentIdx = atPosition.findIndex((e) => e.elementId === currentId);
  if (currentIdx < 0) return undefined;

  // Wrap around to previous entry in the group
  const prevIdx = (currentIdx - 1 + atPosition.length) % atPosition.length;
  const prev = atPosition[prevIdx];
  return prev && prev.elementId !== currentId ? prev.elementId : undefined;
}
