import { validateFretboard, type ChordSymbol, type DiagnosticCollector, type Fretboard } from "@viritura/core";
import { node, type XmlContext, type XmlElement } from "./xml";

export function exportableFretboard(
  chord: ChordSymbol,
  partId: string | undefined,
  dx: DiagnosticCollector,
): Fretboard | undefined {
  const frame = chord.fretboards?.find((candidate) => candidate.partId === partId);
  if (!frame || frame.frameNotes.length) return frame;
  dx.warn(
    "",
    "An all-unplayed diagram cannot be represented by MusicXML frame, which requires a frame-note.",
    "musicxml-frame-empty",
  );
  return undefined;
}

export function fretboardElement(context: XmlContext, frame: Fretboard): XmlElement {
  const errors = validateFretboard(frame);
  if (errors.length) throw new Error(`Invalid chord diagram: ${errors.join(" ")}`);
  return node(
    context,
    "frame",
    [
      node(context, "frame-strings", frame.frameStrings),
      node(context, "frame-frets", frame.frameFrets),
      frame.firstFret
        ? node(context, "first-fret", frame.firstFret.fret, {
            text: frame.firstFret.text,
            location: frame.firstFret.location,
          })
        : undefined,
      ...frame.frameNotes.map((note) =>
        node(context, "frame-note", [
          node(context, "string", note.string),
          node(context, "fret", note.fret),
          note.fingering !== undefined ? node(context, "fingering", note.fingering) : undefined,
          note.barre ? node(context, "barre", undefined, { type: note.barre }) : undefined,
        ]),
      ),
    ],
    { unplayed: frame.unplayed },
  );
}
