export interface ConversionCoverageItem {
  name: string;
  description: string;
}

export const VIRITURA_EXTENSION_COVERAGE: readonly ConversionCoverageItem[] = [
  {
    name: "Trills, mordents, and turns",
    description: "Trills and supported mordent/turn variants are preserved as rendered ornament extensions.",
  },
  { name: "Caesuras", description: "Grand-pause marks are preserved on events." },
  {
    name: "Arpeggiate",
    description: "Rolled-chord markings and their direction are preserved on chord events.",
  },
  { name: "Rehearsal marks", description: "Rehearsal letters and numbers are preserved above the system." },
  { name: "Text expressions", description: "Performance text such as dolce and espressivo is preserved." },
  { name: "Pedal markings", description: "Sustain and sostenuto pedal spans are preserved." },
  { name: "Fingerings", description: "Numeric fingerings from 0 through 5 are preserved." },
  {
    name: "Score metadata",
    description: "Titles, creators, work details, and movement details are preserved.",
  },
  {
    name: "Glissando and slide",
    description: "Paired straight and wavy lines, including text labels, are preserved and rendered.",
  },
  {
    name: "Chord symbols",
    description: "Common qualities, extensions, alterations, slash bass, and rhythmic position are preserved.",
  },
  {
    name: "Coda",
    description: "Coda position, SMuFL glyph, and color are preserved as a rendered navigation marker.",
  },
];

export const SUPPORTED_TARGET_IMPORT_GAPS: readonly ConversionCoverageItem[] = [
  {
    name: "Advanced chord-symbol details",
    description:
      "MusicXML kinds outside Viritura's quality model, degree alterations, and fretboard frames are not imported yet.",
  },
  {
    name: "Font and element styling",
    description:
      "Colors are preserved for keys, clefs, endings, grace groups, segnos, and codas; fonts and other element colors are not.",
  },
];

export const LIMITED_MUSICXML_COVERAGE: readonly ConversionCoverageItem[] = [
  { name: "Shake ornament", description: "Dropped; the importer has no shake mapping." },
  { name: "Figured bass", description: "Dropped; no MNX or Viritura conversion target is implemented." },
  {
    name: "Other technical notation",
    description:
      "Harmonics, open strings, plucks, and other technical marks are not imported. Bow directions and fingerings are handled separately.",
  },
  { name: "Guitar bends", description: "Dropped; no conversion target is implemented." },
  { name: "Stemless and double stems", description: "MusicXML stem values none and double are dropped." },
];
