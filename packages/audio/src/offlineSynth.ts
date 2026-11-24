import { SoundBankLoader, SpessaSynthProcessor, type BasicSoundBank } from "spessasynth_core";
import type { Sf2SamplerBackend } from "./Sf2Sampler";

function requireImmediate(options?: { time: number }): void {
  if (options) throw new Error("Offline synthesis does not support scheduled MIDI events.");
}

/** A SoundFont synthesizer driven by sample counts instead of an AudioContext. */
export class OfflineSf2Synth implements Sf2SamplerBackend {
  readonly synth: Sf2SamplerBackend["synth"];
  private nextChannel = 0;

  private constructor(private readonly processor: SpessaSynthProcessor) {
    this.synth = {
      midiChannels: processor.midiChannels,
      noteOn: (channel, note, velocity, options) => {
        requireImmediate(options);
        processor.noteOn(channel, note, velocity);
      },
      noteOff: (channel, note, options) => {
        requireImmediate(options);
        processor.noteOff(channel, note);
      },
      programChange: (channel, program) => processor.programChange(channel, program),
      controllerChange: (channel, cc, value, options) => {
        requireImmediate(options);
        processor.processMessage([0xb0 | (channel % 16), cc, value], channel - (channel % 16));
      },
      sendMessage: (message, offset = 0, options) => {
        requireImmediate(options);
        processor.processMessage(Array.from(message), offset);
      },
    };
  }

  /**
   * `effects` enables the synthesizer's built-in reverb and chorus, matching
   * the live AudioWorklet synth. Pass a parsed bank to share samples between
   * several synthesizers.
   */
  static async create(
    soundfont: ArrayBuffer | BasicSoundBank,
    sampleRate: number,
    { effects = false }: { effects?: boolean } = {},
  ): Promise<OfflineSf2Synth> {
    const bank = soundfont instanceof ArrayBuffer ? SoundBankLoader.fromArrayBuffer(soundfont) : soundfont;
    const processor = new SpessaSynthProcessor(sampleRate, { effectsEnabled: effects, eventsEnabled: false });
    processor.soundBankManager.addSoundBank(bank, "main");
    processor.setSystemParameter("autoAllocateVoices", true);
    await processor.ready;
    return new OfflineSf2Synth(processor);
  }

  /** Parses a SoundFont once so several synthesizers can share it. */
  static parseSoundBank(soundfont: ArrayBuffer): BasicSoundBank {
    return SoundBankLoader.fromArrayBuffer(soundfont);
  }

  allocateChannels(count: number): number[] {
    const channels: number[] = [];
    while (channels.length < count) {
      const channel = this.nextChannel++;
      if (channel % 16 === 9) continue;
      while (this.processor.midiChannels.length <= channel) this.processor.createMIDIChannel();
      channels.push(channel);
    }
    return channels;
  }

  process(left: Float32Array, right: Float32Array, offset: number, count: number): void {
    this.processor.process(left, right, offset, count);
  }

  get voiceCount(): number {
    return this.processor.voiceCount;
  }

  cancelScheduledNotes(): void {
    // Offline events are dispatched synchronously and never queued.
  }

  destroy(): void {
    this.processor.destroy();
  }
}
