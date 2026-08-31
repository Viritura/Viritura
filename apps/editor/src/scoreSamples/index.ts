export interface ScoreSample {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly file: string;
}

export const SCORE_SAMPLES: readonly ScoreSample[] = [
  {
    id: "rhapsody-in-blue",
    title: "Rhapsody in Blue",
    description: "Piano concerto writing for full orchestra",
    file: "Rhapsody in Blue.mnx",
  },
  {
    id: "beethoven-5-movement-1",
    title: "Beethoven's Symphony No. 5, Mvt. I",
    description: "Complete first movement for classical orchestra",
    file: "beethoven-symphony-5-movement-1.mnx",
  },
  {
    id: "llamigos",
    title: "Llamigos",
    description: "Film scoring with an orchestral cue",
    file: "caminandes-llamigos-cue.mnx",
  },
];

export const DEFAULT_SCORE_SAMPLE = SCORE_SAMPLES.find((sample) => sample.id === "beethoven-5-movement-1")!;
