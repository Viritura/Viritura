import type { Transposition } from "@viritura/core";
import { getCatalogInstrument } from "../../../score/InstrumentCatalog";
import { soundingPitchFor } from "./pitch";

/** The same sounding notes are engraved twice; written C-D-E-G is the reference. */
export function transpositionPreviewScore(instrumentId: string | undefined, transposition: Transposition): object {
  const instrument = instrumentId ? getCatalogInstrument(instrumentId) : undefined;
  const clef = instrument?.clefs[1] ?? { sign: "G", staffPosition: -2 };
  const content = [
    [0, 0],
    [2, 1],
    [4, 2],
    [7, 4],
  ].map(([chromatic, diatonic]) => {
    const pitch = soundingPitchFor(
      transposition.interval.halfSteps - chromatic!,
      transposition.interval.staffDistance - diatonic!,
    );
    return {
      duration: { base: "quarter" },
      notes: [{ pitch: { step: pitch.letter, octave: pitch.octave, alter: pitch.accidental } }],
    };
  });
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }] },
    parts: [
      {
        id: "preview",
        name: "Preview",
        transposition: {
          interval: transposition.interval,
          ...(transposition.keyFifthsFlipAt !== undefined ? { keyFifthsFlipAt: transposition.keyFifthsFlipAt } : {}),
        },
        measures: [{ clefs: [{ clef }], sequences: [{ content }] }],
      },
    ],
    layouts: [{ id: "preview", content: [{ type: "staff", sources: [{ part: "preview" }] }] }],
    scores: [
      { name: "Concert pitch", layout: "preview", useWritten: false },
      { name: "Written pitch", layout: "preview", useWritten: true },
    ],
  };
}
