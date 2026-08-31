/**
 * VstTransport — the seam between the SF2 transport and the native VST host.
 *
 * The desktop build hosts VST3 plugins in an out-of-web-thread runtime (the
 * Tauri `vst_playback_*` commands) that owns its own clock and consumes a
 * precompiled MIDI timeline. `@viritura/playback` must stay Tauri-free, so the
 * desktop implementation is dependency-injected into {@link PlaybackProvider}
 * as this interface (mirroring the `soundProfileRegistry` prop). On the web
 * there is no transport and every part falls back to SoundFont (§3.8).
 *
 * The conductor ({@link PlaybackProvider}) drives both players in lockstep:
 * it starts/stops/seeks the SF2 engine and this transport at the same musical
 * origin, and silences the SF2 voices for whichever parts the VST host takes
 * ownership of.
 */

import type { Score } from "@viritura/core";
import type { VstSoundSourceDefinition } from "@viritura/sound-profiles";

/** A score part resolved to a configured VST slot. */
export interface VstPartAssignment {
  /** The part's index within `score.parts`. */
  readonly partIndex: number;
  /** The resolved VST source (host profile + instrument slot + channel). */
  readonly vst: VstSoundSourceDefinition;
}

/**
 * A non-VST part to voice on the native built-in SoundFont (native render mode
 * only). In that mode every part is host-owned so the whole mix shares one clock
 * and the one VST reverb bus; parts without a VST play through a `rustysynth`
 * strip instead of the browser SF2 engine.
 */
export interface Sf2PartAssignment {
  /** The part's index within `score.parts`. */
  readonly partIndex: number;
  /** General MIDI program the SoundFont voice should load. */
  readonly program: number;
  /** Whether this voice is a percussion kit (plays on the GM drum channel). */
  readonly isDrum: boolean;
}

/**
 * What the native host should voice for a play. In web render mode both lists
 * are empty (the browser plays everything); in native mode `vstParts` carries
 * the VST-assigned parts and `sf2Parts` every remaining pitched part.
 */
export interface VstPreparePlan {
  readonly vstParts: readonly VstPartAssignment[];
  readonly sf2Parts: readonly Sf2PartAssignment[];
}

export interface VstTransport {
  /**
   * Compile/build every requested slot and (re)load the native host with its
   * precompiled MIDI, returning the set of part indices the host actually took
   * ownership of. VST parts with a missing/partial binding or a mapper that
   * fails to compile are dropped (they stay on the SF2 fallback, §3.8); SF2
   * parts are always claimed. The caller silences exactly the returned indices.
   */
  prepare(score: Score, plan: VstPreparePlan): Promise<ReadonlySet<number>>;
  /** Begin (or restart) VST transport at the given musical origin, in seconds. */
  start(originSeconds: number): Promise<void>;
  /** Halt VST transport and flush all sounding notes; instances stay loaded. */
  stop(): Promise<void>;
  /** Move the VST transport to the given score time, in seconds. */
  seek(seconds: number): Promise<void>;
  /**
   * Set the live output gain (linear, 1.0 = unity) of the native slot voicing
   * the given part. Applies immediately while playing; a no-op for parts the host
   * does not own. Mixer mute/solo is handled separately via {@link setMutedParts}.
   */
  setPartGain(partIndex: number, gain: number): Promise<void>;
  /**
   * Play a single note immediately on the native slot voicing the given part
   * (click-to-hear preview), releasing it after `durationMs`. Resolves to `true`
   * when the host owns the part and voiced the note, or `false` when the part is
   * not host-owned so the caller can fall back to the browser sampler.
   */
  previewNote(partIndex: number, note: number, velocity: number, durationMs: number): Promise<boolean>;
  /**
   * Set which part indices are muted (mixer mute/solo resolved to an effective
   * muted set). The host drops those parts' events and cuts any of their
   * sounding notes at once, so mute/solo affects VST audio like the SF2 path.
   */
  setMutedParts(parts: ReadonlySet<number>): Promise<void>;
  /** Unload every plugin instance (score close / profile change). */
  release(): Promise<void>;
}
