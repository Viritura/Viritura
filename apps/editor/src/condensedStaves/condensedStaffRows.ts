/**
 * Condensed-staff rows — what the canvas overlay needs to place an
 * expand/collapse control beside each condensed staff.
 *
 * A staff is "condensed" when its `LayoutStaff` carries more than one source
 * part (two horns sharing a stave). Expanding one injects the individual parts
 * as extra staves below it so they can be read apart. That is a *view*
 * transform — `injectExpandedStaves` rewrites the layout on its way to the
 * engine and nothing is written back to MNX.
 *
 * This walk deliberately mirrors `injectExpandedStaves` step for step,
 * including how an expansion advances the staff counter. The engine numbers
 * `MeasureBounds.staffIndex` by that same flattened order, so mirroring the
 * walk is what guarantees the control lands on the right staff. Deriving the
 * index any other way would drift the moment either side changed.
 */
import { resolvePartDisplayNames, type LayoutContent, type Score } from "@viritura/core";

export interface CondensedStaffRow {
  /** Layout node path joined with "-", e.g. `"2-1"`. */
  readonly pathKey: string;
  /** Display label, e.g. `"Horn in F 1 / Horn in F 2"`. */
  readonly label: string;
  /** Individual part names, top to bottom, as they appear when expanded. */
  readonly partLabels: readonly string[];
  /** Visual staff index of the condensed staff itself (`MeasureBounds.staffIndex`). */
  readonly staffIndex: number;
  readonly expanded: boolean;
}

/**
 * Every condensed staff in the score's layout, in tree order, annotated with
 * the visual staff index it occupies given the current expansion set.
 *
 * Returns `[]` when the score has no condensed staves, which is the common
 * case and lets callers skip rendering entirely.
 */
export function collectCondensedStaffRows(
  score: Score | null,
  scoreIndex: number,
  expanded: ReadonlySet<string>,
): CondensedStaffRow[] {
  const layoutId = score?.scores?.[scoreIndex]?.layout;
  const layout = layoutId ? score?.layouts?.find((l) => l.id === layoutId) : undefined;
  if (!score || !layout) return [];

  const nameByPartId = new Map<string, string>();
  const infos = resolvePartDisplayNames(score.parts);
  for (let i = 0; i < score.parts.length; i++) {
    const id = score.parts[i]?.id;
    if (id) nameByPartId.set(id, infos[i]?.displayName ?? id);
  }

  const out: CondensedStaffRow[] = [];
  let staffIndex = 0;

  const walk = (content: readonly LayoutContent[], prefix: string) => {
    for (let i = 0; i < content.length; i++) {
      const node = content[i]!;
      const pathKey = prefix ? `${prefix}-${i}` : `${i}`;
      if (node.type === "group") {
        walk(node.content, pathKey);
        continue;
      }
      const ownIndex = staffIndex;
      staffIndex += 1;
      if (node.sources.length <= 1) continue;

      const isExpanded = expanded.has(pathKey);
      const partLabels = node.sources.map((s) => nameByPartId.get(s.part) ?? s.part);
      out.push({
        pathKey,
        label: partLabels.join(" / "),
        partLabels,
        staffIndex: ownIndex,
        expanded: isExpanded,
      });
      // Expansion staves are injected directly below the condensed staff, so
      // they consume the next N visual indices.
      if (isExpanded) staffIndex += node.sources.length;
    }
  };

  walk(layout.content, "");
  return out;
}
