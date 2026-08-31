import type { ISampler } from "./types";

interface LayerControls {
  setLayerEnabled?(index: number, enabled: boolean): void;
  setLayerPan?(index: number, pan: number): void;
}

interface MixerControls {
  setVolume?(volume: number): void;
  setPan?(pan: number): void;
  setDetune?(cents: number): void;
  dispose?(): void;
}

/**
 * Part-level control facade over independently routed playback-lane samplers.
 *
 * Notes sent through the facade target only the primary lane (used by note
 * preview and as a safe fallback for old unscoped events). Persistent state,
 * mixer controls, panic, and layer controls fan out to every lane so part-level
 * UI remains coherent after one part is split into staff/voice lanes.
 */
export class SamplerGroup implements ISampler {
  constructor(private readonly samplers: readonly ISampler[]) {
    if (samplers.length === 0) throw new Error("SamplerGroup requires at least one sampler");
  }

  private get primary(): ISampler {
    return this.samplers[0]!;
  }

  noteOn(midiNote: number, velocity: number, time?: number, altKitProgram?: number): void {
    this.primary.noteOn(midiNote, velocity, time, altKitProgram);
  }

  noteOff(midiNote: number, time?: number, altKitProgram?: number): void {
    this.primary.noteOff(midiNote, time, altKitProgram);
  }

  allNotesOff(): void {
    for (const sampler of this.samplers) sampler.allNotesOff();
  }

  setProgram(program: number, time?: number): void {
    for (const sampler of this.samplers) sampler.setProgram?.(program, time);
  }

  sendControl(cc: number, value: number, time?: number): void {
    for (const sampler of this.samplers) sampler.sendControl?.(cc, value, time);
  }

  resetTechniqueState(): void {
    for (const sampler of this.samplers) sampler.resetTechniqueState?.();
  }

  setVolume(volume: number): void {
    for (const sampler of this.samplers) (sampler as ISampler & MixerControls).setVolume?.(volume);
  }

  setPan(pan: number): void {
    for (const sampler of this.samplers) (sampler as ISampler & MixerControls).setPan?.(pan);
  }

  setDetune(cents: number): void {
    for (const sampler of this.samplers) (sampler as ISampler & MixerControls).setDetune?.(cents);
  }

  setLayerEnabled(index: number, enabled: boolean): void {
    for (const sampler of this.samplers) (sampler as ISampler & LayerControls).setLayerEnabled?.(index, enabled);
  }

  setLayerPan(index: number, pan: number): void {
    for (const sampler of this.samplers) (sampler as ISampler & LayerControls).setLayerPan?.(index, pan);
  }

  dispose(): void {
    for (const sampler of this.samplers) (sampler as ISampler & MixerControls).dispose?.();
  }
}
