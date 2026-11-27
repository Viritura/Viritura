import { reverbPresetWetLevel, type ISampler, type SpatialNode, type SpatialPosition } from "@viritura/audio";
import type { AudioExportSettings } from "./audioExport";
import type { VstTransport } from "./vstTransport";

/** User intent outlives the disposable audio graph. */
export interface MixerSettings {
  nativeGains: Map<number, number>;
  positions: Map<number, SpatialPosition>;
  ensembleEnabled: Map<number, boolean>;
  layerPans: Map<number, Map<number, number>>;
  airEQGain: number;
  limiterThreshold: number;
  limiterRatio: number;
  reverbPreset: string;
  reverbWet: number | undefined;
}

export function createMixerSettings(): MixerSettings {
  return {
    nativeGains: new Map(),
    positions: new Map(),
    ensembleEnabled: new Map(),
    layerPans: new Map(),
    airEQGain: 2.5,
    limiterThreshold: -8,
    limiterRatio: 12,
    reverbPreset: "musikvereinsaal",
    reverbWet: undefined,
  };
}

/** Snapshot the playback stage, room, and master bus for offline audio export. */
export function audioExportSettings(
  settings: MixerSettings,
  listener: SpatialPosition,
  partCount: number,
): AudioExportSettings {
  const parts = Array.from({ length: partCount }, (_, index) => index);
  return {
    stage: {
      listener: { ...listener },
      positions: parts.map((index) => {
        const position = settings.positions.get(index);
        return position ? { ...position } : null;
      }),
      layerPans: parts.map((index) => {
        const pans = settings.layerPans.get(index);
        if (!pans?.size) return null;
        const layers: (number | null)[] = Array.from({ length: Math.max(...pans.keys()) + 1 }, () => null);
        for (const [layer, pan] of pans) layers[layer] = pan;
        return layers;
      }),
    },
    reverbPresetId: settings.reverbPreset,
    reverbWet: settings.reverbWet ?? reverbPresetWetLevel(settings.reverbPreset),
    airEqGainDb: settings.airEQGain,
    limiterThresholdDb: settings.limiterThreshold,
    limiterRatio: settings.limiterRatio,
  };
}

interface LayerControls {
  setLayerEnabled?(index: number, enabled: boolean): void;
  setLayerPan?(index: number, pan: number): void;
}

export function applySamplerSettings(
  partIndex: number,
  sampler: ISampler,
  spatial: SpatialNode | undefined,
  settings: MixerSettings,
): void {
  const position = settings.positions.get(partIndex);
  if (position) spatial?.setPosition(position.x, position.y);
  const controls = sampler as ISampler & LayerControls;
  const enabled = settings.ensembleEnabled.get(partIndex);
  if (enabled !== undefined) {
    controls.setLayerEnabled?.(0, enabled);
    controls.setLayerEnabled?.(1, enabled);
  }
  for (const [layer, pan] of settings.layerPans.get(partIndex) ?? []) {
    controls.setLayerPan?.(layer, pan);
  }
}

/** Await mixer writes before starting native audio, including after a reload. */
export async function applyNativeMixer(
  transport: VstTransport,
  partCount: number,
  mix: {
    gains: ReadonlyMap<number, number>;
    pans: ReadonlyMap<number, number>;
    mutedParts: ReadonlySet<number>;
  },
): Promise<void> {
  await Promise.all([
    transport.setMutedParts(mix.mutedParts),
    ...orderedPartControls(partCount, mix.gains, 1).map(([part, gain]) => transport.setPartGain(part, gain)),
    ...orderedPartControls(partCount, mix.pans, 0).map(([part, pan]) => transport.setPartPan?.(part, pan)),
  ]);
}

function orderedPartControls(
  partCount: number,
  values: ReadonlyMap<number, number>,
  fallback: number,
): Array<[number, number]> {
  // Shared multitimbral slots have one output strip. Replaying defaults first,
  // then saved edits in their original order, preserves its last live controls.
  const controls: Array<[number, number]> = [];
  for (let part = 0; part < partCount; part++) {
    if (!values.has(part)) controls.push([part, fallback]);
  }
  for (const [part, value] of values) {
    if (part >= 0 && part < partCount) controls.push([part, value]);
  }
  return controls;
}
