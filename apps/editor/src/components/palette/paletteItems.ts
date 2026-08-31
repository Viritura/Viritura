import type { ArticulationType, DynamicValue } from "../../commands/articulationCommands";
import type { OrnamentType, ClefSign, BarlineType } from "@viritura/core";
import { SMUFL } from "./smuflGlyphs";

export interface PaletteItem {
  id: string;
  label: string;
  title: string;
  useBravura?: boolean;
  shortcut?: string;
}

// ═══════════════════════════════════════════
// Shared structural item definitions
// (single source of truth for both palette & radial menu)
// ═══════════════════════════════════════════

export interface ClefPaletteItem {
  id: string;
  label: string;
  shortLabel: string;
  clef: { sign: ClefSign; staffPosition: number; octave?: number; glyph?: string };
}

export const CLEF_PALETTE_ITEMS: ClefPaletteItem[] = [
  { id: "treble", label: "Treble (G)", shortLabel: "Treble", clef: { sign: "G", staffPosition: -2 } },
  { id: "alto", label: "Alto (C)", shortLabel: "Alto", clef: { sign: "C", staffPosition: 0 } },
  { id: "tenor", label: "Tenor (C)", shortLabel: "Tenor", clef: { sign: "C", staffPosition: 2 } },
  { id: "bass", label: "Bass (F)", shortLabel: "Bass", clef: { sign: "F", staffPosition: 2 } },
  {
    id: "percussion",
    label: "Percussion",
    shortLabel: "Perc.",
    clef: { sign: "G", staffPosition: 0, glyph: "unpitchedPercussionClef1" },
  },
  { id: "treble-8vb", label: "Treble 8vb", shortLabel: "G 8vb", clef: { sign: "G", staffPosition: -2, octave: -1 } },
  { id: "treble-15mb", label: "Treble 15mb", shortLabel: "G 15mb", clef: { sign: "G", staffPosition: -2, octave: -2 } },
  { id: "treble-8va", label: "Treble 8va", shortLabel: "G 8va", clef: { sign: "G", staffPosition: -2, octave: 1 } },
  { id: "treble-15ma", label: "Treble 15ma", shortLabel: "G 15ma", clef: { sign: "G", staffPosition: -2, octave: 2 } },
  { id: "bass-8vb", label: "Bass 8vb", shortLabel: "F 8vb", clef: { sign: "F", staffPosition: 2, octave: -1 } },
  { id: "bass-15mb", label: "Bass 15mb", shortLabel: "F 15mb", clef: { sign: "F", staffPosition: 2, octave: -2 } },
  { id: "bass-8va", label: "Bass 8va", shortLabel: "F 8va", clef: { sign: "F", staffPosition: 2, octave: 1 } },
  { id: "bass-15ma", label: "Bass 15ma", shortLabel: "F 15ma", clef: { sign: "F", staffPosition: 2, octave: 2 } },
  { id: "alto-8vb", label: "Alto 8vb", shortLabel: "C 8vb", clef: { sign: "C", staffPosition: 0, octave: -1 } },
];

export interface BarlinePaletteItem {
  id: string;
  label: string;
  barline: { type: BarlineType };
  glyph: string;
}

export const BARLINE_PALETTE_ITEMS: BarlinePaletteItem[] = [
  { id: "regular", label: "Single", barline: { type: "regular" }, glyph: SMUFL.barlineSingle },
  { id: "double", label: "Double", barline: { type: "double" }, glyph: SMUFL.barlineDouble },
  { id: "final", label: "Final", barline: { type: "final" }, glyph: SMUFL.barlineFinal },
  { id: "heavy", label: "Heavy", barline: { type: "heavy" }, glyph: SMUFL.barlineHeavy },
  { id: "dashed", label: "Dashed", barline: { type: "dashed" }, glyph: SMUFL.barlineDotted },
];

export const MEASURE_REPEAT_PALETTE_ITEMS: (PaletteItem & { number: 1 | 2 | 4 })[] = [
  {
    id: "measure-repeat-1",
    number: 1,
    label: SMUFL.repeat1Bar,
    title: "1-bar measure repeat",
    useBravura: true,
  },
  {
    id: "measure-repeat-2",
    number: 2,
    label: SMUFL.repeat2Bars,
    title: "2-bar measure repeat",
    useBravura: true,
  },
  {
    id: "measure-repeat-4",
    number: 4,
    label: SMUFL.repeat4Bars,
    title: "4-bar measure repeat",
    useBravura: true,
  },
];

export interface KeySigPaletteItem {
  id: string;
  label: string;
  shortLabel: string;
  keySig: { fifths: number; atonal?: boolean };
}

export const KEY_SIG_PALETTE_ITEMS: KeySigPaletteItem[] = [
  { id: "0", label: "C major / A minor", shortLabel: "C maj / a min", keySig: { fifths: 0 } },
  { id: "atonal", label: "Atonal (open/keyless)", shortLabel: "Atonal", keySig: { fifths: 0, atonal: true } },
  { id: "1", label: "G major / E minor (1\u266F)", shortLabel: "G maj / e min", keySig: { fifths: 1 } },
  { id: "2", label: "D major / B minor (2\u266F)", shortLabel: "D maj / b min", keySig: { fifths: 2 } },
  { id: "3", label: "A major / F\u266F minor (3\u266F)", shortLabel: "A maj / f\u266F min", keySig: { fifths: 3 } },
  { id: "4", label: "E major / C\u266F minor (4\u266F)", shortLabel: "E maj / c\u266F min", keySig: { fifths: 4 } },
  { id: "5", label: "B major / G\u266F minor (5\u266F)", shortLabel: "B maj / g\u266F min", keySig: { fifths: 5 } },
  {
    id: "6",
    label: "F\u266F major / D\u266F minor (6\u266F)",
    shortLabel: "F\u266F maj / d\u266F min",
    keySig: { fifths: 6 },
  },
  {
    id: "7",
    label: "C\u266F major / A\u266F minor (7\u266F)",
    shortLabel: "C\u266F maj / a\u266F min",
    keySig: { fifths: 7 },
  },
  { id: "-1", label: "F major / D minor (1\u266D)", shortLabel: "F maj / d min", keySig: { fifths: -1 } },
  { id: "-2", label: "B\u266D major / G minor (2\u266D)", shortLabel: "B\u266D maj / g min", keySig: { fifths: -2 } },
  { id: "-3", label: "E\u266D major / C minor (3\u266D)", shortLabel: "E\u266D maj / c min", keySig: { fifths: -3 } },
  { id: "-4", label: "A\u266D major / F minor (4\u266D)", shortLabel: "A\u266D maj / f min", keySig: { fifths: -4 } },
  {
    id: "-5",
    label: "D\u266D major / B\u266D minor (5\u266D)",
    shortLabel: "D\u266D maj / b\u266D min",
    keySig: { fifths: -5 },
  },
  {
    id: "-6",
    label: "G\u266D major / E\u266D minor (6\u266D)",
    shortLabel: "G\u266D maj / e\u266D min",
    keySig: { fifths: -6 },
  },
  {
    id: "-7",
    label: "C\u266D major / A\u266D minor (7\u266D)",
    shortLabel: "C\u266D maj / a\u266D min",
    keySig: { fifths: -7 },
  },
];

export interface TimeSigPaletteItem {
  id: string;
  label: string;
  time: { count: number; unit: number; display?: "common" | "cut" | "senzaMisura" | "note" };
}

export const TIME_SIG_PALETTE_ITEMS: TimeSigPaletteItem[] = [
  { id: "4/4", label: "4/4", time: { count: 4, unit: 4 } },
  { id: "3/4", label: "3/4", time: { count: 3, unit: 4 } },
  { id: "2/4", label: "2/4", time: { count: 2, unit: 4 } },
  { id: "2/2", label: "2/2", time: { count: 2, unit: 2 } },
  { id: "3/8", label: "3/8", time: { count: 3, unit: 8 } },
  { id: "6/8", label: "6/8", time: { count: 6, unit: 8 } },
  { id: "9/8", label: "9/8", time: { count: 9, unit: 8 } },
  { id: "12/8", label: "12/8", time: { count: 12, unit: 8 } },
  { id: "common", label: "Common (C)", time: { count: 4, unit: 4, display: "common" } },
  { id: "cut", label: "Cut (\u20B5)", time: { count: 2, unit: 2, display: "cut" } },
];

export interface OrnamentPaletteItem {
  id: string;
  label: string;
  glyph: string;
  kind: "ornament" | "trill";
  ornament?: OrnamentType;
}

export const ORNAMENT_PALETTE_ITEMS: OrnamentPaletteItem[] = [
  { id: "trill", label: "Trill", glyph: SMUFL.ornamentTrill, kind: "trill" },
  { id: "turn", label: "Turn", glyph: SMUFL.ornamentTurn, kind: "ornament", ornament: "turn" },
  {
    id: "invertedTurn",
    label: "Inverted turn",
    glyph: SMUFL.ornamentInvertedTurn,
    kind: "ornament",
    ornament: "invertedTurn",
  },
  { id: "mordent", label: "Mordent", glyph: SMUFL.ornamentMordent, kind: "ornament", ornament: "mordent" },
  {
    id: "invertedMordent",
    label: "Inverted mordent",
    glyph: SMUFL.ornamentInvertedMordent,
    kind: "ornament",
    ornament: "invertedMordent",
  },
  {
    id: "trillMordent",
    label: "Trill mordent",
    glyph: SMUFL.ornamentTrillMordent,
    kind: "ornament",
    ornament: "trillMordent",
  },
  {
    id: "delayedTurn",
    label: "Delayed turn",
    glyph: SMUFL.ornamentDelayedTurn,
    kind: "ornament",
    ornament: "delayedTurn",
  },
  { id: "schleifer", label: "Schleifer", glyph: SMUFL.ornamentSchleifer, kind: "ornament", ornament: "schleifer" },
];

export const ARTICULATION_ITEMS: (PaletteItem & { articulation: ArticulationType })[] = [
  {
    id: "staccato",
    articulation: "staccato",
    label: SMUFL.articStaccatoAbove,
    title: "Staccato",
    useBravura: true,
    shortcut: "Z",
  },
  {
    id: "accent",
    articulation: "accent",
    label: SMUFL.articAccentAbove,
    title: "Accent",
    useBravura: true,
    shortcut: "C",
  },
  {
    id: "tenuto",
    articulation: "tenuto",
    label: SMUFL.articTenutoAbove,
    title: "Tenuto",
    useBravura: true,
    shortcut: "X",
  },
  {
    id: "marcato",
    articulation: "strongAccent",
    label: SMUFL.articMarcatoAbove,
    title: "Marcato",
    useBravura: true,
    shortcut: "V",
  },
  {
    id: "staccatissimo",
    articulation: "staccatissimo",
    label: SMUFL.articStaccatissimoAbove,
    title: "Staccatissimo",
    useBravura: true,
    shortcut: "B",
  },
  {
    id: "staccatissimo-wedge",
    articulation: "staccatissimoWedge",
    label: SMUFL.articStaccatissimoWedgeAbove,
    title: "Staccatissimo Wedge",
    useBravura: true,
  },
  {
    id: "staccatissimo-stroke",
    articulation: "spiccato",
    label: SMUFL.articStaccatissimoStrokeAbove,
    title: "Staccatissimo Stroke",
    useBravura: true,
  },
  { id: "stress", articulation: "stress", label: SMUFL.articStressAbove, title: "Stress", useBravura: true },
  { id: "unstress", articulation: "unstress", label: SMUFL.articUnstressAbove, title: "Unstress", useBravura: true },
];

export const DYNAMIC_ITEMS: (PaletteItem & { value: DynamicValue })[] = [
  { id: "ppp", value: "ppp", label: SMUFL.dynamicPPP, title: "Pianissimo (ppp)", useBravura: true },
  { id: "pp", value: "pp", label: SMUFL.dynamicPP, title: "Pianissimo (pp)", useBravura: true },
  { id: "p", value: "p", label: SMUFL.dynamicP, title: "Piano (p)", useBravura: true },
  { id: "mp", value: "mp", label: SMUFL.dynamicMP, title: "Mezzo piano (mp)", useBravura: true },
  { id: "mf", value: "mf", label: SMUFL.dynamicMF, title: "Mezzo forte (mf)", useBravura: true },
  { id: "f", value: "f", label: SMUFL.dynamicF, title: "Forte (f)", useBravura: true },
  { id: "ff", value: "ff", label: SMUFL.dynamicFF, title: "Fortissimo (ff)", useBravura: true },
  { id: "fff", value: "fff", label: SMUFL.dynamicFFF, title: "Fortissimo (fff)", useBravura: true },
  { id: "fp", value: "fp", label: SMUFL.dynamicFP, title: "Forte-piano (fp)", useBravura: true },
  { id: "pf", value: "pf", label: SMUFL.dynamicPF, title: "Piano-forte (pf)", useBravura: true },
  { id: "sfz", value: "sfz", label: SMUFL.dynamicSfz, title: "Sforzando (sfz)", useBravura: true },
  { id: "rfz", value: "rfz", label: SMUFL.dynamicRfz, title: "Rinforzando (rfz)", useBravura: true },
  { id: "n", value: "n", label: SMUFL.dynamicNiente, title: "Niente (n)", useBravura: true },
];

export const TUPLET_ITEMS: (PaletteItem & { tupletNumber: number; outerMultiple: number })[] = [
  { id: "tuplet-2", tupletNumber: 2, outerMultiple: 3, label: "2:3", title: "Duplet" },
  { id: "tuplet-3", tupletNumber: 3, outerMultiple: 2, label: "3:2", title: "Triplet", shortcut: "Ctrl+3" },
  { id: "tuplet-4", tupletNumber: 4, outerMultiple: 3, label: "4:3", title: "Quadruplet" },
  { id: "tuplet-5", tupletNumber: 5, outerMultiple: 4, label: "5:4", title: "Quintuplet", shortcut: "Ctrl+5" },
  { id: "tuplet-6", tupletNumber: 6, outerMultiple: 4, label: "6:4", title: "Sextuplet", shortcut: "Ctrl+6" },
  { id: "tuplet-7", tupletNumber: 7, outerMultiple: 4, label: "7:4", title: "Septuplet" },
  { id: "tuplet-8", tupletNumber: 8, outerMultiple: 6, label: "8:6", title: "Octuplet" },
  { id: "tuplet-9", tupletNumber: 9, outerMultiple: 8, label: "9:8", title: "Nonuplet" },
];
