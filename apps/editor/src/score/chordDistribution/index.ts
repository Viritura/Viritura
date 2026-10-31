/** Clipboard-driven chord distribution and paste-and-merge chord assembly. */

export { mergeNotesIntoEvent, mergeEventNotation } from "./chordMerge";
export {
  explodeFragment,
  explodePasteResult,
  FragmentDistributionError,
  reduceFragment,
  reducePasteResult,
} from "./fragmentDistribution";
export { destinationStaffCount } from "./destinationStaffCount";
