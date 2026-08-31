/**
 * playbackSamplerHelpers — pure helpers cleaved out of
 * `createSamplersForScore` so that giant useCallback isn't a 380-line,
 * complexity-47 monster.
 *
 * Each helper is referentially transparent given its arguments. Anything
 * that touches PlaybackProvider refs stays inline in PlaybackContext.tsx.
 */

import type { Part } from "@viritura/core";
import type { ISampler, OrchestraSection, ReverbEngine, SpatialPosition } from "@viritura/audio";
import {
  DRUM_KIT_STANDARD,
  DRUM_KIT_ORCHESTRA,
  unpitchedDrumForPartName,
  gmProgramName,
  Sf2Synth,
  Sf2Sampler,
  LayeredSampler,
  SamplerGroup,
  SpatialNode,
  DEFAULT_LISTENER_POSITION,
} from "@viritura/audio";
import { PAN_RANGE, type PartPatchInfo } from "./playbackReducer";
import { type ResolvedPlaybackPart, type Sf2Layer, requireSf2Sound } from "./soundProfileRuntime";

/** A configured kit provides its own MIDI key for every component. */
export function fixedMidiNoteForPart(part: Part, profileFixedMidiNote: number | undefined): number | undefined {
  return part.kit && Object.keys(part.kit).length > 0 ? undefined : profileFixedMidiNote;
}

// ═══════════════════════════════════════════
// EQ color buses
// ═══════════════════════════════════════════

/**
 * A single EQ color bus: an input GainNode followed by 0–N BiquadFilters
 * routed into the master output. Used to give different orchestral
 * sections subtly distinct tonal colors without paying for per-part EQ.
 */
export interface EqColorBus {
  readonly input: GainNode;
  readonly filters: BiquadFilterNode[];
}

/**
 * Build the four standard EQ color buses (neutral / bright / warm / nasal)
 * and route them into `masterOut`. Disconnects any nodes in `oldBuses`
 * before returning the new array so callers can swap atomically.
 *
 * Bus 0: Neutral (passthrough)
 * Bus 1: Slightly bright   — high-shelf +1.5 dB @ 3 kHz
 * Bus 2: Slightly warm     — low-shelf +1 dB @ 300 Hz, high-shelf −1 dB @ 4 kHz
 * Bus 3: Slightly nasal    — peaking +2 dB @ 1.2 kHz, Q 1.5
 */
export function buildEqColorBuses(
  ctx: AudioContext,
  masterOut: AudioNode,
  oldBuses: readonly EqColorBus[],
): EqColorBus[] {
  for (const old of oldBuses) {
    for (const f of old.filters) {
      try {
        f.disconnect();
      } catch {
        /* node already torn down */
      }
    }
    try {
      old.input.disconnect();
    } catch {
      /* node already torn down */
    }
  }

  const buses: EqColorBus[] = [];

  // Bus 0 — neutral
  {
    const input = ctx.createGain();
    input.connect(masterOut);
    buses.push({ input, filters: [] });
  }
  // Bus 1 — bright
  {
    const input = ctx.createGain();
    const hs = ctx.createBiquadFilter();
    hs.type = "highshelf";
    hs.frequency.value = 3000;
    hs.gain.value = 1.5;
    input.connect(hs);
    hs.connect(masterOut);
    buses.push({ input, filters: [hs] });
  }
  // Bus 2 — warm
  {
    const input = ctx.createGain();
    const ls = ctx.createBiquadFilter();
    ls.type = "lowshelf";
    ls.frequency.value = 300;
    ls.gain.value = 1.0;
    const hs = ctx.createBiquadFilter();
    hs.type = "highshelf";
    hs.frequency.value = 4000;
    hs.gain.value = -1.0;
    input.connect(ls);
    ls.connect(hs);
    hs.connect(masterOut);
    buses.push({ input, filters: [ls, hs] });
  }
  // Bus 3 — nasal
  {
    const input = ctx.createGain();
    const pk = ctx.createBiquadFilter();
    pk.type = "peaking";
    pk.frequency.value = 1200;
    pk.gain.value = 2.0;
    pk.Q.value = 1.5;
    input.connect(pk);
    pk.connect(masterOut);
    buses.push({ input, filters: [pk] });
  }

  return buses;
}

// ═══════════════════════════════════════════
// Drum kit selection
// ═══════════════════════════════════════════

/**
 * Regex matching part names that look like orchestral concert percussion.
 * Used to pick the GS Orchestra drum kit over the Standard rock kit.
 */
const ORCHESTRAL_PERC_RE =
  /\b(timpani|kettle\s*drum|concert\s*(bass\s*drum|snare|cymbal)|suspended\s*cymbal|crash\s*cymbal|tam[- ]?tam|gong|triangle|tubular\s*bell|chimes|glockenspiel|xylophone|vibraphone|marimba|wood\s*block|tambourine|castanet|sleigh\s*bell|orchestral\s*percussion|percussion)\b/i;

/** Regex matching part names that look like a drum-set/kit aggregate. */
const DRUM_KIT_RE = /\bdrum\s*(set|kit)\b|^drums?$/i;

/**
 * Pick the GS drum-kit program (Standard or Orchestra) that best matches
 * the percussion parts in the score.
 *
 * Heuristic: if at least one percussion part is orchestral AND none are
 * drum kits, use Orchestra. Otherwise default to Standard.
 *
 * A part with an explicit user-configured `kit` is authored against the GM
 * Standard percussion map — its components carry GM keys (snare 38, crash 49,
 * …) plus optional per-component `drumKit` overrides for borrowed sounds. Such
 * a part must therefore stay on the Standard kit: switching it to Orchestra
 * remaps keys 41–53 to chromatic timpani, so an intended crash/tom would sound
 * a timpani note. The Orchestra kit is reserved for fixed-drum orchestral parts
 * (named e.g. "Timpani") that have no configured kit.
 *
 * TODO(orchestra+drumset): when a score contains BOTH orchestral
 * percussion AND a drum-set part, they currently share one percussion
 * synth + channel 9 and only one kit can be active at a time. Today this
 * falls back to Standard in that case (drum set wins). To support
 * orchestral writing alongside a drum kit, give each percussion part its
 * own synth instance — each carries its own active kit on channel 9.
 * Defer until a real score needs it.
 */
export function selectDrumKitProgram(scoreParts: readonly Part[]): number {
  const percParts = scoreParts.filter((p) => {
    const isKit = !!p.kit && Object.keys(p.kit).length > 0;
    const isFixedDrum = unpitchedDrumForPartName(p.name) !== null;
    return isKit || isFixedDrum;
  });
  if (percParts.length === 0) return DRUM_KIT_STANDARD;

  // A configured kit (authored against the GM Standard map) behaves like a
  // drum set for kit-selection purposes — it must not flip the base kit to
  // Orchestra.
  const anyConfiguredKit = percParts.some((p) => !!p.kit && Object.keys(p.kit).length > 0);
  const anyDrumSet = percParts.some((p) => DRUM_KIT_RE.test(p.name));
  const anyOrchestral = percParts.some((p) => ORCHESTRAL_PERC_RE.test(p.name));
  if (!anyDrumSet && !anyConfiguredKit && anyOrchestral) {
    console.log(`[Audio] Loading Orchestra drum kit (bank 128 pgm 48) for percussion section`);
    return DRUM_KIT_ORCHESTRA;
  }
  return DRUM_KIT_STANDARD;
}

/** Prefer a profile-defined percussion kit over the score-wide legacy heuristic. */
export function drumKitProgramForSource(
  primary: { readonly bankMsb?: number; readonly fixedMidiNote?: number; readonly drumKitProgram?: number },
  legacyDrumKitProgram: number,
): number | undefined {
  const isPercussion = primary.bankMsb === 128 || primary.fixedMidiNote !== undefined;
  return isPercussion ? (primary.drumKitProgram ?? legacyDrumKitProgram) : undefined;
}

// ═══════════════════════════════════════════
// Per-program detune spread (unison de-phasing)
// ═══════════════════════════════════════════

/**
 * Apply per-part micro-detuning so unisons (e.g. 4 horns on the same note)
 * sound like distinct players rather than producing phase artefacts.
 * Parts sharing the same GM program are spread symmetrically across
 * ±DETUNE_SPREAD_CENTS.
 */
export function applyDetuneSpread(
  resolvedParts: readonly ResolvedPlaybackPart[],
  samplers: ReadonlyMap<number, ISampler>,
): void {
  const DETUNE_SPREAD_CENTS = 3;

  const programGroups = new Map<number, number[]>();
  for (const resolved of resolvedParts) {
    if (resolved.sf2.kind !== "supported") continue;
    const gm = resolved.sf2.primary.program;
    const group = programGroups.get(gm) ?? [];
    group.push(resolved.index);
    programGroups.set(gm, group);
  }

  for (const group of programGroups.values()) {
    if (group.length < 2) continue;
    for (let j = 0; j < group.length; j++) {
      const sampler = samplers.get(group[j]!);
      if (!sampler || !("setDetune" in sampler)) continue;
      // Spread evenly: e.g. for 4 parts → -3, -1, +1, +3 cents
      const t = (j / (group.length - 1)) * 2 - 1; // -1 to +1
      const cents = t * DETUNE_SPREAD_CENTS;
      (sampler as { setDetune(c: number): void }).setDetune(cents);
    }
  }
}

// ═══════════════════════════════════════════
// Warm-up
// ═══════════════════════════════════════════

/** USABLE_CHANNELS minus the drum channel (9). */
const USABLE_MELODIC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15] as const;

/**
 * Section synth shape consumed by `warmUpSectionSynths`. Kept structural
 * so PlaybackContext.tsx can pass its richer entries without an explicit
 * type assertion.
 */
interface WarmUpableSection {
  channelsUsed: number;
  synths: readonly { warmUp(channels: number[]): Promise<void> }[];
}

/**
 * Warm up every section synth by playing a brief silent note on every
 * channel we plan to use. This forces each AudioWorklet to drain its
 * postMessage queue (preset selection, drum kit setup, SoundBank lookup)
 * and prime the sample-resolution path so the first real noteOn doesn't
 * race the worklet's message processing.
 *
 * Without this, the first noteOn on a fresh synth can drop the note or
 * play the default piano preset — which presents to the user as
 * instruments starting late or on the wrong sound when they hit Play
 * immediately after page load.
 */
export async function warmUpSectionSynths(sectionSynths: Iterable<WarmUpableSection>): Promise<void> {
  const warmUps: Promise<void>[] = [];
  for (const entry of sectionSynths) {
    for (let synthIndex = 0; synthIndex < entry.synths.length; synthIndex++) {
      const firstSlot = synthIndex * USABLE_MELODIC_CHANNELS.length;
      const slotCount = Math.min(USABLE_MELODIC_CHANNELS.length, Math.max(0, entry.channelsUsed - firstSlot));
      const used = USABLE_MELODIC_CHANNELS.slice(0, slotCount);
      warmUps.push(entry.synths[synthIndex]!.warmUp([...used]));
    }
  }
  await Promise.all(warmUps);
}

// ═══════════════════════════════════════════
// Section synth construction
// ═══════════════════════════════════════════

/**
 * One section-pooled SF2 synth and its routing (gain / reverb send /
 * pre-delay). Multiple instrument parts in the same orchestra section
 * share one synth to keep per-context AudioWorklet count under control.
 */
export interface SectionEntry {
  synth: Sf2Synth;
  synths: Sf2Synth[];
  context: AudioContext;
  sf2Buffer: ArrayBuffer;
  gainNode: GainNode;
  reverbSend: GainNode | null;
  predelay: DelayNode | null;
  position: SpatialPosition;
  refDistance: number;
  channelsUsed: number;
  parts: { index: number }[];
}

/** Per-part info needed to build a section's centroid/projection. */
export interface SectionPartInfo {
  index: number;
  name: string;
  pos: SpatialPosition;
  refDistance: number;
}

/** Group parts by orchestra section, attaching their spatial positions. */
export function groupPartsBySection(
  resolvedParts: readonly ResolvedPlaybackPart[],
): Map<OrchestraSection, SectionPartInfo[]> {
  const map = new Map<OrchestraSection, SectionPartInfo[]>();
  for (const resolved of resolvedParts) {
    const section = resolved.sound.routing.section;
    const group = map.get(section) ?? [];
    group.push({
      index: resolved.index,
      name: resolved.part.name,
      pos: resolved.position,
      refDistance: resolved.sound.routing.projectionRefDistance,
    });
    map.set(section, group);
  }
  return map;
}

/**
 * Build one section synth (gain, reverb send, pre-delay, Sf2Synth) sized
 * for its centroid and projection. The caller chooses which EQ color bus
 * to route into.
 */
async function buildOneSectionSynth(args: {
  ctx: AudioContext;
  sf2Buffer: ArrayBuffer;
  parts: readonly SectionPartInfo[];
  eqBusInput: AudioNode;
  reverb: ReverbEngine | null;
  listenerPos: SpatialPosition;
}): Promise<SectionEntry> {
  const { ctx, sf2Buffer, parts, eqBusInput, reverb, listenerPos } = args;
  const cx = parts.reduce((s, p) => s + p.pos.x, 0) / parts.length;
  const cy = parts.reduce((s, p) => s + p.pos.y, 0) / parts.length;
  const refDist = Math.max(...parts.map((p) => p.refDistance));

  const gainNode = ctx.createGain();
  const dist = Math.sqrt((cx - listenerPos.x) ** 2 + (cy - listenerPos.y) ** 2);
  gainNode.gain.value = dist <= refDist ? 1 : refDist / dist;
  gainNode.connect(eqBusInput);

  let reverbSend: GainNode | null = null;
  let predelay: DelayNode | null = null;
  if (reverb) {
    const sendLevel = Math.max(0.05, Math.min(0.9, 0.05 + dist * 0.075));
    reverbSend = reverb.createSend(sendLevel);
    predelay = ctx.createDelay(0.1);
    predelay.delayTime.value = Math.min(0.04, dist * 0.003);
    gainNode.connect(predelay);
    predelay.connect(reverbSend);
  }

  const synth = await Sf2Synth.create(ctx, sf2Buffer);
  synth.outputNode.connect(gainNode);

  return {
    synth,
    synths: [synth],
    context: ctx,
    sf2Buffer,
    gainNode,
    reverbSend,
    predelay,
    position: { x: cx, y: cy },
    refDistance: refDist,
    channelsUsed: 0,
    parts: [],
  };
}

/**
 * Build a section synth for every orchestra section represented in the
 * score. EQ color buses are assigned round-robin so adjacent sections get
 * subtly distinct tonal colors.
 */
export async function buildSectionSynths(args: {
  ctx: AudioContext;
  sf2Buffer: ArrayBuffer;
  sectionParts: ReadonlyMap<OrchestraSection, readonly SectionPartInfo[]>;
  eqBuses: readonly EqColorBus[];
  reverb: ReverbEngine | null;
  listenerPos: SpatialPosition;
}): Promise<Map<OrchestraSection, SectionEntry>> {
  const { ctx, sf2Buffer, sectionParts, eqBuses, reverb, listenerPos } = args;
  const out = new Map<OrchestraSection, SectionEntry>();
  let sectionCounter = 0;
  for (const [section, parts] of sectionParts) {
    const eqBus = eqBuses[sectionCounter % eqBuses.length]!;
    sectionCounter++;
    const entry = await buildOneSectionSynth({
      ctx,
      sf2Buffer,
      parts,
      eqBusInput: eqBus.input,
      reverb,
      listenerPos,
    });
    out.set(section, entry);
  }
  return out;
}

/**
 * Build a section synth on demand when a part's section wasn't part of
 * the initial sectionParts map. Routes the gain straight to masterOut
 * (no EQ-color bus) since lazy sections are an exceptional path.
 */
async function buildLazySectionSynth(args: {
  ctx: AudioContext;
  masterOut: AudioNode;
  sf2Buffer: ArrayBuffer;
  defaultPos: SpatialPosition;
  refDistance: number;
  reverb: ReverbEngine | null;
}): Promise<SectionEntry> {
  const { ctx, masterOut, sf2Buffer, defaultPos, refDistance, reverb } = args;
  const gainNode = ctx.createGain();
  gainNode.connect(masterOut);
  let reverbSend: GainNode | null = null;
  let predelay: DelayNode | null = null;
  if (reverb) {
    reverbSend = reverb.createSend(0.25);
    predelay = ctx.createDelay(0.1);
    predelay.delayTime.value = 0;
    gainNode.connect(predelay);
    predelay.connect(reverbSend);
  }
  const synth = await Sf2Synth.create(ctx, sf2Buffer);
  synth.outputNode.connect(gainNode);
  return {
    synth,
    synths: [synth],
    context: ctx,
    sf2Buffer,
    gainNode,
    reverbSend,
    predelay,
    position: { x: defaultPos.x, y: defaultPos.y },
    refDistance,
    channelsUsed: 0,
    parts: [],
  };
}

/** Allocate contiguous channels from a section's shared SF2 synth. */
async function allocateSectionChannels(
  sectionEntry: SectionEntry,
  usableChannels: readonly number[],
  count: number,
): Promise<{ synth: Sf2Synth; channels: number[] }> {
  if (count > usableChannels.length) throw new Error(`A playback lane requires ${count} synth channels`);
  let slot = sectionEntry.channelsUsed;
  const localSlot = slot % usableChannels.length;
  if (localSlot + count > usableChannels.length) {
    slot += usableChannels.length - localSlot;
  }
  sectionEntry.channelsUsed = slot + count;
  const synthIndex = Math.floor(slot / usableChannels.length);
  while (sectionEntry.synths.length <= synthIndex) {
    const synth = await Sf2Synth.create(sectionEntry.context, sectionEntry.sf2Buffer);
    synth.outputNode.connect(sectionEntry.gainNode);
    sectionEntry.synths.push(synth);
  }
  return {
    synth: sectionEntry.synths[synthIndex]!,
    channels: Array.from({ length: count }, (_, index) => usableChannels[(slot + index) % usableChannels.length]!),
  };
}

async function buildProfileLayered(args: {
  primarySampler: Sf2Sampler;
  synth: Sf2Synth;
  layers: readonly Sf2Layer[];
  layerChannels: readonly number[];
  primaryVolumeRatio: number;
  defaultPos: SpatialPosition;
}): Promise<LayeredSampler> {
  const { primarySampler, synth, layers, layerChannels, primaryVolumeRatio, defaultPos } = args;
  const layerSamplers = layers.map((layer, index) => ({
    sampler: new Sf2Sampler(synth, layerChannels[index]!, layer.source.program),
    volumeRatio: layer.defaults.volumeRatio,
  }));
  const layered = new LayeredSampler(primarySampler, layerSamplers, primaryVolumeRatio);

  // Apply profile layer pans so stereo spread works even
  // without SpatialBridge (e.g. playing from editor view).
  const lx = DEFAULT_LISTENER_POSITION.x;
  for (let l = 0; l < layers.length; l++) {
    const childX = defaultPos.x + layers[l]!.defaults.stageOffset.x;
    layered.setLayerPan(l, Math.max(-1, Math.min(1, (childX - lx) / PAN_RANGE)));
  }
  return layered;
}

// ═══════════════════════════════════════════
// Per-part sampler processing
// ═══════════════════════════════════════════

/**
 * Refs bundle written to during per-part sampler creation. Threaded as
 * one parameter so the helper signature stays under max-params.
 */
export interface PartSamplerRefs {
  samplers: Map<number, ISampler>;
  spatialNodes: Map<number, SpatialNode>;
  sectionSynths: Map<OrchestraSection, SectionEntry>;
  partSection: Map<number, OrchestraSection>;
  partRefDist: Map<number, number>;
  basePan: Map<number, number>;
  mixerVolume: Map<number, number>;
}

/**
 * Create the per-part sampler and routing for one part: spatial node,
 * (possibly lazy) section synth, percussion classification, profile-defined
 * Sf2Sampler layers, and all per-part ref entries.
 * Pushes the resulting patch info into `patches`.
 */
export async function createPartSampler(args: {
  partIndex: number;
  resolved: ResolvedPlaybackPart;
  ctx: AudioContext;
  masterOut: AudioNode;
  sf2Buffer: ArrayBuffer | null;
  drumKitProgram: number;
  usableChannels: readonly number[];
  reverb: ReverbEngine | null;
  refs: PartSamplerRefs;
  laneIds: readonly string[];
  routingSamplers: Map<number | string, ISampler>;
  patches: PartPatchInfo[];
}): Promise<void> {
  const {
    partIndex: i,
    resolved,
    ctx,
    masterOut,
    sf2Buffer,
    drumKitProgram,
    usableChannels,
    reverb,
    refs,
    laneIds,
    routingSamplers,
    patches,
  } = args;
  const { part, position: defaultPos, sound, sf2 } = resolved;

  // Per-part spatial node (for canvas visualization)
  const spatial = new SpatialNode(ctx, { refDistance: sound.routing.projectionRefDistance });
  refs.spatialNodes.set(i, spatial);
  spatial.setPosition(defaultPos.x, defaultPos.y);

  if (!sf2Buffer) return;

  const supportedSf2 = requireSf2Sound(part.name, sf2);

  const section = sound.routing.section;
  let sectionEntry = refs.sectionSynths.get(section);
  if (!sectionEntry) {
    console.warn(`[Audio] Section synth missing for "${section}" (part "${part.name}"); building lazily.`);
    sectionEntry = await buildLazySectionSynth({
      ctx,
      masterOut,
      sf2Buffer,
      defaultPos,
      refDistance: sound.routing.projectionRefDistance,
      reverb,
    });
    refs.sectionSynths.set(section, sectionEntry);
  }

  // Percussion vs melodic channel selection
  const isKit = !!part.kit && Object.keys(part.kit).length > 0;
  // A configured kit supplies its own MIDI key per kit component through the
  // timeline. `fixedMidiNote` is only for a one-sound unpitched part such as
  // Bass Drum; applying it to a kit turns every component into that one sound.
  const fixedDrum = fixedMidiNoteForPart(part, supportedSf2.primary.fixedMidiNote);
  const isPercussion = supportedSf2.primary.bankMsb === 128 || fixedDrum !== undefined;
  const gmProgram = supportedSf2.primary.program;
  const laneSamplers: ISampler[] = [];
  const altPrograms = isKit
    ? [...new Set(Object.values(part.kit!).flatMap((comp) => (typeof comp.drumKit === "number" ? [comp.drumKit] : [])))]
    : [];
  const isLayered = supportedSf2.layers.length > 0;
  for (const laneId of laneIds) {
    const bundle = await allocateSectionChannels(
      sectionEntry,
      usableChannels,
      1 + altPrograms.length + supportedSf2.layers.length,
    );
    const primaryChannel = bundle.channels[0]!;

    // Kit-component sound overrides borrow a sound from another GS kit. Each
    // lane receives independent auxiliary drum channels so its CC11 stream
    // cannot leak into another staff/voice lane.
    const altKitChannels = new Map<number, number>();
    for (let index = 0; index < altPrograms.length; index++) {
      altKitChannels.set(altPrograms[index]!, bundle.channels[1 + index]!);
    }

    const primarySampler = new Sf2Sampler(bundle.synth, primaryChannel, gmProgram, {
      fixedMidiNote: fixedDrum,
      drumKitProgram: drumKitProgramForSource(supportedSf2.primary, drumKitProgram),
      isDrum: isPercussion,
      altKitChannels: altKitChannels.size > 0 ? altKitChannels : undefined,
    });

    const ensembleOffset = 1 + altPrograms.length;
    const laneSampler: ISampler = isLayered
      ? await buildProfileLayered({
          primarySampler,
          synth: bundle.synth,
          layers: supportedSf2.layers,
          layerChannels: bundle.channels.slice(ensembleOffset),
          primaryVolumeRatio: supportedSf2.primaryVolumeRatio,
          defaultPos,
        })
      : primarySampler;
    laneSamplers.push(laneSampler);
    routingSamplers.set(laneId, laneSampler);
  }

  const partSampler = laneSamplers.length === 1 ? laneSamplers[0]! : new SamplerGroup(laneSamplers);
  routingSamplers.set(i, partSampler);

  // Per-part bookkeeping
  sectionEntry.parts.push({ index: i });
  refs.partSection.set(i, section);
  refs.partRefDist.set(i, sound.routing.projectionRefDistance);
  refs.mixerVolume.set(i, 1);
  const basePan = Math.max(-1, Math.min(1, defaultPos.x / PAN_RANGE));
  refs.basePan.set(i, basePan);
  if ("setPan" in partSampler) (partSampler as { setPan(pan: number): void }).setPan(basePan);

  // Profile-defined layers are intentionally created exactly once.
  if (isLayered) {
    refs.samplers.set(i, partSampler);
    patches.push({
      partName: part.name,
      source: "sf2",
      gmProgram,
      gmProgramName: gmProgramName(gmProgram),
      ensembleLayered: true,
      layerCount: supportedSf2.layers.length,
    });
  } else {
    refs.samplers.set(i, partSampler);
    patches.push({
      partName: part.name,
      source: "sf2",
      gmProgram,
      gmProgramName: gmProgramName(gmProgram),
    });
  }
}
