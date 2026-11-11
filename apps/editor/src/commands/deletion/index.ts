export { deletionOperations, resolveDeletionTarget, deleteLeafTarget, deleteLeafTargets } from "./operations";
export { computeDeleteSelection, timedAnnotationsAnchoredToCollapsedSequences } from "./selection";
export type { DeleteSelectionResult } from "./selection";
export {
  iterAllEvents,
  deleteSlurByElementId,
  deleteTieByElementId,
  deleteOrnamentOrTrill,
  deleteClefByElementId,
  removeMeasureRangeFromScore,
} from "./structuralTargets";
