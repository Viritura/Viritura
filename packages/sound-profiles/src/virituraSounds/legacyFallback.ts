import type { MidiSoundSourceDefinition, PartRoutingDefaults } from "../types";
import { FALLBACK_ROUTING, routing } from "./routingDefaults";

interface LegacyResolution {
  readonly source: Omit<MidiSoundSourceDefinition, "id">;
  readonly routing: PartRoutingDefaults;
}

const LEGACY_PROGRAMS: readonly [readonly string[], number][] = [
  [["contrabassoon", "bassoon", "bn", "bsn"], 70],
  [["bass clarinet", "clarinet", "cl"], 71],
  [["english horn", "cor anglais"], 69],
  [["french horn", "horn", "hn"], 60],
  [["bass trombone", "trombone", "tbn"], 57],
  [["double bass", "contrabass", "string bass", "cb", "db"], 43],
  [["violoncello", "cello", "vcl", "vc"], 42],
  [["violin", "vln"], 40],
  [["viola", "vla"], 41],
  [["glockenspiel", "glock"], 9],
  [["tubular bells", "chimes", "tub. bells"], 14],
  [["xylophone", "xyl"], 13],
  [["vibraphone", "vib"], 11],
  [["marimba", "mar"], 12],
  [["timpani", "timp"], 47],
  [["flugelhorn"], 59],
  [["trumpet", "cornet", "tpt"], 56],
  [["tuba"], 58],
  [["euphonium"], 58],
  [["piccolo", "picc"], 72],
  [["flute", "fl"], 73],
  [["oboe", "ob"], 68],
  [["recorder"], 74],
  [["soprano sax"], 64],
  [["alto sax"], 65],
  [["tenor sax"], 66],
  [["baritone sax"], 67],
  [["piano", "pno", "pf"], 0],
  [["harpsichord"], 6],
  [["celesta", "cel"], 8],
  [["organ", "org"], 19],
  [["accordion"], 21],
  [["harp", "hp"], 46],
  [["electric guitar"], 27],
  [["guitar"], 25],
  [["electric bass"], 33],
  [["acoustic bass"], 32],
  [["bass"], 52],
  [["soprano", "alto", "tenor", "baritone", "choir", "voice"], 52],
];

const FIXED_DRUMS: readonly [RegExp, number][] = [
  [/^bass\s*drum\b/i, 36],
  [/^snare\s*drum\b/i, 38],
  [/^crash\s*cymbal\b/i, 49],
  [/^ride\s*cymbal\b/i, 51],
  [/^hi[-\s]*hat\b/i, 42],
  [/^triangle\b/i, 81],
  [/^tambourine\b/i, 54],
  [/^cowbell\b/i, 56],
  [/^woodblock\b/i, 76],
  [/^claves\b/i, 75],
  [/^tom(?:\s*\d+)?\b/i, 47],
];

const ORCHESTRAL_PERCUSSION_RE =
  /\b(timpani|kettle\s*drum|concert\s*(bass\s*drum|snare|cymbal)|suspended\s*cymbal|crash\s*cymbal|tam[- ]?tam|gong|triangle|tubular\s*bell|chimes|glockenspiel|xylophone|vibraphone|marimba|wood\s*block|tambourine|castanet|sleigh\s*bell|orchestral\s*percussion|percussion)\b/i;

const LEGACY_ROUTING_RULES: readonly [RegExp, PartRoutingDefaults][] = [
  [/violin ii/i, routing("strings", -1, 3, 1)],
  [/violin/i, routing("strings", -2, 1, 1)],
  [/viola/i, routing("strings", 1, 3, 1)],
  [/cello/i, routing("strings", 2, 1, 1)],
  [/contrabass(?!oon)|double bass/i, routing("strings", 4, 1, 2)],
  [/soprano sax/i, routing("woodwinds", -3, 11, 3)],
  [/alto sax/i, routing("woodwinds", -1, 11, 3)],
  [/tenor sax/i, routing("woodwinds", 1, 11, 3)],
  [/baritone sax/i, routing("woodwinds", 2, 11, 3)],
  [/flute|piccolo/i, routing("woodwinds", -0.5, 6, 3)],
  [/oboe|english horn/i, routing("woodwinds", 0.5, 6, 3)],
  [/clarinet/i, routing("woodwinds", -0.5, 7, 3)],
  [/bassoon/i, routing("woodwinds", 0.5, 7, 3)],
  [/recorder/i, routing("woodwinds", 0, 0, 3)],
  [/french horn|\bhorn\b/i, routing("brass", -0.5, 8, 6)],
  [/trumpet/i, routing("brass", 0.5, 8, 6)],
  [/trombone/i, routing("brass", 3.5, 8, 6)],
  [/tuba/i, routing("brass", 6.5, 8, 6)],
  [/cornet|flugelhorn|euphonium/i, routing("brass", 0, 0, 6)],
  [/timpani/i, routing("percussion", 0, 10, 6)],
  [/glockenspiel/i, routing("percussion", 0, 10.5, 6)],
  [/xylophone/i, routing("percussion", 0.5, 10.5, 6)],
  [/vibraphone/i, routing("percussion", -0.5, 10.5, 6)],
  [/marimba/i, routing("percussion", 1, 10.5, 6)],
  [/tubular|chimes/i, routing("percussion", 2, 10.5, 6)],
  [/bass drum/i, routing("percussion", 3, 11, 6)],
  [/percussion|snare|cymbal|triangle|tam[- ]?tam|gong|drum kit|drums?\b|tambourine/i, routing("percussion", 0, 0, 6)],
  [/piano/i, routing("keys", -5, 4, 2)],
  [/celesta/i, routing("keys", -4, 7, 2)],
  [/organ/i, routing("keys", 0, 12, 8)],
  [/harp/i, routing("keys", -5, 6, 2)],
  [/harpsichord/i, routing("keys", 0, 0, 2)],
  [/choir/i, routing("voices", 0, 11, 5)],
  [/chorus/i, routing("voices", 0, 0, 5)],
  [/soprano/i, routing("voices", -3, 11, 5)],
  [/alto/i, routing("voices", -1, 11, 5)],
  [/tenor/i, routing("voices", 1, 11, 5)],
  [/baritone/i, routing("voices", 2, 11, 5)],
  [/bass voice/i, routing("voices", 3, 11, 5)],
  [/bass/i, routing("other", 3, 11, 1)],
];

function legacyRouting(name: string): PartRoutingDefaults {
  return LEGACY_ROUTING_RULES.find(([pattern]) => pattern.test(name))?.[1] ?? FALLBACK_ROUTING;
}

function midi(program: number): Omit<MidiSoundSourceDefinition, "id"> {
  return { kind: "midi", program };
}

/** Preserve the current name-driven audio behavior for legacy or unrecognized parts. */
export function resolveLegacySound(
  legacyName: string | undefined,
  explicitMidiProgram: number | undefined,
  hasKit: boolean | undefined,
): LegacyResolution {
  const name = legacyName?.trim() ?? "";
  const stripped = name.replace(/\s+\d+$/, "").trim();
  const fixedDrum = FIXED_DRUMS.find(([pattern]) => pattern.test(stripped));
  if (fixedDrum) {
    return {
      source: {
        kind: "midi",
        program: 0,
        bankMsb: 128,
        drumKitProgram: !hasKit && ORCHESTRAL_PERCUSSION_RE.test(name) ? 48 : 0,
        fixedMidiNote: fixedDrum[1],
      },
      routing: legacyRouting(name),
    };
  }
  if (hasKit) {
    return {
      source: { kind: "midi", program: 0, bankMsb: 128, drumKitProgram: 0 },
      routing: legacyRouting(name),
    };
  }
  if (
    typeof explicitMidiProgram === "number" &&
    Number.isInteger(explicitMidiProgram) &&
    explicitMidiProgram >= 0 &&
    explicitMidiProgram <= 127
  ) {
    return { source: midi(explicitMidiProgram), routing: legacyRouting(name) };
  }
  const lower = name.toLowerCase();
  for (const [aliases, program] of LEGACY_PROGRAMS) {
    if (aliases.some((alias) => lower.includes(alias))) return { source: midi(program), routing: legacyRouting(name) };
  }
  return { source: midi(0), routing: legacyRouting(name) };
}
