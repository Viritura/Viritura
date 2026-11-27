import { CLICK_LEVEL_CODES, type ClickLevel } from "./clickEngine";
import { DEFAULT_CLICK_SOUND, isClickSound, synthesizeClickVoices, type ClickSound } from "./clickSound";

export interface MetronomeOptions {
  readonly audioContext: AudioContext;
  /** Audio destination node. Defaults to audioContext.destination. */
  readonly destination?: AudioNode;
  readonly sound?: ClickSound;
}

/** Score-transport playback of the same voices used by the recording click worklet. */
export class Metronome {
  private readonly audioContext: AudioContext;
  private readonly masterGain: GainNode;
  private readonly soundBuffers = new Map<ClickSound, readonly AudioBuffer[]>();
  private sound: ClickSound;
  private enabled = true;
  private volume = 1.0;

  constructor(options: MetronomeOptions) {
    this.audioContext = options.audioContext;
    this.sound = options.sound ?? DEFAULT_CLICK_SOUND;
    if (!isClickSound(this.sound)) throw new RangeError(`Unknown metronome sound: ${String(this.sound)}`);
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = this.volume;
    this.masterGain.connect(options.destination ?? this.audioContext.destination);
    this.buffersFor(this.sound);
  }

  /** Schedule a generated click at a precise Web Audio time. */
  scheduleClick(time: number, level: ClickLevel): void {
    if (!this.enabled) return;
    const source = this.audioContext.createBufferSource();
    source.buffer = this.buffersFor(this.sound)[CLICK_LEVEL_CODES[level]]!;
    source.connect(this.masterGain);
    source.start(time);
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  /** Apply a new sound to subsequently scheduled clicks. */
  setSound(sound: ClickSound): void {
    if (!isClickSound(sound)) throw new RangeError(`Unknown metronome sound: ${String(sound)}`);
    this.buffersFor(sound);
    this.sound = sound;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Independent of instrument volume. */
  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    this.masterGain.gain.value = this.volume;
  }

  getVolume(): number {
    return this.volume;
  }

  dispose(): void {
    this.masterGain.disconnect();
    this.soundBuffers.clear();
  }

  private buffersFor(sound: ClickSound): readonly AudioBuffer[] {
    const cached = this.soundBuffers.get(sound);
    if (cached) return cached;
    const buffers = synthesizeClickVoices(this.audioContext.sampleRate, sound).map((samples) => {
      const buffer = this.audioContext.createBuffer(1, samples.length, this.audioContext.sampleRate);
      buffer.getChannelData(0).set(samples);
      return buffer;
    });
    this.soundBuffers.set(sound, buffers);
    return buffers;
  }
}
