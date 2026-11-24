/**
 * partLevels — pure functions for recomputing section gain and per-part
 * CC7/CC10 from spatial geometry + mixer state.
 *
 * Extracted from PlaybackProvider so they can live as plain functions
 * (no forward-declared ref pattern). All state is passed in via a
 * `PartLevelRefs` bag — each call reads the latest ref values.
 */

import type { ISampler, OrchestraSection, SpatialNode, SpatialPosition } from "@viritura/audio";
import { PAN_RANGE, panCompensation, proximityVolume } from "./playbackReducer";

// ═══════════════════════════════════════════
// Spatial gain bounds + combined audibility floor
// ═══════════════════════════════════════════

/** Section GainNode bounds (absolute level), capped to protect the limiter. */
const SECTION_GAIN_MIN = 0.4;
const SECTION_GAIN_MAX = 1.5;

/**
 * Combined audibility floor.
 *
 * A voice's perceived loudness is the PRODUCT of two independent axes:
 *   dynamics  = velGain(velocity) × CC11/127     (the composer's intent)
 *   spatial   = CC7/127 × sectionGain            (the physical render)
 *
 * Since the coupled-dynamics work, CC11 spans ~30 dB (18→127), so a soft
 * dynamic is now a real multiplicative attenuation — and multiplied by full
 * spatial attenuation (a distant section, a back-desk part) a soft, far part
 * could fall below audibility. We floor the COMBINED result: the spatial
 * geometric product (sectionGain × relProx) is bounded so that, even at the
 * softest dynamic (`SOFT_DYNAMIC_REF`), the total stays above `MIN_AUDIBLE_GAIN`.
 * Louder dynamics only raise the product, so nothing ever vanishes regardless of
 * seating. The floor is distributed into the per-part relProx (→ CC7) because
 * sectionGain is shared across the section. Tunable by ear.
 */
const MIN_AUDIBLE_GAIN = 0.02; // ≈ −34 dB combined floor
const SOFT_DYNAMIC_REF = 0.07; // pp coupled loudness ≈ velGain(52) × 50/127
/** Floor on the spatial geometric product (sectionGain × relProx). ≈ 0.29. */
const SPATIAL_GEOM_FLOOR = MIN_AUDIBLE_GAIN / SOFT_DYNAMIC_REF;

/** Clamp a section's proximity to the protected GainNode range. */
export function sectionGainTarget(maxProx: number): number {
  return Math.max(SECTION_GAIN_MIN, Math.min(SECTION_GAIN_MAX, maxProx));
}

/**
 * Floor the per-part spatial geometric product (sectionGain × relProx) so the
 * combined dynamics × spatial loudness can't drop below audibility. sectionGain
 * is shared by the section, so the floor is realised by lifting the per-part
 * relProx (which becomes CC7). Returns the (possibly lifted) relProx, ≤ 1.
 */
export function flooredRelProx(relProx: number, sectionGain: number): number {
  if (sectionGain <= 0) return relProx;
  if (sectionGain * relProx >= SPATIAL_GEOM_FLOOR) return relProx;
  return Math.min(1, SPATIAL_GEOM_FLOOR / sectionGain);
}

/** Resolve per-part depth attenuation. Stereo mode deliberately bypasses Y-distance attenuation. */
export function partDepthGain(
  stageDepthEnabled: boolean,
  proximity: number,
  sectionMaxProximity: number,
  sectionGain: number,
): number {
  if (!stageDepthEnabled) return 1;
  const relativeProximity = sectionMaxProximity > 0 ? proximity / sectionMaxProximity : 1;
  return flooredRelProx(relativeProximity, sectionGain);
}

/** Compose absolute section proximity and relative part depth, or bypass both in Stereo mode. */
export function partSpatialGain(stageDepthEnabled: boolean, sectionGain: number, depthGain: number): number {
  return stageDepthEnabled ? sectionGain * depthGain : 1;
}

/** Resolve the continuous post-sampler gain for one part. */
export function webPartOutputGain(mixerGain: number, spatialGain: number, panGain: number): number {
  return Math.max(0, mixerGain * spatialGain * panGain);
}

/**
 * Normalize one part against its section peak and invert SoundFont's standard
 * CC7 concave attenuation curve (rendered amplitude = controller²).
 */
export function normalizedPartVolume(outputGain: number, sectionPeak: number): number {
  if (outputGain <= 0 || sectionPeak <= 0) return 0;
  const linearRatio = Math.max(0, Math.min(1, outputGain / sectionPeak));
  return Math.max(1 / 0x3fff, Math.sqrt(linearRatio));
}

/** One part's seat and mixer state as seen by the stage level resolver. */
export interface StagePartInput {
  position: SpatialPosition;
  refDistance: number;
  stageDepthEnabled: boolean;
  /** Mixer gain, already 0 when muted. */
  mixerVolume: number;
  mixerPan: number;
}

export interface StagePartLevel {
  outputGain: number;
  pan: number;
  basePan: number;
}

/**
 * Resolve a part's continuous output gain and pan from listener geometry and
 * mixer state. `sectionMembers` lists the section's seated parts (including
 * this one), or is null when the part has no orchestra section.
 *
 * Combines:
 *   - per-part proximity (relative to section max so the section gain
 *     handles absolute level and CC7 handles per-part balance inside it)
 *   - pan compensation (restores the equal-power loss when pan centers)
 *   - mixer volume / mute
 *   - mixer pan offset
 */
export function resolveStagePartLevel(
  part: StagePartInput,
  sectionMembers: readonly StagePartInput[] | null,
  listener: SpatialPosition,
): StagePartLevel {
  const proximity = (p: StagePartInput) =>
    proximityVolume(Math.hypot(p.position.x - listener.x, p.position.y - listener.y), p.refDistance);
  const prox = proximity(part);
  let spatialGain = 1;
  if (part.stageDepthEnabled) {
    // The section GainNode supplies the absolute level for the loudest
    // member, so per-part CC7 = relative loudness within the section.
    let sectionMax = prox;
    for (const member of sectionMembers ?? []) {
      if (member.stageDepthEnabled) sectionMax = Math.max(sectionMax, proximity(member));
    }
    const secGain = sectionMembers ? sectionGainTarget(sectionMax) : 1;
    spatialGain = partSpatialGain(true, secGain, partDepthGain(true, prox, sectionMax, secGain));
  }
  const basePan = Math.max(-1, Math.min(1, (part.position.x - listener.x) / PAN_RANGE));
  const pan = Math.max(-1, Math.min(1, basePan + part.mixerPan));
  const outputGain = webPartOutputGain(part.mixerVolume, spatialGain, panCompensation(pan));
  return { outputGain, pan, basePan };
}

/** The shared section bus level: its loudest member, or unity when all are silent. */
export function sectionBusGain(memberGains: Iterable<number>): number {
  let peak = 0;
  for (const gain of memberGains) peak = Math.max(peak, gain);
  return peak > 0 ? peak : 1;
}

/** Refs the level-recompute functions read from. Bundled to avoid a 10-arg
 *  signature; PlaybackProvider passes its own ref objects in. */
export interface PartLevelRefs {
  audioCtxRef: { current: AudioContext | null };
  samplersRef: { current: Map<number, ISampler> };
  spatialNodesRef: { current: Map<number, SpatialNode> };
  sectionSynthsRef: {
    current: Map<
      OrchestraSection,
      {
        gainNode: GainNode;
        reverbSend: GainNode | null;
        predelay: DelayNode | null;
        position: SpatialPosition;
        refDistance: number;
        parts: { index: number }[];
      }
    >;
  };
  listenerPosRef: { current: SpatialPosition };
  partRefDistRef: { current: Map<number, number> };
  partSectionRef: { current: Map<number, OrchestraSection> };
  basePanRef: { current: Map<number, number> };
  mixerPanRef: { current: Map<number, number> };
  mixerVolumeRef: { current: Map<number, number> };
  stageDepthEnabledRef: { current: Map<number, boolean> };
}

/**
 * Normalize a shared section bus to its loudest current member. Per-channel
 * gain is then encoded as a 14-bit CC7 ratio against this continuous gain,
 * preserving both cascaded boosts and low-level resolution.
 */
export function recomputeSectionGain(section: OrchestraSection, refs: PartLevelRefs): void {
  const entry = refs.sectionSynthsRef.current.get(section);
  if (!entry) return;
  const target = sectionBusGain(entry.parts.map((part) => resolvePartLevel(part.index, refs).outputGain));
  // CC7 ratios are updated synchronously immediately after this. Keep the
  // shared normalization gain on the same timeline so channels cannot spike
  // or dip while a previous gain target is still converging.
  const ctx = refs.audioCtxRef.current;
  if (ctx) {
    entry.gainNode.gain.cancelScheduledValues(ctx.currentTime);
    entry.gainNode.gain.setValueAtTime(target, ctx.currentTime);
  } else {
    entry.gainNode.gain.value = target;
  }
}

/** Re-normalize a section and refresh every member's relative 14-bit channel volume. */
export function applySectionLevels(section: OrchestraSection, refs: PartLevelRefs): void {
  recomputeSectionGain(section, refs);
  const entry = refs.sectionSynthsRef.current.get(section);
  if (!entry) return;
  for (const part of entry.parts) {
    applyPartLevel(part.index, refs);
  }
}

/**
 * Recompute a single part's CC7 (volume) and CC10 (pan) from listener
 * geometry + mixer state. See `resolveStagePartLevel`.
 */
export function applyPartLevel(partIndex: number, refs: PartLevelRefs): void {
  const sampler = refs.samplersRef.current.get(partIndex);
  if (!sampler) return;
  const resolved = resolvePartLevel(partIndex, refs);
  const section = refs.partSectionRef.current.get(partIndex);
  const sectionGain = section ? sectionPeakGain(section, refs) : 1;
  const normalizedVolume = normalizedPartVolume(resolved.outputGain, sectionGain);

  if ("setVolume" in sampler) (sampler as { setVolume(v: number): void }).setVolume(normalizedVolume);
  if ("setPan" in sampler) (sampler as { setPan(p: number): void }).setPan(resolved.pan);
}

function stagePartInput(partIndex: number, node: SpatialNode, refs: PartLevelRefs): StagePartInput {
  return {
    position: node.getPosition(),
    refDistance: refs.partRefDistRef.current.get(partIndex) ?? 1,
    stageDepthEnabled: refs.stageDepthEnabledRef.current.get(partIndex) ?? true,
    mixerVolume: refs.mixerVolumeRef.current.get(partIndex) ?? 1,
    mixerPan: refs.mixerPanRef.current.get(partIndex) ?? 0,
  };
}

function resolvePartLevel(partIndex: number, refs: PartLevelRefs): { outputGain: number; pan: number } {
  const node = refs.spatialNodesRef.current.get(partIndex);
  if (!node) return { outputGain: 0, pan: 0 };
  const section = refs.partSectionRef.current.get(partIndex);
  let members: StagePartInput[] | null = null;
  if (section) {
    members = [];
    for (const p of refs.sectionSynthsRef.current.get(section)?.parts ?? []) {
      const memberNode = refs.spatialNodesRef.current.get(p.index);
      if (memberNode) members.push(stagePartInput(p.index, memberNode, refs));
    }
  }
  const level = resolveStagePartLevel(stagePartInput(partIndex, node, refs), members, refs.listenerPosRef.current);
  refs.basePanRef.current.set(partIndex, level.basePan);
  return { outputGain: level.outputGain, pan: level.pan };
}

function sectionPeakGain(section: OrchestraSection, refs: PartLevelRefs): number {
  const entry = refs.sectionSynthsRef.current.get(section);
  if (!entry) return 1;
  return sectionBusGain(entry.parts.map((part) => resolvePartLevel(part.index, refs).outputGain));
}
