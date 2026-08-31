/**
 * Metronome click generator using Web Audio oscillator synthesis.
 *
 * Generates accented clicks on beat 1 and lighter clicks on other beats.
 * Time-signature-aware: compound meters (6/8, 9/8, 12/8) click on
 * dotted-quarter groupings rather than every eighth note.
 *
 * Click specs (per PRD):
 *   Beat 1:     880 Hz, 50 ms, louder
 *   Other beats: 440 Hz, 30 ms, softer
 *
 * References:
 *   - Familiar notation-editor sound: woodblock with an accent on beat 1.
 *   - Standard DAW practice: oscillator-based clicks with frequency
 *     differentiation for accent vs normal.
 */

/** Beat position within a measure for metronome clicks. */
export interface MetronomeBeat {
  /**
   * Position within the measure, in units of the time signature denominator.
   * For 4/4: positions 0–3 (quarter notes).
   * For 6/8: positions 0, 3 (dotted-quarter groupings in eighth notes).
   */
  readonly position: number;
  /** Whether this is an accented (strong) beat. */
  readonly accented: boolean;
}

export interface MetronomeOptions {
  readonly audioContext: AudioContext;
  /** Audio destination node. Defaults to audioContext.destination. */
  readonly destination?: AudioNode;
}

/** Oscillator click parameters. */
interface ClickSpec {
  readonly frequency: number;
  readonly duration: number;
  readonly gain: number;
}

export class Metronome {
  static readonly ACCENT_FREQUENCY = 880;
  static readonly NORMAL_FREQUENCY = 440;
  static readonly ACCENT_DURATION = 0.05; // 50 ms
  static readonly NORMAL_DURATION = 0.03; // 30 ms
  static readonly ACCENT_GAIN = 0.8;
  static readonly NORMAL_GAIN = 0.4;

  private readonly audioContext: AudioContext;
  private readonly masterGain: GainNode;
  private enabled = true;
  private volume = 1.0;

  constructor(options: MetronomeOptions) {
    this.audioContext = options.audioContext;
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = this.volume;
    this.masterGain.connect(options.destination ?? this.audioContext.destination);
  }

  /**
   * Schedule a single metronome click at a precise Web Audio time.
   * No-op if the metronome is disabled.
   */
  scheduleClick(time: number, accented: boolean): void {
    if (!this.enabled) return;

    const spec = accented ? Metronome.accentSpec() : Metronome.normalSpec();

    const oscillator = this.audioContext.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = spec.frequency;

    const envelope = this.audioContext.createGain();
    envelope.gain.setValueAtTime(spec.gain, time);
    // Rapid exponential decay to avoid clicks at cutoff
    envelope.gain.exponentialRampToValueAtTime(0.001, time + spec.duration);

    oscillator.connect(envelope);
    envelope.connect(this.masterGain);

    oscillator.start(time);
    oscillator.stop(time + spec.duration);
  }

  /** Enable or disable metronome clicks. */
  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Set master volume for the metronome (0–1).
   * Independent of instrument volume.
   */
  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    this.masterGain.gain.value = this.volume;
  }

  getVolume(): number {
    return this.volume;
  }

  /** Disconnect from audio graph and release resources. */
  dispose(): void {
    this.masterGain.disconnect();
  }

  // ─── Static helpers ────────────────────────────────────────────────

  /**
   * Determine whether a time signature is compound.
   * Compound meters have a denominator ≥ 8 with a numerator
   * divisible by 3 (but not 3 itself, which is simple triple).
   */
  static isCompoundMeter(count: number, unit: number): boolean {
    if (unit < 8) return false;
    return count > 3 && count % 3 === 0;
  }

  /**
   * Return the metronome beat pattern for a given time signature.
   *
   * Simple meters: one click per beat (per denominator unit).
   * Compound meters: clicks on dotted-quarter groupings.
   *
   * The first beat is always accented; subsequent beats are not.
   */
  static getBeatsForMeasure(count: number, unit: number): MetronomeBeat[] {
    if (Metronome.isCompoundMeter(count, unit)) {
      // Compound: group into dotted-quarter beats
      // e.g. 6/8 → groups of 3 eighth notes → clicks at positions 0, 3
      // e.g. 9/8 → positions 0, 3, 6
      // e.g. 12/8 → positions 0, 3, 6, 9
      const groupSize = 3;
      const numGroups = count / groupSize;
      const beats: MetronomeBeat[] = [];
      for (let i = 0; i < numGroups; i++) {
        beats.push({
          position: i * groupSize,
          accented: i === 0,
        });
      }
      return beats;
    }

    // Simple meter: one click per beat
    const beats: MetronomeBeat[] = [];
    for (let i = 0; i < count; i++) {
      beats.push({
        position: i,
        accented: i === 0,
      });
    }
    return beats;
  }

  /**
   * Convert a beat position (in time-signature units) to seconds,
   * given the tempo in BPM and the time signature unit.
   *
   * Assumes tempo BPM refers to quarter notes (standard convention).
   */
  static beatPositionToSeconds(position: number, bpm: number, unit: number): number {
    const secondsPerQuarter = 60 / bpm;
    const secondsPerUnit = secondsPerQuarter * (4 / unit);
    return position * secondsPerUnit;
  }

  /** Compute the total duration of one measure in seconds. */
  static measureDurationSeconds(count: number, unit: number, bpm: number): number {
    return Metronome.beatPositionToSeconds(count, bpm, unit);
  }

  private static accentSpec(): ClickSpec {
    return {
      frequency: Metronome.ACCENT_FREQUENCY,
      duration: Metronome.ACCENT_DURATION,
      gain: Metronome.ACCENT_GAIN,
    };
  }

  private static normalSpec(): ClickSpec {
    return {
      frequency: Metronome.NORMAL_FREQUENCY,
      duration: Metronome.NORMAL_DURATION,
      gain: Metronome.NORMAL_GAIN,
    };
  }
}
