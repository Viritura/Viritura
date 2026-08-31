import type { MidiSoundSourceDefinition, PartRoutingDefaults } from "../types";
import { routing } from "./routingDefaults";

export interface InstrumentSoundRule {
  readonly instrumentId: string;
  readonly source: Omit<MidiSoundSourceDefinition, "id">;
  readonly routing: PartRoutingDefaults;
  readonly ensembleLayering?: readonly EnsembleLayerRule[];
}

export interface EnsembleLayerRule {
  readonly source: Omit<MidiSoundSourceDefinition, "id">;
  readonly stageOffset: { readonly x: number; readonly y: number };
}

// These positions and projection distances are a behavior-preserving extraction
// of the established audio ORCHESTRAL_POSITIONS and FAMILY_PROJECTION defaults.
// Keeping them in the profile makes the built-in sound's routing declarative.
const strings = {
  violin: routing("strings", -2, 1, 1),
  viola: routing("strings", 1, 3, 1),
  cello: routing("strings", 2, 1, 1),
  doubleBass: routing("strings", 4, 1, 2),
};
const woodwinds = {
  flute: routing("woodwinds", -0.5, 6, 3),
  oboe: routing("woodwinds", 0.5, 6, 3),
  clarinet: routing("woodwinds", -0.5, 7, 3),
  bassoon: routing("woodwinds", 0.5, 7, 3),
  sopranoSax: routing("woodwinds", -3, 11, 3),
  altoSax: routing("woodwinds", -1, 11, 3),
  tenorSax: routing("woodwinds", 1, 11, 3),
  baritoneSax: routing("woodwinds", 2, 11, 3),
  unseated: routing("woodwinds", 0, 0, 3),
};
const brass = {
  horn: routing("brass", -0.5, 8, 6),
  trumpet: routing("brass", 0.5, 8, 6),
  trombone: routing("brass", 3.5, 8, 6),
  tuba: routing("brass", 6.5, 8, 6),
  unseated: routing("brass", 0, 0, 6),
};
const percussion = {
  unseated: routing("percussion", 0, 0, 6),
  bassDrum: routing("percussion", 3, 11, 6),
  timpani: routing("percussion", 0, 10, 6),
  glockenspiel: routing("percussion", 0, 10.5, 6),
  xylophone: routing("percussion", 0.5, 10.5, 6),
  vibraphone: routing("percussion", -0.5, 10.5, 6),
  marimba: routing("percussion", 1, 10.5, 6),
  tubularBells: routing("percussion", 2, 10.5, 6),
};
const keys = {
  piano: routing("keys", -5, 4, 2),
  celesta: routing("keys", -4, 7, 2),
  organ: routing("keys", 0, 12, 8),
  harp: routing("keys", -5, 6, 2),
  harpsichord: routing("keys", 0, 0, 2),
  other: routing("other", 0, 0, 1),
  bassGuitar: routing("other", 3, 11, 1),
};
const voices = {
  soprano: routing("voices", -3, 11, 5),
  alto: routing("voices", -1, 11, 5),
  tenor: routing("voices", 1, 11, 5),
  baritone: routing("voices", 2, 11, 5),
  catalogBass: routing("other", 3, 11, 1),
};

const midi = (program: number): Omit<MidiSoundSourceDefinition, "id"> => ({ kind: "midi", program });
const drumKit = (drumKitProgram: number): Omit<MidiSoundSourceDefinition, "id"> => ({
  kind: "midi",
  program: 0,
  bankMsb: 128,
  drumKitProgram,
});
const fixedDrum = (fixedMidiNote: number): Omit<MidiSoundSourceDefinition, "id"> => ({
  // Catalog single-drum parts are authored as one-component kits, which the
  // current sampler keeps on the GM Standard kit.
  ...drumKit(0),
  fixedMidiNote,
});

function rules(
  instrumentIds: readonly string[],
  source: Omit<MidiSoundSourceDefinition, "id">,
  defaultRouting: PartRoutingDefaults,
): InstrumentSoundRule[] {
  return instrumentIds.map((instrumentId) => ({ instrumentId, source, routing: defaultRouting }));
}

function soloStringRule(
  instrumentId: string,
  program: number,
  defaultRouting: PartRoutingDefaults,
  ensembleStageOffsets: readonly [
    { readonly x: number; readonly y: number },
    { readonly x: number; readonly y: number },
  ],
): InstrumentSoundRule {
  return {
    instrumentId,
    source: midi(program),
    routing: defaultRouting,
    ensembleLayering: [
      { source: midi(48), stageOffset: ensembleStageOffsets[0] },
      { source: midi(49), stageOffset: ensembleStageOffsets[1] },
    ],
  };
}

/**
 * Playback data for the catalog's canonical IDs. This intentionally records
 * only sound and routing behavior; notation identity remains in InstrumentCatalog.
 */
export const VIRITURA_SOUNDS_INSTRUMENT_RULES: readonly InstrumentSoundRule[] = [
  ...rules(["piccolo"], midi(72), woodwinds.flute),
  ...rules(["flute", "alto-flute"], midi(73), woodwinds.flute),
  ...rules(["oboe"], midi(68), woodwinds.oboe),
  { instrumentId: "english-horn", source: midi(69), routing: woodwinds.oboe },
  ...rules(["bflat-clarinet", "a-clarinet", "eflat-clarinet", "bass-clarinet"], midi(71), woodwinds.clarinet),
  ...rules(["bassoon", "contrabassoon"], midi(70), woodwinds.bassoon),
  ...rules(["soprano-sax"], midi(64), woodwinds.sopranoSax),
  ...rules(["alto-sax"], midi(65), woodwinds.altoSax),
  ...rules(["tenor-sax"], midi(66), woodwinds.tenorSax),
  ...rules(["baritone-sax"], midi(67), woodwinds.baritoneSax),
  ...rules(["recorder"], midi(74), woodwinds.unseated),
  ...rules(["horn"], midi(60), brass.horn),
  ...rules(["trumpet", "c-trumpet"], midi(56), brass.trumpet),
  ...rules(["cornet"], midi(56), brass.unseated),
  ...rules(["flugelhorn"], midi(59), brass.unseated),
  ...rules(["trombone", "bass-trombone"], midi(57), brass.trombone),
  ...rules(["euphonium"], midi(58), brass.unseated),
  ...rules(["tuba"], midi(58), brass.tuba),
  ...rules(["drum-kit"], drumKit(0), percussion.unseated),
  ...rules(["orchestral-percussion"], drumKit(0), percussion.unseated),
  ...rules(["timpani"], midi(47), percussion.timpani),
  ...rules(["snare-drum"], fixedDrum(38), percussion.unseated),
  ...rules(["bass-drum"], fixedDrum(36), percussion.bassDrum),
  ...rules(["cymbals"], fixedDrum(49), percussion.unseated),
  ...rules(["triangle"], fixedDrum(81), percussion.unseated),
  ...rules(["tambourine"], fixedDrum(54), percussion.unseated),
  ...rules(["glockenspiel"], midi(9), percussion.glockenspiel),
  ...rules(["xylophone"], midi(13), percussion.xylophone),
  ...rules(["vibraphone"], midi(11), percussion.vibraphone),
  ...rules(["marimba"], midi(12), percussion.marimba),
  ...rules(["tubular-bells"], midi(14), percussion.tubularBells),
  ...rules(["piano"], midi(0), keys.piano),
  ...rules(["harpsichord"], midi(6), keys.harpsichord),
  ...rules(["celesta"], midi(8), keys.celesta),
  ...rules(["organ"], midi(19), keys.organ),
  ...rules(["accordion"], midi(21), keys.other),
  ...rules(["soprano", "mezzo-soprano"], midi(52), voices.soprano),
  ...rules(["alto-voice"], midi(52), voices.alto),
  ...rules(["tenor-voice"], midi(52), voices.tenor),
  ...rules(["baritone-voice"], midi(52), voices.baritone),
  ...rules(["bass-voice"], midi(52), voices.catalogBass),
  ...rules(["harp"], midi(46), keys.harp),
  ...rules(["guitar", "ukulele", "mandolin"], midi(25), keys.other),
  ...rules(["electric-guitar"], midi(27), keys.other),
  ...rules(["bass-guitar"], midi(33), keys.bassGuitar),
  soloStringRule("violin", 40, strings.violin, [
    { x: 0, y: 1 },
    { x: -1.5, y: 0.5 },
  ]),
  soloStringRule("viola", 41, strings.viola, [
    { x: 0, y: 1 },
    { x: 1.5, y: 0.5 },
  ]),
  soloStringRule("cello", 42, strings.cello, [
    { x: 0, y: 1 },
    { x: 1.5, y: 0.5 },
  ]),
  soloStringRule("double-bass", 43, strings.doubleBass, [
    { x: 0, y: 1.5 },
    { x: 0, y: 3 },
  ]),
];
