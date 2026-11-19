import { applyPatchesToScore, type Score, type ScorePatch } from "@viritura/core";
import { patchesStillApplicable, type PatchBase } from "./patchRevisions";

const MAX_BATCH_PATCHES = 4096;
const MAX_OPEN_BATCHES = 8;

interface PatchBatch {
  readonly baseRevision: string;
  readonly base: PatchBase;
  readonly patches: readonly ScorePatch[];
  readonly chunkCount: number;
}

type AppendResult =
  | { readonly ok: true; readonly patches: readonly ScorePatch[] }
  | { readonly ok: false; readonly code: string; readonly message: string };

const batches = new Map<string, PatchBatch>();

/**
 * Replay accumulated patches against the latest compatible score, so later
 * chunks can target earlier results without dropping unrelated concurrent edits.
 * An invalid chunk throws and leaves the batch unchanged.
 */
export function appendPatchBatch(
  batchId: string,
  baseScore: Score,
  currentRevision: string,
  documentIdentity: string,
  patches: readonly ScorePatch[],
  retain: boolean,
): AppendResult {
  const existing = batches.get(batchId);
  const combined = [...(existing?.patches ?? []), ...patches];
  if (
    existing &&
    (existing.base.documentIdentity !== documentIdentity ||
      (existing.baseRevision !== currentRevision &&
        !patchesStillApplicable(existing.base, baseScore, documentIdentity, combined)))
  ) {
    batches.delete(batchId);
    return {
      ok: false,
      code: "batch_stale",
      message: `Batch ${batchId} was discarded because its score area changed. Re-read the score and resend every batch.`,
    };
  }
  if (!existing && batches.size >= MAX_OPEN_BATCHES) {
    return {
      ok: false,
      code: "too_many_batches",
      message: `At most ${String(MAX_OPEN_BATCHES)} patch batches can be open at once; finish one with final: true.`,
    };
  }
  const priorPatches = existing?.patches ?? [];
  if (priorPatches.length + patches.length > MAX_BATCH_PATCHES) {
    batches.delete(batchId);
    return {
      ok: false,
      code: "batch_too_large",
      message: `Batch ${batchId} exceeded ${String(MAX_BATCH_PATCHES)} patches and was discarded.`,
    };
  }

  // Clone first: applying patches can mutate patch-owned objects inserted into the draft.
  applyPatchesToScore(baseScore, structuredClone(combined));
  if (retain) {
    batches.set(batchId, {
      baseRevision: existing?.baseRevision ?? currentRevision,
      base: existing?.base ?? { score: structuredClone(baseScore), documentIdentity },
      patches: combined,
      chunkCount: (existing?.chunkCount ?? 0) + 1,
    });
  }
  return { ok: true, patches: combined };
}

export function getPatchBatch(
  batchId: string,
  score: Score | null,
  documentIdentity: string,
): {
  batchId: string;
  status: "batching" | "stale";
  baseRevision: string;
  patchCount: number;
  chunkCount: number;
} | null {
  const batch = batches.get(batchId);
  if (!batch) return null;
  return {
    batchId,
    status: score && patchesStillApplicable(batch.base, score, documentIdentity, batch.patches) ? "batching" : "stale",
    baseRevision: batch.baseRevision,
    patchCount: batch.patches.length,
    chunkCount: batch.chunkCount,
  };
}

export function discardPatchBatch(batchId: string): boolean {
  return batches.delete(batchId);
}

export function clearPatchBatches(): void {
  batches.clear();
}
