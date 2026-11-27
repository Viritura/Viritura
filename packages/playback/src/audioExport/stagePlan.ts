import { DEFAULT_LISTENER_POSITION, type OrchestraSection, type SpatialPosition } from "@viritura/audio";
import { normalizedPartVolume, resolveStagePartLevel, sectionBusGain, type StagePartInput } from "../partLevels";
import { EQ_COLOR_BUS_FILTERS, sectionListenerDistance, sectionPredelaySeconds, sectionReverbSend } from "../mixChain";
import type { ResolvedPlaybackPart } from "../soundProfileRuntime";
import type { AudioPartMix, AudioStage } from "./messages";

/** One orchestra section's shared synth bus, as built by live playback. */
export interface StageSection {
  section: OrchestraSection;
  eqBus: number;
  gain: number;
  reverbSend: number;
  predelaySeconds: number;
}

export interface StagePart {
  sectionIndex: number;
  /** Normalized CC7 level against the section bus gain. */
  volume: number;
  pan: number;
  /** Saved pan per ensemble layer, or null for the layer's default pan. */
  layerPans: readonly (number | null)[];
}

export interface StagePlan {
  sections: StageSection[];
  parts: StagePart[];
}

function validateMix(mix: readonly AudioPartMix[] | undefined, partCount: number): void {
  if (
    mix &&
    (mix.length !== partCount ||
      mix.some(
        (part) =>
          !Number.isFinite(part.volume) || part.volume < 0 || !Number.isFinite(part.pan) || Math.abs(part.pan) > 1,
      ))
  ) {
    throw new Error("The audio mixer settings do not match the document or contain invalid levels.");
  }
}

function validPosition(position: SpatialPosition | null | undefined): SpatialPosition | null {
  return position && Number.isFinite(position.x) && Number.isFinite(position.y) ? position : null;
}

/**
 * Reproduce playback's section routing and per-part levels: parts share one
 * synth per orchestra section, each section feeds an EQ color bus and a
 * distance-scaled reverb send, and part CC7 is relative to the section bus.
 */
export function planStage(
  parts: readonly ResolvedPlaybackPart[],
  mix: readonly AudioPartMix[] | undefined,
  stage: AudioStage | undefined,
): StagePlan {
  validateMix(mix, parts.length);
  const listener = validPosition(stage?.listener) ?? DEFAULT_LISTENER_POSITION;
  const inputs: StagePartInput[] = parts.map((part) => {
    const partMix = mix?.[part.index];
    return {
      position: validPosition(stage?.positions[part.index]) ?? part.position,
      refDistance: part.sound.routing.projectionRefDistance,
      stageDepthEnabled: partMix?.stageDepthEnabled ?? true,
      mixerVolume: partMix ? (partMix.muted ? 0 : partMix.volume) : 1,
      mixerPan: partMix?.pan ?? 0,
    };
  });

  const members = new Map<OrchestraSection, number[]>();
  for (const part of parts) {
    const section = part.sound.routing.section;
    members.set(section, [...(members.get(section) ?? []), part.index]);
  }

  const levels = parts.map((part) =>
    resolveStagePartLevel(
      inputs[part.index]!,
      members.get(part.sound.routing.section)!.map((index) => inputs[index]!),
      listener,
    ),
  );

  const sections: StageSection[] = [];
  const sectionOf = new Map<OrchestraSection, number>();
  for (const [section, indices] of members) {
    const centroid = {
      x: indices.reduce((sum, index) => sum + inputs[index]!.position.x, 0) / indices.length,
      y: indices.reduce((sum, index) => sum + inputs[index]!.position.y, 0) / indices.length,
    };
    const distance = sectionListenerDistance(centroid, listener);
    sectionOf.set(section, sections.length);
    sections.push({
      section,
      eqBus: sections.length % EQ_COLOR_BUS_FILTERS.length,
      gain: sectionBusGain(indices.map((index) => levels[index]!.outputGain)),
      reverbSend: sectionReverbSend(distance),
      predelaySeconds: sectionPredelaySeconds(distance),
    });
  }

  return {
    sections,
    parts: parts.map((part) => {
      const sectionIndex = sectionOf.get(part.sound.routing.section)!;
      const level = levels[part.index]!;
      return {
        sectionIndex,
        volume: normalizedPartVolume(level.outputGain, sections[sectionIndex]!.gain),
        pan: level.pan,
        layerPans: stage?.layerPans[part.index] ?? [],
      };
    }),
  };
}
