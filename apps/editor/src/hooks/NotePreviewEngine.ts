/**
 * NotePreviewEngine — Web Audio oscillator-based note preview.
 *
 * Plays a triangle-wave tone when a note is clicked or entered,
 * providing auditory feedback without requiring a sample library.
 *
 * Uses triangle wave at 440 * 2^((midiNote - 69) / 12) Hz with
 * a short ADSR envelope: 10ms attack, 50ms decay, 0.7 sustain, 100ms release.
 *
 * Reference: Standard equal-temperament MIDI-to-frequency conversion.
 */

/** ADSR envelope parameters in seconds. */
interface EnvelopeParams {
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  readonly release: number;
}

const DEFAULT_ENVELOPE: EnvelopeParams = {
  attack: 0.01,
  decay: 0.05,
  sustain: 0.7,
  release: 0.1,
};

const DEFAULT_VELOCITY = 0.3;
const DEFAULT_DURATION_MS = 500;

/** Convert MIDI note number to frequency in Hz (A4 = 440 Hz). */
export function midiToFrequency(midiNote: number): number {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

/**
 * Singleton note preview engine backed by the Web Audio API.
 *
 * The AudioContext is lazily initialized on the first user interaction
 * to comply with browser autoplay policies.
 */
export class NotePreviewEngine {
  private ctx: AudioContext | null = null;
  private activeNodes: OscillatorNode[] = [];
  private _enabled = true;

  /** Whether note preview is enabled. */
  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    this._enabled = value;
    if (!value) {
      this.stopAll();
    }
  }

  /** Lazily create or resume the AudioContext. */
  private getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  /**
   * Play a single MIDI note with an ADSR envelope.
   * @param midiNote MIDI note number (0–127; 60 = middle C)
   * @param durationMs How long to sustain before releasing (default 500ms)
   * @param velocity Volume 0–1 (default 0.3)
   */
  playNote(midiNote: number, durationMs: number = DEFAULT_DURATION_MS, velocity: number = DEFAULT_VELOCITY): void {
    if (!this._enabled) return;

    const ctx = this.getContext();
    const now = ctx.currentTime;
    const freq = midiToFrequency(midiNote);
    const env = DEFAULT_ENVELOPE;
    const sustainEnd = now + env.attack + env.decay + durationMs / 1000;

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now);

    const gain = ctx.createGain();
    // ADSR envelope
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(velocity, now + env.attack);
    gain.gain.linearRampToValueAtTime(velocity * env.sustain, now + env.attack + env.decay);
    gain.gain.setValueAtTime(velocity * env.sustain, sustainEnd);
    gain.gain.linearRampToValueAtTime(0, sustainEnd + env.release);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(sustainEnd + env.release + 0.01);

    this.activeNodes.push(osc);
    osc.onended = () => {
      const idx = this.activeNodes.indexOf(osc);
      if (idx !== -1) this.activeNodes.splice(idx, 1);
      osc.disconnect();
      gain.disconnect();
    };
  }

  /**
   * Play multiple MIDI notes simultaneously (for chords).
   * Each note gets slightly reduced velocity to avoid clipping.
   */
  playChord(midiNotes: readonly number[], durationMs: number = DEFAULT_DURATION_MS): void {
    if (!this._enabled || midiNotes.length === 0) return;

    // Scale velocity down for larger chords to avoid clipping
    const velocity = DEFAULT_VELOCITY / Math.sqrt(midiNotes.length);
    for (const note of midiNotes) {
      this.playNote(note, durationMs, velocity);
    }
  }

  /** Immediately stop all currently playing notes. */
  stopAll(): void {
    for (const osc of this.activeNodes) {
      try {
        osc.stop();
      } catch {
        // Already stopped
      }
    }
    this.activeNodes = [];
  }

  /** Release the AudioContext (for cleanup). */
  dispose(): void {
    this.stopAll();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}

/** Shared singleton instance. */
let instance: NotePreviewEngine | null = null;

/** Get the shared NotePreviewEngine singleton. */
export function getNotePreviewEngine(): NotePreviewEngine {
  if (!instance) {
    instance = new NotePreviewEngine();
  }
  return instance;
}
