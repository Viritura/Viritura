/**
 * LayeredSampler — composite sampler that forwards note events to a
 * primary sampler plus one or more layered samplers (e.g. ensemble pad).
 *
 * Each layer can be independently enabled/disabled at runtime.
 * When setVolume is called (e.g. from mixer mute/solo), all layers
 * are scaled by their volumeRatio so they respect mute/solo correctly.
 */

import type { ISampler } from "./types";

/** Configuration for a single layer added to the composite. */
export interface LayerConfig {
  sampler: ISampler;
  /** Volume relative to the primary (e.g. 0.5 = half the primary volume). */
  volumeRatio: number;
}

interface Layer extends LayerConfig {
  enabled: boolean;
}

export class LayeredSampler implements ISampler {
  private readonly primary: ISampler;
  private readonly layers: Layer[];
  private readonly primaryRatio: number;
  private currentPan = 0;

  constructor(primary: ISampler, layers: LayerConfig[], primaryRatio = 1.0) {
    this.primary = primary;
    this.primaryRatio = primaryRatio;
    this.layers = layers.map((l) => ({ ...l, enabled: true }));
  }

  noteOn(midiNote: number, velocity: number, time?: number, altKitProgram?: number): void {
    this.primary.noteOn(midiNote, velocity, time, altKitProgram);
    for (const layer of this.layers) {
      if (layer.enabled) layer.sampler.noteOn(midiNote, velocity, time, altKitProgram);
    }
  }

  noteOff(midiNote: number, time?: number, altKitProgram?: number): void {
    this.primary.noteOff(midiNote, time, altKitProgram);
    for (const layer of this.layers) {
      if (layer.enabled) layer.sampler.noteOff(midiNote, time, altKitProgram);
    }
  }

  allNotesOff(): void {
    this.primary.allNotesOff();
    for (const layer of this.layers) {
      layer.sampler.allNotesOff();
    }
  }

  setProgram(program: number, time?: number): void {
    if (this.primary.setProgram) this.primary.setProgram(program, time);
    for (const layer of this.layers) {
      if (layer.enabled && layer.sampler.setProgram) {
        layer.sampler.setProgram(program, time);
      }
    }
  }

  /** Forward a raw MIDI control change to the primary + all enabled layers. */
  sendControl(cc: number, value: number, time?: number): void {
    if (this.primary.sendControl) this.primary.sendControl(cc, value, time);
    for (const layer of this.layers) {
      if (layer.enabled && layer.sampler.sendControl) {
        layer.sampler.sendControl(cc, value, time);
      }
    }
  }

  /** Reset baseline instrument + neutral technique filter on primary + all layers. */
  resetTechniqueState(): void {
    this.primary.resetTechniqueState?.();
    for (const layer of this.layers) {
      layer.sampler.resetTechniqueState?.();
    }
  }

  /** Enable or disable a layer by index. Disabling silences any active notes. */
  setLayerEnabled(index: number, enabled: boolean): void {
    const layer = this.layers[index];
    if (!layer || layer.enabled === enabled) return;
    layer.enabled = enabled;
    if (!enabled) layer.sampler.allNotesOff();
  }

  /** Check whether a layer is currently enabled. */
  isLayerEnabled(index: number): boolean {
    return this.layers[index]?.enabled ?? false;
  }

  /** Set volume on a layer's sampler (delegates to setVolume if available). */
  setLayerVolume(index: number, volume: number): void {
    const layer = this.layers[index];
    if (layer && "setVolume" in layer.sampler) {
      (layer.sampler as { setVolume(v: number): void }).setVolume(volume);
    }
  }

  /** Set volume on primary + all layers (each scaled by its ratio). */
  setVolume(volume: number): void {
    if ("setVolume" in this.primary) {
      (this.primary as { setVolume(v: number): void }).setVolume(volume * this.primaryRatio);
    }
    for (const layer of this.layers) {
      if ("setVolume" in layer.sampler) {
        (layer.sampler as { setVolume(v: number): void }).setVolume(volume * layer.volumeRatio);
      }
    }
  }

  /** Set pan on the primary sampler only. Use setLayerPan for per-layer panning. */
  setPan(pan: number): void {
    this.currentPan = pan;
    if ("setPan" in this.primary) {
      (this.primary as { setPan(p: number): void }).setPan(pan);
    }
  }

  /** Set absolute pan on a layer's sampler (listener-relative, computed externally). */
  setLayerPan(index: number, pan: number): void {
    const layer = this.layers[index];
    if (!layer) return;
    if ("setPan" in layer.sampler) {
      (layer.sampler as { setPan(p: number): void }).setPan(Math.max(-1, Math.min(1, pan)));
    }
  }

  /** Apply micro-detuning to the primary sampler (layers are not detuned). */
  setDetune(cents: number): void {
    if ("setDetune" in this.primary) {
      (this.primary as { setDetune(c: number): void }).setDetune(cents);
    }
  }

  /** @deprecated Use setLayerPan instead. Kept for backward compatibility. */
  setLayerPanOffset(index: number, offset: number): void {
    this.setLayerPan(index, Math.max(-1, Math.min(1, this.currentPan + offset)));
  }

  dispose(): void {
    if ("dispose" in this.primary) {
      (this.primary as { dispose(): void }).dispose();
    }
    for (const layer of this.layers) {
      if ("dispose" in layer.sampler) {
        (layer.sampler as { dispose(): void }).dispose();
      }
    }
  }
}
