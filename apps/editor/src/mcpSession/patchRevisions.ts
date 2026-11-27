import type { MeasurePath, Score, ScorePatch } from "@viritura/core";
import { stableStringify } from "../diff";
import type { DocumentStore } from "../store/documentStore";

export interface PatchBase {
  readonly score: Score;
  readonly documentIdentity: string;
}

const MAX_REVISIONS = 32;
let revisions = new WeakMap<DocumentStore, Map<string, PatchBase>>();
const storeIdentities = new WeakMap<DocumentStore, string>();

export function getDocumentIdentity(store: DocumentStore): string {
  let identity = storeIdentities.get(store);
  if (!identity) {
    identity = crypto.randomUUID();
    storeIdentities.set(store, identity);
  }
  return `${identity}:${String(store.getState().documentGeneration)}`;
}

/** Retain only revisions actually exposed to this MCP client, not every editor keystroke. */
export function rememberRevision(store: DocumentStore): void {
  const state = store.getState();
  if (!state.workingScore) return;
  let history = revisions.get(store);
  if (!history) {
    history = new Map();
    revisions.set(store, history);
  }
  if (history.has(state.scoreRevision)) return;
  history.set(state.scoreRevision, {
    score: structuredClone(state.workingScore),
    documentIdentity: getDocumentIdentity(store),
  });
  if (history.size > MAX_REVISIONS) history.delete(history.keys().next().value!);
}

export function getRevisionBase(store: DocumentStore, revision: string): PatchBase | undefined {
  return revisions.get(store)?.get(revision);
}

export function clearPatchRevisions(): void {
  revisions = new WeakMap();
}

export function patchesStillApplicable(
  base: PatchBase,
  score: Score,
  documentIdentity: string,
  patches: readonly ScorePatch[],
): boolean {
  if (base.documentIdentity !== documentIdentity) return false;
  // Patches address measures by position. Structural or contextual changes must
  // not silently retarget a patch or change its rhythmic interpretation.
  const { parts: beforeParts, metadata: _beforeMetadata, ...beforeContext } = base.score;
  const { parts: afterParts, metadata: _afterMetadata, ...afterContext } = score;
  if (!equal(beforeContext, afterContext)) return false;
  if (
    !equal(
      beforeParts.map((part) => [part.id, part.measures.length]),
      afterParts.map((part) => [part.id, part.measures.length]),
    )
  )
    return false;

  return patches.every((patch) => {
    const path = measurePath(patch);
    // Structural and score/part-wide patches retain whole-score safety.
    if (!path) return equal(base.score, score);
    const before = beforeParts.find((part) => part.id === path.partId);
    const after = afterParts.find((part) => part.id === path.partId);
    if (!before || !after) return false;
    const { measures: beforeMeasures, ...beforePart } = before;
    const { measures: afterMeasures, ...afterPart } = after;
    return equal(beforePart, afterPart) && equal(beforeMeasures[path.measureIndex], afterMeasures[path.measureIndex]);
  });
}

function measurePath(patch: ScorePatch): MeasurePath | undefined {
  if ("locator" in patch) return patch.locator.sequencePath;
  if ("sequencePath" in patch) return patch.sequencePath;
  if ("measurePath" in patch) return patch.measurePath;
  return undefined;
}

function equal(before: unknown, after: unknown): boolean {
  return stableStringify(before) === stableStringify(after);
}
