import type { Note } from "@viritura/core";

export function noteConnectorOrdinals(notes: readonly Note[]): number[] {
  // MuseScore 4.7.5 (3654226c2e99289916916953a98e585a3d3b315a):
  // dom/location.cpp Location::note and rw/write/twrite.cpp TWrite::write(Chord*)
  // index the same source notes() vector. Callers must pass XML serialization order.
  // Chord::add may reorder received unisons, but compensating for that here would
  // change the source XML coordinates and misidentify native connector endpoints.
  return notes.map((_note, ordinal) => ordinal);
}
