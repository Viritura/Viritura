export { deletionOperations, resolveDeletionTarget, deleteLeafTarget } from "./operations";
export { executeDeletion } from "./execution";
export { computeDeleteSelection, timedAnnotationsAnchoredToCollapsedSequences } from "./selection";
export {
  iterAllEvents,
  deleteSlurByElementId,
  deleteTieByElementId,
  deleteOrnamentOrTrill,
  deleteClefByElementId,
  removeMeasureRangeFromScore,
} from "./structuralTargets";
