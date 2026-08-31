/**
 * Sf2Sampler — SoundFont2-based sampler using spessasynth_lib.
 *
 * Wraps spessasynth_lib's WorkletSynthesizer to implement the ISampler interface.
 * Each Sf2Sampler instance is assigned a MIDI channel and GM program number,
 * so multiple parts can share a single synthesizer with different instrument sounds.
 *
 * Usage:
 *   const synth = await Sf2Synth.create(audioContext, sf2Buffer);
 *   const sampler = new Sf2Sampler(synth, 0, 0); // channel 0, program 0 (piano)
 *   sampler.noteOn(60, 100); // play middle C
 */

import type { ISampler } from "./types";

// spessasynth_lib types — imported dynamically to avoid bundling issues
// The actual WorkletSynthesizer is loaded at runtime
/** Options for scheduling synth events at a precise audio-context time. */
interface SynthEventOptions {
  time: number;
}

interface SpessaSynthLike {
  noteOn(channel: number, midiNote: number, velocity: number, eventOptions?: SynthEventOptions): void;
  noteOff(channel: number, midiNote: number, eventOptions?: SynthEventOptions): void;
  programChange(channel: number, programNumber: number): void;
  stopAll(force?: boolean): void;
  controllerChange(channel: number, cc: number, value: number, eventOptions?: SynthEventOptions): void;
  /** Send raw MIDI bytes with optional timing (used for timed program changes). */
  sendMessage(message: Iterable<number>, channelOffset?: number, eventOptions?: SynthEventOptions): void;
  /** Per-channel handles. Drum-mode is toggled via `midiChannels[ch].setDrums(isDrum)`
   *  in spessasynth_lib >=4.3 — there is no synth-level `setDrums`. Spessasynth does
   *  NOT auto-set channel 9 to drums, so we flip it explicitly. */
  midiChannels: { setDrums(isDrum: boolean): void }[];
  connect(node: AudioNode): AudioNode;
  isReady: Promise<unknown>;
  soundBankManager: {
    addSoundBank(buffer: ArrayBuffer, id: string, bankOffset?: number): Promise<void>;
  };
  presetList: unknown[];
  destroy?(): void;
}

/** Track per-synth channel configuration so multiple Sf2Sampler instances
 *  targeting the same synth+channel don't re-issue setDrums/programChange.
 *  For the drum channel we also remember which kit program is currently
 *  loaded, so switching kits (e.g. Standard → Orchestra) re-initializes. */
const configuredDrumChannels = new WeakMap<object, Map<number, number>>();
const configuredMelodicChannels = new WeakMap<object, Map<number, number>>();

/**
 * Shared SF2 synthesizer singleton.
 * Multiple Sf2Sampler instances share one synth, each using a different MIDI channel.
 */
export class Sf2Synth {
  /**
   * Intermediate GainNode between the synth and its output.
   * Callers connect this to their desired destination (PannerNode, reverb send, etc.).
   * NOT connected to ctx.destination by default — the caller must wire routing.
   */
  public readonly outputNode: GainNode;

  private constructor(
    public readonly synth: SpessaSynthLike,
    public readonly context: AudioContext,
    outputNode: GainNode,
  ) {
    this.outputNode = outputNode;
  }

  /**
   * Create a new SF2 synth instance and load a SoundFont.
   * @param audioContext Web Audio AudioContext
   * @param sf2Buffer The SF2 file data as ArrayBuffer
   * @param outputNode Optional output node (defaults to destination)
   */
  private static workletRegistered = new WeakSet<BaseAudioContext>();

  static async create(audioContext: AudioContext, sf2Buffer: ArrayBuffer, _outputNode?: AudioNode): Promise<Sf2Synth> {
    const spessasynth = await import("spessasynth_lib");

    // Resolve worklet URL relative to the app's base path so it works in dev
    // ("/") and the deployed site (e.g. "/app/"). Vite replaces
    // `import.meta.env.BASE_URL` at build time; fall back to "/" elsewhere.
    const baseUrl = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
    const workletUrl = `${baseUrl}sounds/spessasynth_processor.min.js`;

    // Detect Chromium (Chrome, Edge, Opera) vs Firefox
    const isChromium = "chrome" in window;

    let synth: InstanceType<typeof spessasynth.WorkletSynthesizer>;

    if (!isChromium) {
      // Firefox: use AudioWorklet directly
      if (!Sf2Synth.workletRegistered.has(audioContext)) {
        try {
          await audioContext.audioWorklet.addModule(workletUrl);
        } catch (err) {
          throw new Error(
            `Failed to load ${workletUrl}: ${err instanceof Error ? err.message : String(err)}. ` +
              `Check that the file is deployed and reachable.`,
          );
        }
        Sf2Synth.workletRegistered.add(audioContext);
      }
      synth = new spessasynth.WorkletSynthesizer(audioContext);
    } else {
      // Chromium: still use WorkletSynthesizer but register the module first
      // SpessaSynth's WorkletSynthesizer handles Chromium fine
      if (!Sf2Synth.workletRegistered.has(audioContext)) {
        try {
          await audioContext.audioWorklet.addModule(workletUrl);
        } catch (err) {
          throw new Error(
            `Failed to load ${workletUrl}: ${err instanceof Error ? err.message : String(err)}. ` +
              `Check that the file is deployed and reachable.`,
          );
        }
        Sf2Synth.workletRegistered.add(audioContext);
      }
      synth = new spessasynth.WorkletSynthesizer(audioContext);
    }

    // Route synth through an intermediate GainNode for flexible routing.
    // The caller connects sf2.outputNode to PannerNode / reverb / destination.
    const outputGain = audioContext.createGain();
    synth.connect(outputGain);

    // Wait for the synth worklet to be fully initialized
    await synth.isReady;

    // CRITICAL: Must .slice() the buffer for WorkletSynthesizer
    // Worklet buffers cannot be transferred twice
    const bufferCopy = sf2Buffer.slice(0);
    await synth.soundBankManager.addSoundBank(bufferCopy, "default");
    console.log("[Sf2Synth] SoundBank loaded with", synth.presetList.length, "presets");

    return new Sf2Synth(synth as unknown as SpessaSynthLike, audioContext, outputGain);
  }

  /**
   * Force the synth's audio worklet to fully ingest all queued setup
   * messages (preset selection, setDrums, programChange, SoundBank
   * resolution) and prime sample lookup tables for any channels we plan to
   * use. Without this, the first `noteOn` after a fresh `Sf2Synth.create()`
   * can race the worklet's message queue and either drop the note or play
   * the default piano preset.
   *
   * The warm-up plays a silent (volume=0 on this synth's outputNode is not
   * suitable since it would mute legitimate notes too \u2014 instead we use
   * velocity 1 with an immediate noteOff scheduled in the past so no audio
   * actually reaches the speakers) note on each requested channel, then
   * awaits two audio quanta (\u2248 5ms at 48kHz/128-sample quantum) so the
   * worklet has guaranteed processed the messages and selected presets.
   */
  async warmUp(channels: readonly number[]): Promise<void> {
    if (channels.length === 0) return;
    const ctx = this.context;
    // Schedule a noteOn slightly in the past (so any sample that does play
    // is already finished) followed immediately by a noteOff. The
    // round-trip forces the worklet to look up the preset + sample for the
    // channel, which is the slow path that causes the first real note to
    // race.
    const past = Math.max(0, ctx.currentTime - 0.05);
    for (const ch of channels) {
      try {
        this.synth.noteOn(ch, 60, 1, { time: past });
        this.synth.noteOff(ch, 60, { time: past });
      } catch {
        // Best-effort; warm-up failure should never break playback.
      }
    }
    // Wait two audio quanta worth of wall time for the worklet to drain.
    // 128 samples / 48000 Hz \u2248 2.7ms; allow a little extra slack.
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }

  /** Clean up the synth. */
  destroy(): void {
    if (this.synth.destroy) {
      this.synth.destroy();
    }
  }
}

/**
 * Pool of SF2 synth instances. Each handles 15 usable MIDI channels (0-8, 10-15).
 * Automatically creates new synth instances when channels are exhausted.
 */
export class Sf2SynthPool {
  private readonly synths: Sf2Synth[] = [];
  private readonly context: AudioContext;
  private readonly buffer: ArrayBuffer;
  private channelsUsed = 0;

  private constructor(context: AudioContext, buffer: ArrayBuffer, firstSynth: Sf2Synth) {
    this.context = context;
    this.buffer = buffer;
    this.synths.push(firstSynth);
  }

  static async create(context: AudioContext, buffer: ArrayBuffer): Promise<Sf2SynthPool> {
    const synth = await Sf2Synth.create(context, buffer);
    return new Sf2SynthPool(context, buffer, synth);
  }

  /** Get the output node of the first synth (for shared routing). */
  get outputNode(): GainNode {
    return this.synths[0]!.outputNode;
  }

  /** Allocate the next available synth + channel pair. Always succeeds. */
  async allocate(gmProgram: number): Promise<{ synth: Sf2Synth; channel: number }> {
    const USABLE_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
    const synthIndex = Math.floor(this.channelsUsed / USABLE_CHANNELS.length);
    const channelIndex = this.channelsUsed % USABLE_CHANNELS.length;
    this.channelsUsed++;

    // Create a new synth instance if needed
    while (synthIndex >= this.synths.length) {
      const newSynth = await Sf2Synth.create(this.context, this.buffer);
      // Connect new synth's output to the same routing as the first
      newSynth.outputNode.connect(this.synths[0]!.outputNode);
      this.synths.push(newSynth);
      console.log(`[Sf2Pool] Created synth instance ${this.synths.length} for overflow channels`);
    }

    const synth = this.synths[synthIndex]!;
    const channel = USABLE_CHANNELS[channelIndex]!;
    synth.synth.programChange(channel, gmProgram);
    return { synth, channel };
  }

  /** Destroy all synth instances. */
  destroy(): void {
    for (const s of this.synths) s.destroy();
    this.synths.length = 0;
    this.channelsUsed = 0;
  }
}

/** Standard GS drum kit (rock-flavored BD/snare/hi-hat etc.). */
export const DRUM_KIT_STANDARD = 0;
/** Orchestra drum kit (concert BD/snare, chromatic timpani F2–F4,
 *  concert cymbals, applause, sleighbells, etc.). Bank 128 program 48
 *  in any GS-compliant SF2 — confirmed present in Shan-SGM-Pro-15.sf2.
 *
 *  Note: the Ethnic kit (program 49) holds the Big Gong (key 45) used for
 *  orchestral Tam-tam, which this kit lacks (its 41–53 range is chromatic
 *  timpani). Components borrow it via the `drumKit` kit-component extension,
 *  which flows through the timeline as `MidiEvent.drumKitProgram`. */
export const DRUM_KIT_ORCHESTRA = 48;

export interface Sf2SamplerOptions {
  /** When set, every noteOn/noteOff is remapped to this MIDI number. Used
   *  for single-drum unpitched percussion (snare, bass drum, etc.) where the
   *  written pitch is just a placeholder on the percussion staff. */
  fixedMidiNote?: number;
  /** GS drum-kit program to load on channel 9. Ignored on melodic channels.
   *  Defaults to {@link DRUM_KIT_STANDARD}. Use {@link DRUM_KIT_ORCHESTRA}
   *  for concert percussion (real concert BD/SD, chromatic timpani samples,
   *  concert cymbals, etc.). */
  drumKitProgram?: number;
  /** Configure this sampler's primary channel as a drum channel. Internal
   *  playback lanes are free to use any physical synth channel; channel 9 is
   *  only an external-MIDI convention. */
  isDrum?: boolean;
  /** Secondary drum channels for kit-component sound overrides: maps a GS
   *  drum-kit program (bank 128) to a dedicated MIDI channel pre-configured as
   *  drums with that program. A `noteOn`/`noteOff` whose `altKitProgram` matches
   *  a key plays on that channel instead of the primary one, letting one
   *  percussion part borrow a sound from another kit (e.g. a Tam-tam/Big Gong
   *  from the Ethnic kit). */
  altKitChannels?: ReadonlyMap<number, number>;
}

/**
 * Per-part SF2 sampler that implements ISampler.
 * Each instance uses a dedicated MIDI channel with a specific GM program.
 */
export class Sf2Sampler implements ISampler {
  private readonly synth: SpessaSynthLike;
  private readonly sf2Synth: Sf2Synth;
  private readonly channel: number;
  /** Baseline GM program this part was created with. Restored by
   *  {@link resetTechniqueState} to undo a pizz/arco program swap. */
  private readonly baselineProgram: number;
  /** When set, every noteOn/noteOff is remapped to this MIDI number. Used
   *  for single-drum unpitched percussion (snare, bass drum, etc.) where the
   *  written pitch is just a placeholder on the percussion staff. */
  private readonly fixedMidiNote?: number;
  /** Alt drum-kit program → dedicated channel, for kit-component sound
   *  overrides (e.g. a Tam-tam borrowed from the Ethnic kit). Empty for
   *  parts without overrides. */
  private readonly altKitChannels: ReadonlyMap<number, number>;
  private readonly isDrum: boolean;

  constructor(
    sf2Synth: Sf2Synth,
    channel: number,
    gmProgram: number,
    fixedMidiNoteOrOptions?: number | Sf2SamplerOptions,
  ) {
    // Back-compat: callers used to pass `fixedMidiNote` as the 4th arg.
    const opts: Sf2SamplerOptions =
      typeof fixedMidiNoteOrOptions === "number"
        ? { fixedMidiNote: fixedMidiNoteOrOptions }
        : (fixedMidiNoteOrOptions ?? {});
    const drumKitProgram = opts.drumKitProgram ?? DRUM_KIT_STANDARD;
    this.synth = sf2Synth.synth;
    this.sf2Synth = sf2Synth;
    this.channel = channel;
    this.baselineProgram = gmProgram;
    this.fixedMidiNote = opts.fixedMidiNote;
    this.altKitChannels = opts.altKitChannels ?? new Map();
    this.isDrum = opts.isDrum ?? channel === 9;

    // Channel 9 is reserved for percussion in GM, but spessasynth does NOT
    // auto-configure channel 9 as drums — we have to flip it explicitly,
    // otherwise the channel plays the default melodic preset (piano).
    //
    // CRITICAL: When multiple Sf2Sampler instances target the same
    // (synth, channel) pair (e.g. several percussion parts sharing one
    // section synth), repeated setDrums/programChange calls can interact
    // badly with spessasynth's internal worklet state and silence the
    // channel. Cache configuration per synth instance so the channel is
    // only set up once.
    const synthKey = sf2Synth as unknown as object;
    if (this.isDrum) {
      let drumChans = configuredDrumChannels.get(synthKey);
      if (!drumChans) {
        drumChans = new Map<number, number>();
        configuredDrumChannels.set(synthKey, drumChans);
      }
      // Only re-initialize when this channel hasn't been set up yet OR
      // when the requested kit differs from what's currently loaded.
      // NOTE: All percussion parts in a section share this single channel 9.
      // If two parts disagree on the kit, last-init-wins. See the
      // PlaybackContext heuristic for how we pick a kit per score.
      if (drumChans.get(channel) !== drumKitProgram) {
        this.synth.midiChannels[channel]?.setDrums(true);
        this.synth.programChange(channel, drumKitProgram);
        drumChans.set(channel, drumKitProgram);
      }
    } else {
      let melChans = configuredMelodicChannels.get(synthKey);
      if (!melChans) {
        melChans = new Map<number, number>();
        configuredMelodicChannels.set(synthKey, melChans);
      }
      if (melChans.get(channel) !== gmProgram) {
        this.synth.programChange(this.channel, gmProgram);
        melChans.set(channel, gmProgram);
      }
    }

    // Configure any secondary drum channels for kit-component sound overrides
    // (e.g. a Tam-tam borrowed from the Ethnic kit). Each is flipped to drum
    // mode and loaded with its kit program, cached per synth like channel 9.
    if (this.altKitChannels.size > 0) {
      let drumChans = configuredDrumChannels.get(synthKey);
      if (!drumChans) {
        drumChans = new Map<number, number>();
        configuredDrumChannels.set(synthKey, drumChans);
      }
      for (const [program, altChannel] of this.altKitChannels) {
        if (drumChans.get(altChannel) !== program) {
          this.synth.midiChannels[altChannel]?.setDrums(true);
          this.synth.programChange(altChannel, program);
          drumChans.set(altChannel, program);
        }
      }
    }
  }

  /** Resolve the channel a note should play on, honoring a kit-component sound
   *  override (alt drum kit) when one is configured. */
  private resolveChannel(altKitProgram?: number): number {
    if (altKitProgram !== undefined) {
      const altChannel = this.altKitChannels.get(altKitProgram);
      if (altChannel !== undefined) return altChannel;
    }
    return this.channel;
  }

  noteOn(midiNote: number, velocity: number, time?: number, altKitProgram?: number): void {
    if (this.sf2Synth.context.state === "suspended") {
      void (this.sf2Synth.context as AudioContext).resume();
    }
    const note = this.fixedMidiNote ?? midiNote;
    const channel = this.resolveChannel(altKitProgram);
    if (time !== undefined) {
      this.synth.noteOn(channel, note, velocity, { time });
    } else {
      this.synth.noteOn(channel, note, velocity);
    }
  }

  noteOff(midiNote: number, time?: number, altKitProgram?: number): void {
    const note = this.fixedMidiNote ?? midiNote;
    const channel = this.resolveChannel(altKitProgram);
    if (time !== undefined) {
      this.synth.noteOff(channel, note, { time });
    } else {
      this.synth.noteOff(channel, note);
    }
  }

  allNotesOff(): void {
    // Send a channel-local panic burst. The playback scheduler intentionally
    // pre-sends events into the worklet, so a noteOn can still be queued for
    // the next few audio quanta after Stop/Pause has killed current voices.
    // Repeating All Sound Off + All Notes Off catches those queued starts
    // without killing unrelated lanes that share this synth instance.
    const now = this.sf2Synth.context.currentTime;
    for (const offset of [0, 0.05, 0.15, 0.3, 0.5]) {
      const time = now + offset;
      const options = offset === 0 ? undefined : { time };
      this.synth.controllerChange(this.channel, 120, 0, options);
      this.synth.controllerChange(this.channel, 123, 0, options);
      // Also silence any secondary alt-kit drum channels owned by this part.
      for (const altChannel of this.altKitChannels.values()) {
        this.synth.controllerChange(altChannel, 120, 0, options);
        this.synth.controllerChange(altChannel, 123, 0, options);
      }
    }
  }

  /** Set volume via 14-bit CC 7/39 (Channel Volume MSB/LSB). */
  setVolume(volume: number): void {
    const value = Math.round(Math.max(0, Math.min(1, volume)) * 0x3fff);
    this.synth.controllerChange(this.channel, 7, value >> 7);
    this.synth.controllerChange(this.channel, 39, value & 0x7f);
  }

  /** Set pan via CC 10 (Pan). */
  setPan(pan: number): void {
    // MIDI pan: 0=left, 64=center, 127=right
    const midiPan = Math.round((pan + 1) * 63.5);
    this.synth.controllerChange(this.channel, 10, midiPan);
  }

  /** Change the GM program for this channel. */
  setProgram(program: number, time?: number): void {
    if (this.isDrum) return;
    if (time !== undefined) {
      this.synth.sendMessage([0xc0 | this.channel, program], 0, { time });
    } else {
      this.synth.programChange(this.channel, program);
    }
  }

  /**
   * Send a raw MIDI control change (CC) on this channel, optionally scheduled.
   * Used by timeline control events (e.g. con sord. filter via CC 74/71/11).
   */
  sendControl(cc: number, value: number, time?: number): void {
    const v = Math.max(0, Math.min(127, Math.round(value)));
    if (time !== undefined) {
      this.synth.controllerChange(this.channel, cc, v, { time });
    } else {
      this.synth.controllerChange(this.channel, cc, v);
    }
  }

  /**
   * Restore this channel to its baseline instrument + neutral technique
   * filter, undoing any pizz/arco program swap or con sord. filter left over
   * from a prior region or a previous playback. Applied immediately when
   * playback (re)starts, before the chased state for the start point is set.
   *
   * Mixer-owned controllers (CC 7 volume, CC 10 pan) are deliberately NOT
   * reset — those are owned by the mixer, not the technique system.
   */
  resetTechniqueState(): void {
    if (this.isDrum) return;
    this.synth.programChange(this.channel, this.baselineProgram);
    // Neutral technique filter: CC 74 brightness, CC 71 resonance, CC 11 expression.
    this.synth.controllerChange(this.channel, 74, 64);
    this.synth.controllerChange(this.channel, 71, 64);
    this.synth.controllerChange(this.channel, 11, 127);
  }

  /**
   * Apply micro-detuning via MIDI pitch bend.
   * Assumes the default pitch bend range of ±2 semitones (200 cents).
   * @param cents — detuning in cents (e.g. +5 or -5)
   */
  setDetune(cents: number): void {
    // Pitch bend: 14-bit value, center = 8192, range = ±200 cents (±2 semitones)
    const bend = Math.round(8192 + (cents * 8192) / 200);
    const clamped = Math.max(0, Math.min(16383, bend));
    const lsb = clamped & 0x7f;
    const msb = (clamped >> 7) & 0x7f;
    this.synth.sendMessage([0xe0 | this.channel, lsb, msb]);
  }

  dispose(): void {
    this.allNotesOff();
  }
}
