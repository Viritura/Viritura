import { applyPatchesToScore, type Score, type ScorePatch } from "@viritura/core";

const MAX_BATCH_PATCHES = 4096;
const MAX_OPEN_BATCHES = 8;

interface PatchBatch {
  readonly baseRevision: string;
  readonly patches: readonly ScorePatch[];
  readonly chunkCount: number;
  /** Base score with every accepted batch part applied, so later parts can target earlier results. */
  readonly shadow: Score;
}

type AppendResult =
  | { readonly ok: true; readonly patches: readonly ScorePatch[] }
  | { readonly ok: false; readonly code: string; readonly message: string };

const batches = new Map<string, PatchBatch>();

/**
 * Validate `patches` on top of the batch's accumulated shadow score and append
 * them. An invalid part throws and leaves the batch unchanged so the caller can
 * correct and resend it.
 */
export function appendPatchBatch(
  batchId: string,
  baseScore: Score,
  baseRevision: string,
  patches: readonly ScorePatch[],
  retain: boolean,
): AppendResult {
  const existing = batches.get(batchId);
  if (existing && existing.baseRevision !== baseRevision) {
    batches.delete(batchId);
    return {
      ok: false,
      code: "batch_stale",
      message: `Batch ${batchId} was discarded because the score changed. Re-read the score and resend every batch.`,
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
  const shadow = applyPatchesToScore(existing?.shadow ?? baseScore, structuredClone(patches));
  const combined = [...priorPatches, ...patches];
  if (retain) {
    batches.set(batchId, { baseRevision, patches: combined, shadow, chunkCount: (existing?.chunkCount ?? 0) + 1 });
  }
  return { ok: true, patches: combined };
}

export function getPatchBatch(
  batchId: string,
  currentRevision: string,
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
    status: batch.baseRevision === currentRevision ? "batching" : "stale",
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
