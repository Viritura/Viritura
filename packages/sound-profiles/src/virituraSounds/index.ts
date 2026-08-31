import type {
  MidiSoundSourceDefinition,
  PlaybackCapabilities,
  ProfileResolveInput,
  ResolvedPartSound,
  SoundProfile,
  SoundLayeringDefaults,
  SoundSourceId,
  SoundSourceDefinition,
  SourceCatalogEntry,
} from "../types";
import { VIRITURA_SOUNDS_INSTRUMENT_RULES, type EnsembleLayerRule, type InstrumentSoundRule } from "./instrumentRules";
import { resolveLegacySound } from "./legacyFallback";
import { DEFAULT_LISTENER_POSITION } from "./routingDefaults";
import { virituraSoundsSourceId } from "./sourceIds";
import { VIRITURA_SOUNDS_SOURCE_OPTIONS } from "./sourceOptions";

export {
  ORCHESTRA_SECTION_LABELS,
  ORCHESTRA_SECTION_ORDER,
  VIRITURA_SOUNDS_SOURCE_OPTIONS,
  type VirituraSoundsSourceOption,
} from "./sourceOptions";
export { virituraSoundsSourceId } from "./sourceIds";

/** Stable identifier for the built-in compatibility profile. */
export const VIRITURA_SOUNDS_PROFILE_ID = "viritura-sounds";

const MIDI_CAPABILITIES: PlaybackCapabilities = {
  sourceKinds: ["midi"],
  supportsLayeredSources: true,
  supportsProgramChange: true,
  supportsFixedMidiNote: true,
};

const rulesByInstrumentId = new Map<string, InstrumentSoundRule>(
  VIRITURA_SOUNDS_INSTRUMENT_RULES.map((rule) => [rule.instrumentId, rule]),
);

const rulesBySourceId = new Map<SoundSourceId, InstrumentSoundRule>(
  VIRITURA_SOUNDS_INSTRUMENT_RULES.map((rule) => [virituraSoundsSourceId(rule.instrumentId), rule]),
);

function sourceFor(
  instrumentId: string,
  source: Omit<MidiSoundSourceDefinition, "id">,
  suffix: string,
): MidiSoundSourceDefinition {
  return { ...source, id: suffix === "primary" ? virituraSoundsSourceId(instrumentId) : `${instrumentId}-${suffix}` };
}

function isValidMidiProgram(program: number | undefined): program is number {
  return typeof program === "number" && Number.isInteger(program) && program >= 0 && program <= 127;
}

function isSoloStringProgram(program: number): boolean {
  return program >= 40 && program <= 43;
}

function ensembleLayeringFor(rule: InstrumentSoundRule, program: number): readonly EnsembleLayerRule[] | undefined {
  if (program === rule.source.program) return rule.ensembleLayering;
  if (!isSoloStringProgram(program)) return undefined;
  if (rule.instrumentId === "double-bass") {
    return [
      { source: { kind: "midi", program: 48 }, stageOffset: { x: 0, y: 1.5 } },
      { source: { kind: "midi", program: 49 }, stageOffset: { x: 0, y: 3 } },
    ];
  }
  const outward = rule.routing.stagePosition.x >= 0 ? 1.5 : -1.5;
  return [
    { source: { kind: "midi", program: 48 }, stageOffset: { x: 0, y: 1 } },
    { source: { kind: "midi", program: 49 }, stageOffset: { x: outward, y: 0.5 } },
  ];
}

function legacyStringRule(legacyName: string | undefined): InstrumentSoundRule | undefined {
  const name = legacyName?.trim().toLowerCase() ?? "";
  const instrumentId = /\b(contrabass|string bass|double bass)\b/.test(name)
    ? "double-bass"
    : /\b(violoncello|cello)\b/.test(name)
      ? "cello"
      : /\bviolin\b/.test(name)
        ? "violin"
        : /\bviola\b/.test(name)
          ? "viola"
          : undefined;
  return instrumentId ? rulesByInstrumentId.get(instrumentId) : undefined;
}

function resolvedCanonicalSound(args: {
  rule: InstrumentSoundRule;
  notationInstrumentId: string | undefined;
  explicitMidiProgram?: number;
  resolution: "canonical" | "selected" | "explicit" | "legacy";
}): ResolvedPartSound {
  const { rule, notationInstrumentId, explicitMidiProgram, resolution } = args;
  // Existing scores persist an explicit MIDI program. It has always taken
  // precedence over catalog/name lookup for melodic parts, so preserve that
  // behavior until it is migrated to a profile-defined source override.
  const useExplicitProgram = rule.source.bankMsb !== 128 && isValidMidiProgram(explicitMidiProgram);
  const primarySource = useExplicitProgram ? { ...rule.source, program: explicitMidiProgram } : rule.source;
  const ensembleLayering = ensembleLayeringFor(rule, primarySource.program);
  const sources: SoundSourceDefinition[] = [sourceFor(rule.instrumentId, primarySource, "primary")];
  for (let index = 0; index < (ensembleLayering?.length ?? 0); index++) {
    sources.push(sourceFor(rule.instrumentId, ensembleLayering![index]!.source, `layer-${index + 1}`));
  }
  const layering: SoundLayeringDefaults | undefined = ensembleLayering
    ? {
        primaryVolumeRatio: 1 / Math.SQRT2,
        layers: ensembleLayering.map((layer, index) => ({
          sourceId: `${rule.instrumentId}-layer-${index + 1}`,
          volumeRatio: 1 / Math.SQRT2,
          stageOffset: { ...layer.stageOffset },
        })),
      }
    : undefined;
  return {
    profileId: VIRITURA_SOUNDS_PROFILE_ID,
    profileVersion: 1,
    selectedSourceId: virituraSoundsSourceId(rule.instrumentId),
    instrumentId: notationInstrumentId,
    sources,
    routing: {
      ...rule.routing,
      stagePosition: { ...rule.routing.stagePosition },
    },
    capabilities: MIDI_CAPABILITIES,
    layering,
    resolution: useExplicitProgram ? "explicit" : resolution,
  };
}

function resolvedLegacySound(input: ProfileResolveInput): ResolvedPartSound {
  const legacy = resolveLegacySound(input.legacyName, input.explicitMidiProgram, input.hasKit);
  return {
    profileId: VIRITURA_SOUNDS_PROFILE_ID,
    profileVersion: 1,
    selectedSourceId: virituraSoundsSourceId(input.instrumentId ?? "legacy"),
    instrumentId: input.instrumentId,
    sources: [sourceFor(input.instrumentId ?? "legacy", legacy.source, "primary")],
    routing: {
      ...legacy.routing,
      stagePosition: { ...legacy.routing.stagePosition },
    },
    capabilities: MIDI_CAPABILITIES,
    resolution: input.legacyName || input.explicitMidiProgram !== undefined ? "legacy" : "fallback",
  };
}

/**
 * The built-in MIDI/SF2 compatibility profile. Its canonical rules are keyed
 * exclusively by InstrumentCatalog IDs; names are consulted only for old scores.
 */
export const virituraSoundsProfile: SoundProfile = {
  id: VIRITURA_SOUNDS_PROFILE_ID,
  version: 1,
  displayName: "VirituraSounds",
  defaultListenerPosition: DEFAULT_LISTENER_POSITION,
  resolve(input: ProfileResolveInput): ResolvedPartSound | null {
    const selectedRule = input.selectedSourceId ? rulesBySourceId.get(input.selectedSourceId) : undefined;
    if (selectedRule) {
      return resolvedCanonicalSound({
        rule: selectedRule,
        notationInstrumentId: input.instrumentId,
        resolution: "selected",
      });
    }
    if (input.selectedSourceId) return null;
    const notationRule = input.instrumentId ? rulesByInstrumentId.get(input.instrumentId) : undefined;
    const inferredStringRule = input.instrumentId ? undefined : legacyStringRule(input.legacyName);
    return notationRule || inferredStringRule
      ? resolvedCanonicalSound({
          rule: notationRule ?? inferredStringRule!,
          notationInstrumentId: input.instrumentId,
          explicitMidiProgram: input.explicitMidiProgram,
          resolution: notationRule ? "canonical" : "legacy",
        })
      : resolvedLegacySound(input);
  },
  sourceCatalog(): readonly SourceCatalogEntry[] {
    return VIRITURA_SOUNDS_SOURCE_OPTIONS.map((option) => ({
      sourceId: option.sourceId,
      section: option.section,
      label: option.label,
      configured: true,
    }));
  },
};
