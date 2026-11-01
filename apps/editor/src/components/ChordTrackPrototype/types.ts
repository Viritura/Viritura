import type { DisplayList } from "@viritura/renderer";
import type { TimedChord } from "../ChordTrack";
export type { TimedChord as PrototypeChord, TrackPoint, TrackSystem } from "../ChordTrack";

export interface ChordTrackPrototypeProps {
  displayList: DisplayList;
  initialChords: readonly TimedChord[];
  viewMode: "horizon" | "page";
}
