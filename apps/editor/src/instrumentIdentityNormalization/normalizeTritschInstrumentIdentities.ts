import { walkSequenceEvents, type LayoutContent, type Part, type Score, type Sound } from "@viritura/core";
import { VIRITURA_SOUNDS_PROFILE_ID, virituraSoundsSourceId } from "@viritura/sound-profiles";

interface InstrumentPolicy {
  readonly partId: string;
  readonly acceptedNames: readonly string[];
  readonly name: string;
  readonly shortName: string;
  readonly instrumentId: string;
  readonly midiProgram: number;
  readonly family: string;
}

const TRITSCH_INSTRUMENTS: readonly InstrumentPolicy[] = [
  policy("P1", ["Flauto", "Flute"], "Flute", "Fl.", "flute", 73, "woodwinds"),
  policy("P2-1", ["Oboe 1"], "Oboe 1", "Ob. 1", "oboe", 68, "woodwinds"),
  policy("P2-2", ["Oboe 2"], "Oboe 2", "Ob. 2", "oboe", 68, "woodwinds"),
  policy("P3-1", ["Clarinet in B♭ 1"], "Clarinet in B♭ 1", "Cl. 1", "bflat-clarinet", 71, "woodwinds"),
  policy("P3-2", ["Clarinet in B♭ 2"], "Clarinet in B♭ 2", "Cl. 2", "bflat-clarinet", 71, "woodwinds"),
  policy("P4-1", ["Bassoon 1"], "Bassoon 1", "Bsn. 1", "bassoon", 70, "woodwinds"),
  policy("P4-2", ["Bassoon 2"], "Bassoon 2", "Bsn. 2", "bassoon", 70, "woodwinds"),
  policy("P5-1", ["Horn in F 1"], "Horn in F 1", "Hn. 1", "horn", 60, "brass"),
  policy("P5-2", ["Horn in F 2"], "Horn in F 2", "Hn. 2", "horn", 60, "brass"),
  policy("P6-1", ["Trumpet in Bb 1", "Trumpet in B♭ 1"], "Trumpet in B♭ 1", "Tpt. 1", "trumpet", 56, "brass"),
  policy("P6-2", ["Trumpet in Bb 2", "Trumpet in B♭ 2"], "Trumpet in B♭ 2", "Tpt. 2", "trumpet", 56, "brass"),
  policy("P7-1", ["Trombone 1"], "Trombone 1", "Tbn. 1", "trombone", 57, "brass"),
  policy("P7-2", ["Trombone 2"], "Trombone 2", "Tbn. 2", "trombone", 57, "brass"),
  policy("P7-3", ["Trombone 3"], "Trombone 3", "Tbn. 3", "trombone", 57, "brass"),
  policy("P8", ["Timpani in E.A.", "Timpani"], "Timpani", "Timp.", "timpani", 47, "percussion"),
  policy("P9", ["Grancassa", "Bass Drum"], "Bass Drum", "B.Dr.", "bass-drum", 0, "percussion"),
  policy("P10", ["Triangolo", "Triangle"], "Triangle", "Tri.", "triangle", 0, "percussion"),
  policy("P11", ["Piatti", "Cymbals"], "Cymbals", "Cym.", "cymbals", 0, "percussion"),
  policy("P12", ["Violino I", "Violin 1"], "Violin 1", "Vln. 1", "violin", 40, "strings"),
  policy("P13", ["Violino II", "Violin 2"], "Violin 2", "Vln. 2", "violin", 40, "strings"),
  policy("P14", ["Viola"], "Viola", "Vla.", "viola", 41, "strings"),
  policy("P15", ["Violoncello", "Cello"], "Cello", "Vc.", "cello", 42, "strings"),
  policy("P16", ["Basso", "Double Bass"], "Double Bass", "D.B.", "double-bass", 43, "strings"),
];

const PERCUSSION = [
  {
    partId: "P9",
    componentId: "P9-kit-0",
    componentName: "Bass Drum",
    soundName: "Bass Drum",
    soundId: "snd-bass-drum-36",
    midiNumber: 36,
    notehead: "normal" as const,
  },
  {
    partId: "P10",
    componentId: "P10-kit-0",
    componentName: "Triangle",
    soundName: "Open Triangle",
    soundId: "snd-triangle-81",
    midiNumber: 81,
    notehead: "x" as const,
  },
  {
    partId: "P11",
    componentId: "P11-kit-0",
    componentName: "Cymbals",
    soundName: "Crash Cymbal 1",
    soundId: "snd-cymbals-49",
    midiNumber: 49,
    notehead: "x" as const,
  },
] as const;

function policy(
  partId: string,
  acceptedNames: readonly string[],
  name: string,
  shortName: string,
  instrumentId: string,
  midiProgram: number,
  family: string,
): InstrumentPolicy {
  return { partId, acceptedNames, name, shortName, instrumentId, midiProgram, family };
}

/** Normalize the known 23-part Tritsch split score without mutating the input. */
export function normalizeTritschInstrumentIdentities(score: Score): Score {
  validateTritschRoster(score);
  const result = structuredClone(score);

  for (const instrument of TRITSCH_INSTRUMENTS) {
    const part = requirePart(result, instrument.partId);
    part.name = instrument.name;
    part.shortName = instrument.shortName;
    part._x = {
      ...part._x,
      viritura: {
        ...part._x?.viritura,
        instrumentId: instrument.instrumentId,
        midiProgram: instrument.midiProgram,
        family: instrument.family,
      },
    };
  }

  normalizePercussion(result);
  validatePercussionReferences(result);
  result.soundProfile = {
    profileId: VIRITURA_SOUNDS_PROFILE_ID,
    profileVersion: 1,
    parts: Object.fromEntries(
      TRITSCH_INSTRUMENTS.map((instrument) => [
        instrument.partId,
        { sourceId: virituraSoundsSourceId(instrument.instrumentId) },
      ]),
    ),
  };
  updateExtractedScoreNames(result);
  return result;
}

function validateTritschRoster(score: Score): void {
  const actualIds = score.parts.map((part) => part.id);
  const expectedIds = TRITSCH_INSTRUMENTS.map((instrument) => instrument.partId);
  if (actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) {
    throw new Error("The open score is not the expected 23-part Tritsch split roster.");
  }
  for (const instrument of TRITSCH_INSTRUMENTS) {
    const part = requirePart(score, instrument.partId);
    if (!instrument.acceptedNames.includes(part.name)) {
      throw new Error(`Part ${instrument.partId} has unexpected name: ${part.name}`);
    }
    const identity = part._x?.viritura?.instrumentId;
    if (identity !== undefined && identity !== instrument.instrumentId) {
      throw new Error(`Part ${instrument.partId} has conflicting instrument identity: ${identity}`);
    }
  }
  for (const percussion of PERCUSSION) {
    const part = requirePart(score, percussion.partId);
    if (!part.kit?.[percussion.componentId]) {
      throw new Error(`Part ${percussion.partId} is missing kit component ${percussion.componentId}.`);
    }
  }
  if (requirePart(score, "P8").kit !== undefined) {
    throw new Error("Part P8 must remain pitched percussion without a kit.");
  }
}

function normalizePercussion(score: Score): void {
  const sounds = { ...score.global.sounds };
  for (const percussion of PERCUSSION) {
    const part = requirePart(score, percussion.partId);
    const component = part.kit![percussion.componentId]!;
    const sound: Sound = { name: percussion.soundName, midiNumber: percussion.midiNumber };
    const soundId = allocateSoundId(sounds, percussion.soundId, sound);
    sounds[soundId] = sound;
    part.kit = {
      ...part.kit,
      [percussion.componentId]: {
        ...component,
        name: percussion.componentName,
        sound: soundId,
        notehead: percussion.notehead,
      },
    };
  }
  const referencedSounds = new Set(
    score.parts.flatMap((part) => Object.values(part.kit ?? {}).flatMap((component) => component.sound ?? [])),
  );
  score.global.sounds = Object.fromEntries(Object.entries(sounds).filter(([soundId]) => referencedSounds.has(soundId)));
}

function allocateSoundId(sounds: Record<string, Sound>, preferredId: string, desired: Sound): string {
  for (let suffix = 1; ; suffix += 1) {
    const candidate = suffix === 1 ? preferredId : `${preferredId}-${String(suffix)}`;
    const existing = sounds[candidate];
    if (existing === undefined || (existing.name === desired.name && existing.midiNumber === desired.midiNumber)) {
      return candidate;
    }
  }
}

function validatePercussionReferences(score: Score): void {
  for (const part of score.parts) {
    for (const [componentId, component] of Object.entries(part.kit ?? {})) {
      if (component.sound && !score.global.sounds?.[component.sound]) {
        throw new Error(`Kit component ${componentId} references missing sound ${component.sound}.`);
      }
    }
    for (const measure of part.measures) {
      for (const sequence of measure.sequences) {
        for (const { event } of walkSequenceEvents(sequence.content)) {
          for (const kitNote of event.kitNotes ?? []) {
            if (!part.kit?.[kitNote.kitComponent]) {
              throw new Error(
                `Part ${part.id ?? "(unknown)"} references missing kit component ${kitNote.kitComponent}.`,
              );
            }
          }
        }
      }
    }
  }
}

function updateExtractedScoreNames(score: Score): void {
  const layouts = new Map((score.layouts ?? []).map((layout) => [layout.id, layout]));
  const names = new Map(score.parts.map((part) => [part.id, part.name]));
  for (const definition of score.scores ?? []) {
    const layout = definition.layout ? layouts.get(definition.layout) : undefined;
    if (!layout) continue;
    const partIds = collectPartIds(layout.content);
    if (partIds.size !== 1) continue;
    const partName = names.get([...partIds][0]);
    if (partName) definition.name = partName;
  }
}

function collectPartIds(content: readonly LayoutContent[]): Set<string> {
  const ids = new Set<string>();
  for (const node of content) {
    if (node.type === "group") {
      for (const id of collectPartIds(node.content)) ids.add(id);
    } else {
      for (const source of node.sources) ids.add(source.part);
    }
  }
  return ids;
}

function requirePart(score: Score, partId: string): Part {
  const part = score.parts.find((candidate) => candidate.id === partId);
  if (!part) throw new Error(`Missing expected part ${partId}.`);
  return part;
}
