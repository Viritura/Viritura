import type { Markings, NoteEvent, SequenceContent } from "@viritura/core";

function resetEventDirections(event: NoteEvent): void {
  delete event.stemDirection;
  const markings: Markings = event.markings ?? {};
  for (const marking of [
    markings.staccato,
    markings.staccatissimo,
    markings.staccatissimoWedge,
    markings.spiccato,
    markings.tenuto,
    markings.accent,
    markings.strongAccent,
    markings.softAccent,
    markings.stress,
    markings.unstress,
    markings.tremolo,
    markings.breath,
    markings.bowDirection,
  ]) {
    if (marking) delete marking.placement;
  }
  if (markings.strongAccent) delete markings.strongAccent.pointing;
  if (event.fermata) {
    delete event.fermata.placement;
    delete event.fermata.pointing;
  }
  for (const slur of event.slurs ?? []) {
    delete slur.side;
    delete slur.sideEnd;
    delete slur.shape;
  }
  for (const note of [...(event.notes ?? []), ...(event.kitNotes ?? [])]) {
    for (const tie of note.ties ?? []) delete tie.side;
  }
}

/** Reset only placed clones; the clipboard keeps the source's engraving intact. */
export function resetPasteDirections(content: readonly SequenceContent[]): void {
  for (const item of content) {
    if (item.type === "event") resetEventDirections(item);
    else if (item.type !== "space") {
      if (item.type === "tuplet") delete item.placement;
      resetPasteDirections(item.content);
    }
  }
}
