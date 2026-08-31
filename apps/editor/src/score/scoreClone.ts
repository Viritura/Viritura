import { produce, setAutoFreeze } from "immer";
import type { Score } from "@viritura/core";

// Disable auto-freeze: downstream code (repairBeatCounts in updateScore)
// mutates the produced score before it's stored in state. Structural sharing
// is the perf win, not runtime immutability enforcement.
setAutoFreeze(false);

/**
 * Produce a new Score by applying mutations to a draft.
 * Uses Immer for structural sharing — only the mutated path is cloned,
 * everything else is shared by reference with the original.
 */
export { produce };

/**
 * Deep-clone a Score object. Only needed for the rare case where helpers
 * create entirely new Score objects (e.g. appendMeasure).
 * Prefer `produce(score, draft => { ... })` for all normal mutations.
 */
export function cloneScore(score: Score): Score {
  return structuredClone(score);
}
