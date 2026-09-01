export interface PublishedExample {
  readonly id: string;
  readonly title: string;
  readonly filename: string;
  readonly group: string;
}

export const publishedExamples: readonly PublishedExample[] = [
  { id: "hello-world", title: "Hello world", filename: "hello-world.mnx", group: "Getting started" },
  {
    id: "two-bar-c-major-scale",
    title: "Two-bar C major scale",
    filename: "two-bar-c-major-scale.mnx",
    group: "Getting started",
  },
  {
    id: "three-note-chord-and-half-rest",
    title: "Three-note chord and half rest",
    filename: "three-note-chord-and-half-rest.mnx",
    group: "Getting started",
  },
  { id: "parts", title: "Parts", filename: "parts.mnx", group: "Getting started" },

  { id: "accidentals", title: "Accidentals", filename: "accidentals.mnx", group: "Notes and rhythm" },
  { id: "dotted-notes", title: "Dotted notes", filename: "dotted-notes.mnx", group: "Notes and rhythm" },
  {
    id: "full-measure-rests",
    title: "Full-measure rests",
    filename: "full-measure-rests.mnx",
    group: "Notes and rhythm",
  },
  { id: "rest-positions", title: "Rest positions", filename: "rest-positions.mnx", group: "Notes and rhythm" },
  { id: "ties", title: "Ties", filename: "ties.mnx", group: "Notes and rhythm" },
  { id: "tie-targets", title: "Tie targets", filename: "tie-targets.mnx", group: "Notes and rhythm" },
  { id: "tuplets", title: "Tuplets", filename: "tuplets.mnx", group: "Notes and rhythm" },
  { id: "multiple-voices", title: "Multiple voices", filename: "multiple-voices.mnx", group: "Notes and rhythm" },
  {
    id: "multimeasure-rests",
    title: "Multimeasure rests",
    filename: "multimeasure-rests.mnx",
    group: "Notes and rhythm",
  },

  { id: "beams", title: "Beams", filename: "beams.mnx", group: "Beams and grace notes" },
  {
    id: "beams-across-barlines",
    title: "Beams across barlines",
    filename: "beams-across-barlines.mnx",
    group: "Beams and grace notes",
  },
  { id: "beam-hooks", title: "Beam hooks", filename: "beam-hooks.mnx", group: "Beams and grace notes" },
  {
    id: "beams-secondary-beam-breaks-implied",
    title: "Secondary breaks, implied",
    filename: "beams-secondary-beam-breaks-implied.mnx",
    group: "Beams and grace notes",
  },
  {
    id: "beams-secondary-beam-breaks",
    title: "Secondary beam breaks",
    filename: "beams-secondary-beam-breaks.mnx",
    group: "Beams and grace notes",
  },
  {
    id: "beams-inner-grace-notes",
    title: "Beams with inner grace notes",
    filename: "beams-inner-grace-notes.mnx",
    group: "Beams and grace notes",
  },
  { id: "grace-note", title: "Grace note", filename: "grace-note.mnx", group: "Beams and grace notes" },
  {
    id: "grace-notes-beamed",
    title: "Beamed grace notes",
    filename: "grace-notes-beamed.mnx",
    group: "Beams and grace notes",
  },

  { id: "clef-changes", title: "Clef changes", filename: "clef-changes.mnx", group: "Structure and layouts" },
  { id: "key-signatures", title: "Key signatures", filename: "key-signatures.mnx", group: "Structure and layouts" },
  {
    id: "time-signature-glyphs",
    title: "Time signature glyphs",
    filename: "time-signature-glyphs.mnx",
    group: "Structure and layouts",
  },
  { id: "time-signatures", title: "Time signatures", filename: "time-signatures.mnx", group: "Structure and layouts" },
  { id: "grand-staff", title: "Grand staff piano music", filename: "grand-staff.mnx", group: "Structure and layouts" },
  {
    id: "multiple-layouts",
    title: "Multiple layouts",
    filename: "multiple-layouts.mnx",
    group: "Structure and layouts",
  },
  {
    id: "orchestral-layout",
    title: "Orchestral layout",
    filename: "orchestral-layout.mnx",
    group: "Structure and layouts",
  },
  { id: "organ-layout", title: "Organ layout", filename: "organ-layout.mnx", group: "Structure and layouts" },
  { id: "system-layouts", title: "System layouts", filename: "system-layouts.mnx", group: "Structure and layouts" },

  { id: "articulations", title: "Articulations", filename: "articulations.mnx", group: "Expression and text" },
  { id: "dynamic-accents", title: "Dynamic accents", filename: "dynamic-accents.mnx", group: "Expression and text" },
  { id: "dynamics", title: "Dynamics", filename: "dynamics.mnx", group: "Expression and text" },
  { id: "ottavas-8va", title: "Ottavas (8va)", filename: "ottavas-8va.mnx", group: "Expression and text" },
  { id: "slurs", title: "Slurs", filename: "slurs.mnx", group: "Expression and text" },
  { id: "slurs-chords", title: "Slurs for chords", filename: "slurs-chords.mnx", group: "Expression and text" },
  {
    id: "slurs-targeting-specific-notes",
    title: "Slurs targeting notes",
    filename: "slurs-targeting-specific-notes.mnx",
    group: "Expression and text",
  },
  { id: "tempo-markings", title: "Tempo markings", filename: "tempo-markings.mnx", group: "Expression and text" },
  {
    id: "tremolos-multi-note",
    title: "Multi-note tremolos",
    filename: "tremolos-multi-note.mnx",
    group: "Expression and text",
  },
  {
    id: "single-note-tremolos",
    title: "Single-note tremolos",
    filename: "single-note-tremolos.mnx",
    group: "Expression and text",
  },
  {
    id: "lyric-line-metadata",
    title: "Lyric line metadata",
    filename: "lyric-line-metadata.mnx",
    group: "Expression and text",
  },
  { id: "lyrics-basic", title: "Basic lyrics", filename: "lyrics-basic.mnx", group: "Expression and text" },
  {
    id: "lyrics-multi-line",
    title: "Multi-line lyrics",
    filename: "lyrics-multi-line.mnx",
    group: "Expression and text",
  },

  { id: "jumps-ds-al-fine", title: "D.S. al Fine", filename: "jumps-ds-al-fine.mnx", group: "Repeats and navigation" },
  { id: "jumps-dal-segno", title: "Dal Segno", filename: "jumps-dal-segno.mnx", group: "Repeats and navigation" },
  { id: "measure-repeats", title: "Measure repeats", filename: "measure-repeats.mnx", group: "Repeats and navigation" },
  {
    id: "measure-repeats-with-counters",
    title: "Measure repeats with counters",
    filename: "measure-repeats-with-counters.mnx",
    group: "Repeats and navigation",
  },
  { id: "repeats", title: "Repeats", filename: "repeats.mnx", group: "Repeats and navigation" },
  {
    id: "repeats-more-once-repeated",
    title: "Repeats more than once",
    filename: "repeats-more-once-repeated.mnx",
    group: "Repeats and navigation",
  },
  {
    id: "repeats-alternate-endings-advanced",
    title: "Alternate endings, advanced",
    filename: "repeats-alternate-endings-advanced.mnx",
    group: "Repeats and navigation",
  },
  {
    id: "repeats-alternate-endings-simple",
    title: "Alternate endings, simple",
    filename: "repeats-alternate-endings-simple.mnx",
    group: "Repeats and navigation",
  },
  {
    id: "repeats-implied-start-repeat",
    title: "Implied start repeat",
    filename: "repeats-implied-start-repeat.mnx",
    group: "Repeats and navigation",
  },
] as const;

export const publishedExampleFilenames = publishedExamples.map((example) => example.filename);
