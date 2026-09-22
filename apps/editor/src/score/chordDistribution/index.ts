export { allocateTopDown, pitchKey, sortByPitchDescending } from "./allocation";
export { buildBeatGrid, maxSimultaneity, type BeatGrid, type GridSlot, type MeasureGrid } from "./beatGrid";
export { cloneNoteForChord, mergeNotesIntoEvent } from "./chordMerge";
export { redistributeStaves, type RedistributeParams, type RedistributeResult } from "./redistribute";
export { applyDistribution, planDistribution, type DistributionMode, type DistributionPlan } from "./selectionPlan";
export {
  compareStaffRefs,
  extendStavesDownward,
  sameStaff,
  scoreStaffOrder,
  selectionStaffRefs,
  staffSequenceIndex,
  staffVoiceCount,
  type StaffRef,
} from "./staffOrder";
