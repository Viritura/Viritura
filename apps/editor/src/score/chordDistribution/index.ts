/** Clipboard-driven chord distribution and paste-and-merge chord assembly. */

export { mergeNotesIntoEvent } from "./chordMerge";
export {
  explodeFragment,
  explodePasteResult,
  FragmentDistributionError,
  reduceFragment,
  reducePasteResult,
} from "./fragmentDistribution";
export { destinationStaffCount } from "./destinationStaffCount";
