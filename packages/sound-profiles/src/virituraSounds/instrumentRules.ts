import type { MidiSoundSourceDefinition, PartRoutingDefaults } from "../types";
import { routing } from "./routingDefaults";

export interface InstrumentSoundRule {
  readonly instrumentId: string;
  readonly label: string;
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
  instruments: readonly (readonly [instrumentId: string, label: string])[],
  source: Omit<MidiSoundSourceDefinition, "id">,
  defaultRouting: PartRoutingDefaults,
): InstrumentSoundRule[] {
  return instruments.map(([instrumentId, label]) => ({ instrumentId, label, source, routing: defaultRouting }));
}

function soloStringRule(
  instrumentId: string,
  label: string,
  program: number,
  defaultRouting: PartRoutingDefaults,
  ensembleStageOffsets: readonly [
    { readonly x: number; readonly y: number },
    { readonly x: number; readonly y: number },
  ],
): InstrumentSoundRule {
  return {
    instrumentId,
    label,
    source: midi(program),
    routing: defaultRouting,
    ensembleLayering: [
      { source: midi(48), stageOffset: ensembleStageOffsets[0] },
      { source: midi(49), stageOffset: ensembleStageOffsets[1] },
    ],
  };
}

/**
 * Playback data for the catalog's MusicXML standard sound IDs. This intentionally records
 * only sound and routing behavior; notation identity remains in InstrumentCatalog.
 */
export const VIRITURA_SOUNDS_INSTRUMENT_RULES: readonly InstrumentSoundRule[] = [
  ...rules([["wind.flutes.flute.piccolo", "Piccolo"]], midi(72), woodwinds.flute),
  ...rules(
    [
      ["wind.flutes.flute", "Flute"],
      ["wind.flutes.flute.alto", "Alto Flute"],
    ],
    midi(73),
    woodwinds.flute,
  ),
  ...rules([["wind.reed.oboe", "Oboe"]], midi(68), woodwinds.oboe),
  { instrumentId: "wind.reed.english-horn", label: "English Horn", source: midi(69), routing: woodwinds.oboe },
  ...rules(
    [
      ["wind.reed.clarinet.bflat", "Clarinet in B♭"],
      ["wind.reed.clarinet.a", "Clarinet in A"],
      ["wind.reed.clarinet.eflat", "Clarinet in E♭"],
      ["wind.reed.clarinet.bass", "Bass Clarinet"],
    ],
    midi(71),
    woodwinds.clarinet,
  ),
  ...rules(
    [
      ["wind.reed.bassoon", "Bassoon"],
      ["wind.reed.contrabassoon", "Contrabassoon"],
    ],
    midi(70),
    woodwinds.bassoon,
  ),
  ...rules([["wind.reed.saxophone.soprano", "Soprano Saxophone"]], midi(64), woodwinds.sopranoSax),
  ...rules([["wind.reed.saxophone.alto", "Alto Saxophone"]], midi(65), woodwinds.altoSax),
  ...rules([["wind.reed.saxophone.tenor", "Tenor Saxophone"]], midi(66), woodwinds.tenorSax),
  ...rules([["wind.reed.saxophone.baritone", "Baritone Saxophone"]], midi(67), woodwinds.baritoneSax),
  ...rules([["wind.flutes.recorder", "Recorder"]], midi(74), woodwinds.unseated),
  ...rules([["brass.french-horn", "Horn"]], midi(60), brass.horn),
  ...rules(
    [
      ["brass.trumpet.bflat", "Trumpet in B♭"],
      ["brass.trumpet.c", "Trumpet in C"],
    ],
    midi(56),
    brass.trumpet,
  ),
  ...rules([["brass.cornet", "Cornet"]], midi(56), brass.unseated),
  ...rules([["brass.flugelhorn", "Flugelhorn"]], midi(59), brass.unseated),
  ...rules(
    [
      ["brass.trombone", "Trombone"],
      ["brass.trombone.bass", "Bass Trombone"],
    ],
    midi(57),
    brass.trombone,
  ),
  ...rules([["brass.euphonium", "Euphonium"]], midi(58), brass.unseated),
  ...rules([["brass.tuba", "Tuba"]], midi(58), brass.tuba),
  ...rules([["drum.group.set", "Drum Kit"]], drumKit(0), percussion.unseated),
  ...rules([["drum.group", "Orchestral Percussion"]], drumKit(0), percussion.unseated),
  ...rules([["drum.timpani", "Timpani"]], midi(47), percussion.timpani),
  ...rules([["drum.snare-drum", "Snare Drum"]], fixedDrum(38), percussion.unseated),
  ...rules([["drum.bass-drum", "Bass Drum"]], fixedDrum(36), percussion.bassDrum),
  ...rules([["metal.cymbal.clash", "Cymbals"]], fixedDrum(49), percussion.unseated),
  ...rules([["metal.triangle", "Triangle"]], fixedDrum(81), percussion.unseated),
  ...rules([["drum.tambourine", "Tambourine"]], fixedDrum(54), percussion.unseated),
  ...rules([["pitched-percussion.glockenspiel", "Glockenspiel"]], midi(9), percussion.glockenspiel),
  ...rules([["pitched-percussion.xylophone", "Xylophone"]], midi(13), percussion.xylophone),
  ...rules([["pitched-percussion.vibraphone", "Vibraphone"]], midi(11), percussion.vibraphone),
  ...rules([["pitched-percussion.marimba", "Marimba"]], midi(12), percussion.marimba),
  ...rules([["pitched-percussion.tubular-bells", "Tubular Bells"]], midi(14), percussion.tubularBells),
  ...rules([["keyboard.piano", "Piano"]], midi(0), keys.piano),
  ...rules([["keyboard.harpsichord", "Harpsichord"]], midi(6), keys.harpsichord),
  ...rules([["keyboard.celesta", "Celesta"]], midi(8), keys.celesta),
  ...rules([["keyboard.organ", "Organ"]], midi(19), keys.organ),
  ...rules([["keyboard.accordion", "Accordion"]], midi(21), keys.other),
  ...rules(
    [
      ["voice.soprano", "Soprano"],
      ["voice.mezzo-soprano", "Mezzo-soprano"],
    ],
    midi(52),
    voices.soprano,
  ),
  ...rules([["voice.alto", "Alto"]], midi(52), voices.alto),
  ...rules([["voice.tenor", "Tenor"]], midi(52), voices.tenor),
  ...rules([["voice.baritone", "Baritone"]], midi(52), voices.baritone),
  ...rules([["voice.bass", "Bass"]], midi(52), voices.catalogBass),
  ...rules([["pluck.harp", "Harp"]], midi(46), keys.harp),
  ...rules(
    [
      ["pluck.guitar", "Guitar"],
      ["pluck.ukulele", "Ukulele"],
      ["pluck.mandolin", "Mandolin"],
    ],
    midi(25),
    keys.other,
  ),
  ...rules([["pluck.guitar.electric", "Electric Guitar"]], midi(27), keys.other),
  ...rules([["pluck.bass.electric", "Bass Guitar"]], midi(33), keys.bassGuitar),
  soloStringRule("strings.violin", "Violin", 40, strings.violin, [
    { x: 0, y: 1 },
    { x: -1.5, y: 0.5 },
  ]),
  soloStringRule("strings.viola", "Viola", 41, strings.viola, [
    { x: 0, y: 1 },
    { x: 1.5, y: 0.5 },
  ]),
  soloStringRule("strings.cello", "Cello", 42, strings.cello, [
    { x: 0, y: 1 },
    { x: 1.5, y: 0.5 },
  ]),
  soloStringRule("strings.contrabass", "Double Bass", 43, strings.doubleBass, [
    { x: 0, y: 1.5 },
    { x: 0, y: 3 },
  ]),
];
