import type { Score } from "@viritura/core";
import {
  LayeredSampler,
  OfflineSf2Synth,
  SamplerGroup,
  Sf2Sampler,
  type ISampler,
  type MidiEvent,
} from "@viritura/audio";
import { instrumentSamplerKey } from "@viritura/midi";
import {
  applyDetuneSpread,
  drumKitProgramForSource,
  fixedMidiNoteForPart,
  selectDrumKitProgram,
} from "../playbackSamplerHelpers";
import { profileLayerPan } from "../mixChain";
import { requireSf2Sound, type ResolvedPlaybackPart } from "../soundProfileRuntime";
import type { AudioPartMix } from "./messages";
import type { StagePart } from "./stagePlan";

interface LaneSeat {
  /** The part's default stage x, which seeds ensemble layer pans in playback. */
  defaultX: number;
  stage: StagePart;
  ensembleEnabled: boolean;
}

function makeLaneSampler(
  synth: OfflineSf2Synth,
  resolved: ResolvedPlaybackPart,
  drumKitProgram: number,
  seat: LaneSeat,
): ISampler {
  const { part } = resolved;
  const sound = requireSf2Sound(part.name, resolved.sf2);
  const isKit = !!part.kit && Object.keys(part.kit).length > 0;
  const fixedNote = fixedMidiNoteForPart(part, sound.primary.fixedMidiNote);
  const alternateKits = isKit
    ? [
        ...new Set(
          Object.values(part.kit!).flatMap((component) => (component.drumKit === undefined ? [] : [component.drumKit])),
        ),
      ]
    : [];
  const channels = synth.allocateChannels(1 + alternateKits.length + sound.layers.length);
  const altKitChannels = new Map(alternateKits.map((program, index) => [program, channels[index + 1]!]));
  const primary = new Sf2Sampler(synth, channels[0]!, sound.primary.program, {
    fixedMidiNote: fixedNote,
    isDrum: sound.primary.bankMsb === 128 || fixedNote !== undefined,
    drumKitProgram: drumKitProgramForSource(sound.primary, drumKitProgram),
    altKitChannels,
  });
  const { volume, pan } = seat.stage;
  if (sound.layers.length === 0) {
    primary.setVolume(volume);
    primary.setPan(pan);
    return primary;
  }

  const layers = sound.layers.map((layer, index) => ({
    sampler: new Sf2Sampler(synth, channels[1 + alternateKits.length + index]!, layer.source.program),
    baselineProgram: layer.source.program,
    volumeRatio: layer.defaults.volumeRatio,
  }));
  const sampler = new LayeredSampler(primary, layers, sound.primaryVolumeRatio, sound.primary.program);
  sampler.setVolume(volume);
  sampler.setPan(pan);
  sound.layers.forEach((layer, index) => {
    sampler.setLayerEnabled(index, seat.ensembleEnabled);
    sampler.setLayerPan(
      index,
      seat.stage.layerPans[index] ?? profileLayerPan(seat.defaultX, layer.defaults.stageOffset.x),
    );
  });
  return sampler;
}

function group(samplers: ISampler[]): ISampler {
  return samplers.length === 1 ? samplers[0]! : new SamplerGroup(samplers);
}

/** Build every lane's sampler on its section's synth, leveled as in playback. */
export function createOfflineSamplers(
  score: Score,
  parts: readonly ResolvedPlaybackPart[],
  events: readonly MidiEvent[],
  sectionSynths: readonly OfflineSf2Synth[],
  stage: readonly StagePart[],
  mix?: readonly AudioPartMix[],
): Map<number | string, ISampler> {
  const routing = new Map<number | string, ISampler>();
  const partSamplers = new Map<number, ISampler>();
  const drumKitProgram = selectDrumKitProgram(score.parts);

  for (const part of parts) {
    const lanes = new Set(
      events.flatMap((event) =>
        event.partIndex === part.index && event.playbackLaneId !== undefined ? [event.playbackLaneId] : [],
      ),
    );
    if (lanes.size === 0) lanes.add(`part:${part.index}`);
    const variants = part.instruments ?? [{ key: "initial", resolved: part }];
    const partStage = stage[part.index]!;
    const synth = sectionSynths[partStage.sectionIndex]!;
    const seat: LaneSeat = {
      defaultX: part.position.x,
      stage: partStage,
      ensembleEnabled: mix?.[part.index]?.ensembleEnabled ?? true,
    };
    const laneSamplers: ISampler[] = [];
    for (const lane of lanes) {
      const variantSamplers = variants.map((variant) => {
        const sampler = makeLaneSampler(synth, variant.resolved, drumKitProgram, seat);
        if (part.instruments) routing.set(instrumentSamplerKey(lane, variant.key), sampler);
        return sampler;
      });
      const laneSampler = group(variantSamplers);
      routing.set(lane, laneSampler);
      laneSamplers.push(laneSampler);
    }
    const partSampler = group(laneSamplers);
    routing.set(part.index, partSampler);
    partSamplers.set(part.index, partSampler);
  }
  applyDetuneSpread(parts, partSamplers);
  return routing;
}
