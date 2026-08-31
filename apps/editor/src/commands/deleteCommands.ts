import type { DynamicGroup, Score, SequenceContent } from "@viritura/core";
import type { AnnotationLocation, GraceLocation } from "../score/ElementPath";
import { cloneScore } from "../score/scoreClone";
import { condensedStaffSourcePartIndices } from "../score/condensedWriteback";

type GlobalMeasure = Score["global"]["measures"][number];
type PartMeasure = Score["parts"][number]["measures"][number];

function removeAnnotationFromArray<K extends keyof GlobalMeasure | keyof PartMeasure>(
  container: Record<string, unknown>,
  key: K & string,
  index: number | undefined,
): boolean {
  const arr = container[key] as unknown[] | undefined;
  if (!arr || index === undefined) return false;
  const next = arr.filter((_, i) => i !== index);
  if (next.length === 0) delete container[key];
  else container[key] = next;
  return true;
}

function deleteGlobalAnnotation(gm: GlobalMeasure, loc: AnnotationLocation): boolean {
  const rec = gm as unknown as Record<string, unknown>;
  switch (loc.type) {
    case "tempo":
      return removeAnnotationFromArray(rec, "tempos", loc.annotationIndex);
    case "segno":
      if (!gm.segno) return false;
      delete rec.segno;
      return true;
    case "fine":
      if (!gm.fine) return false;
      delete rec.fine;
      return true;
    case "jump":
      if (!gm.jump) return false;
      delete rec.jump;
      return true;
    case "coda":
      if (!gm.coda) return false;
      delete rec.coda;
      return true;
    case "rehearsal":
      if (!gm.rehearsalMark) return false;
      delete rec.rehearsalMark;
      return true;
    default:
      return false;
  }
}

const PART_ANNOTATION_KEYS: Partial<Record<AnnotationLocation["type"], keyof PartMeasure>> = {
  expr: "expressions",
  chord: "chordSymbols",
  pedal: "pedals",
  ottava: "ottavas",
};

/**
 * Dynamics and hairpins both live in `pm.dynamics` and are addressed by group
 * id in their element ids (`p{part}/m{measure}/dyn{groupId}` /
 * `…/hairpin{groupId}`), so resolve by id first. The ordinal fallback covers
 * legacy index-shaped ids.
 */
function deleteDynamicGroup(pm: PartMeasure, loc: AnnotationLocation): boolean {
  const dynamics = pm.dynamics;
  if (!dynamics) return false;

  let index = loc.annotationId ? dynamics.findIndex((group) => group.id === loc.annotationId) : -1;
  if (index < 0 && loc.annotationIndex !== undefined) {
    index =
      loc.type === "hairpin"
        ? (dynamics.map((group, i) => ({ group, i })).filter(({ group }) => group.type === "gradual")[
            loc.annotationIndex
          ]?.i ?? -1)
        : loc.annotationIndex;
  }
  if (index < 0 || index >= dynamics.length) return false;

  const [deleted] = dynamics.splice(index, 1);
  if (deleted) {
    for (const group of dynamics) {
      if (group.visuallyContinues === deleted.id) group.visuallyContinues = deleted.visuallyContinues;
    }
  }
  if (dynamics.length === 0) delete pm.dynamics;
  return true;
}

function deletePartAnnotation(pm: PartMeasure, loc: AnnotationLocation): boolean {
  if (loc.type === "hairpin" || loc.type === "dyn") return deleteDynamicGroup(pm, loc);
  const key = PART_ANNOTATION_KEYS[loc.type];
  if (!key) return false;
  return removeAnnotationFromArray(
    pm as unknown as Record<string, unknown>,
    key as keyof PartMeasure & string,
    loc.annotationIndex,
  );
}

/**
 * Remove an annotation from the score model based on parsed location.
 * Returns a new score with the annotation removed, or null if the location is invalid.
 */
export function deleteAnnotation(score: Score, loc: AnnotationLocation, selectedScoreIndex?: number): Score | null {
  const locations =
    selectedScoreIndex !== undefined && (loc.type === "dyn" || loc.type === "hairpin" || loc.type === "expr")
      ? expandCondensedDynamicLocations(score, [loc], selectedScoreIndex)
      : [loc];
  return deleteAnnotations(score, locations);
}

function dynamicSemantics(group: DynamicGroup): string {
  const { id: _id, visuallyContinues, ...authored } = group;
  return JSON.stringify({ ...authored, visuallyContinues: visuallyContinues !== undefined });
}

function condensedDynamicLocations(
  score: Score,
  loc: AnnotationLocation,
  selectedScoreIndex: number,
): AnnotationLocation[] {
  if (loc.partIndex === undefined) return [loc];
  const selectedGroups = score.parts[loc.partIndex]?.measures[loc.measureIndex]?.dynamics;
  const selectedIndex = dynamicGroupIndex(score, loc);
  const selectedGroup = selectedGroups?.[selectedIndex];
  if (!selectedGroup) return [loc];
  const sourceParts = condensedStaffSourcePartIndices(score, selectedScoreIndex, loc.partIndex);
  if (sourceParts.length < 2) return [loc];
  const semantics = dynamicSemantics(selectedGroup);
  const occurrence = selectedGroups!
    .slice(0, selectedIndex + 1)
    .filter((group) => dynamicSemantics(group) === semantics).length;

  return sourceParts.flatMap((partIndex) => {
    const groups = score.parts[partIndex]?.measures[loc.measureIndex]?.dynamics;
    const matching = groups?.filter((group) => dynamicSemantics(group) === semantics)[occurrence - 1];
    return matching ? [{ ...loc, partIndex, annotationId: matching.id, annotationIndex: undefined }] : [];
  });
}

function condensedExpressionLocations(
  score: Score,
  loc: AnnotationLocation,
  selectedScoreIndex: number,
): AnnotationLocation[] {
  if (loc.partIndex === undefined || loc.annotationIndex === undefined) return [loc];
  const selectedExpression = score.parts[loc.partIndex]?.measures[loc.measureIndex]?.expressions?.[loc.annotationIndex];
  if (!selectedExpression) return [loc];
  const sourceParts = condensedStaffSourcePartIndices(score, selectedScoreIndex, loc.partIndex);
  if (sourceParts.length < 2) return [loc];
  const semantics = JSON.stringify(selectedExpression);
  const selectedExpressions = score.parts[loc.partIndex]?.measures[loc.measureIndex]?.expressions ?? [];
  const occurrence = selectedExpressions
    .slice(0, loc.annotationIndex + 1)
    .filter((expression) => JSON.stringify(expression) === semantics).length;

  return sourceParts.flatMap((partIndex) => {
    const expressions = score.parts[partIndex]?.measures[loc.measureIndex]?.expressions;
    const matchingIndex = expressions
      ?.map((expression, index) => ({ expression, index }))
      .filter(({ expression }) => JSON.stringify(expression) === semantics)[occurrence - 1]?.index;
    return matchingIndex === undefined ? [] : [{ ...loc, partIndex, annotationIndex: matchingIndex }];
  });
}

/** Expand selected condensed dynamic groups to their semantically matching source groups. */
export function expandCondensedDynamicLocations(
  score: Score,
  locations: readonly AnnotationLocation[],
  selectedScoreIndex: number,
): AnnotationLocation[] {
  const expanded = locations.flatMap((loc) => {
    if (loc.type === "dyn" || loc.type === "hairpin") {
      return condensedDynamicLocations(score, loc, selectedScoreIndex);
    }
    if (loc.type === "expr") return condensedExpressionLocations(score, loc, selectedScoreIndex);
    return [loc];
  });
  const unique = new Map<string, AnnotationLocation>();
  for (const loc of expanded) {
    const key = `${loc.partIndex ?? "global"}/${loc.measureIndex}/${loc.type}/${loc.annotationId ?? loc.annotationIndex ?? ""}`;
    unique.set(key, loc);
  }
  return [...unique.values()];
}

function dynamicGroupIndex(score: Score, loc: AnnotationLocation): number {
  if (loc.partIndex === undefined) return -1;
  const dynamics = score.parts[loc.partIndex]?.measures[loc.measureIndex]?.dynamics;
  if (!dynamics) return -1;
  if (loc.annotationId) return dynamics.findIndex((group) => group.id === loc.annotationId);
  if (loc.annotationIndex === undefined) return -1;
  if (loc.type === "hairpin") {
    return (
      dynamics.map((group, index) => ({ group, index })).filter(({ group }) => group.type === "gradual")[
        loc.annotationIndex
      ]?.index ?? -1
    );
  }
  return loc.annotationIndex;
}

function annotationContainerKey(loc: AnnotationLocation): string {
  const scope = loc.partIndex === undefined ? "global" : `part${loc.partIndex}`;
  const family = loc.type === "dyn" || loc.type === "hairpin" ? "dynamics" : loc.type;
  return `${scope}/m${loc.measureIndex}/${family}`;
}

/** Remove several annotations in one immutable score update. */
export function deleteAnnotations(score: Score, locations: readonly AnnotationLocation[]): Score | null {
  const newScore = cloneScore(score);
  let removed = false;

  const ordered = locations
    .map((loc) => ({
      loc,
      index: loc.type === "dyn" || loc.type === "hairpin" ? dynamicGroupIndex(score, loc) : (loc.annotationIndex ?? -1),
    }))
    .sort((left, right) => {
      const leftKey = annotationContainerKey(left.loc);
      const rightKey = annotationContainerKey(right.loc);
      return leftKey === rightKey ? right.index - left.index : leftKey.localeCompare(rightKey);
    });

  for (const { loc } of ordered) {
    if (loc.partIndex === undefined) {
      const gm = newScore.global.measures[loc.measureIndex];
      if (gm) removed = deleteGlobalAnnotation(gm, loc) || removed;
      continue;
    }

    const pm = newScore.parts[loc.partIndex]?.measures[loc.measureIndex];
    if (pm) removed = deletePartAnnotation(pm, loc) || removed;
  }

  return removed ? newScore : null;
}

// ═══════════════════════════════════════════
// Grace note deletion
// ═══════════════════════════════════════════

/**
 * Remove a single grace note from its grace container. If the container becomes
 * empty, the container itself is spliced out so we never leave a dangling
 * `{type:"grace", content:[]}` in the sequence.
 */
export function deleteGraceNote(score: Score, loc: GraceLocation): Score {
  const newScore = cloneScore(score);
  const seq = newScore.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex];
  if (!seq) return score;

  const container: SequenceContent[] | undefined =
    loc.tupletIndex !== undefined
      ? (() => {
          const t = seq.content[loc.tupletIndex];
          return t && t.type === "tuplet" ? (t.content as SequenceContent[]) : undefined;
        })()
      : (seq.content as SequenceContent[]);
  if (!container) return score;

  const grace = container[loc.graceContainerIndex];
  if (!grace || grace.type !== "grace") return score;

  grace.content.splice(loc.graceNoteIndex, 1);
  if (grace.content.length === 0) {
    container.splice(loc.graceContainerIndex, 1);
  }
  return newScore;
}
