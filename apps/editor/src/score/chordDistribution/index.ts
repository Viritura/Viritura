/**
 * Chord distribution: moving pitches between staves.
 *
 * The folder's public surface is deliberately narrow — the explode, reduce,
 * and redistribute commands all enter through `applyDistribution`, and the
 * clipboard's paste-and-merge reuses `mergeNotesIntoEvent`.
 */

export { mergeNotesIntoEvent } from "./chordMerge";
export { applyDistribution, type DistributionMode } from "./selectionPlan";
