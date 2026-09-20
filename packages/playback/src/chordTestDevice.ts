import { Sf2Synth } from "@viritura/audio";
import { vi, type Mock } from "vitest";
import type { VstTransport } from "./vstTransport";

function audioParam(value = 0) {
  return {
    value,
    cancelScheduledValues: () => {},
    setValueAtTime(next: number) {
      this.value = next;
    },
    setTargetAtTime: () => {},
    exponentialRampToValueAtTime: () => {},
  };
}

function audioNode(context: object) {
  return {
    context,
    connect: () => {},
    disconnect: () => {},
    start: () => {},
    stop: () => {},
    gain: audioParam(1),
    frequency: audioParam(),
    Q: audioParam(),
    threshold: audioParam(),
    ratio: audioParam(),
    knee: audioParam(),
    attack: audioParam(),
    release: audioParam(),
    delayTime: audioParam(),
    positionX: audioParam(),
    positionY: audioParam(),
    positionZ: audioParam(),
  };
}

export class ChordTestDevice {
  currentTime = 10;
  state = "running";
  destination = {};
  listener = {};
  createGain = (): ReturnType<typeof audioNode> => audioNode(this);
  createBiquadFilter = (): ReturnType<typeof audioNode> => audioNode(this);
  createDynamicsCompressor = (): ReturnType<typeof audioNode> => audioNode(this);
  createDelay = (): ReturnType<typeof audioNode> => audioNode(this);
  createPanner = (): ReturnType<typeof audioNode> => audioNode(this);
  createConvolver = (): ReturnType<typeof audioNode> => audioNode(this);
  createOscillator = (): ReturnType<typeof audioNode> => audioNode(this);
  decodeAudioData = async () => ({ duration: 1, sampleRate: 48000 });
  resume = async () => {};
  close = vi.fn(async () => {
    this.state = "closed";
  });
}

// Keep the sampler, engine, reverb, metronome and MIDI generation real.
type MockMethods<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? Mock<T[K]> : T[K];
};

interface RecordingSynth extends Pick<Sf2Synth, "context" | "outputNode"> {
  warmUp: Mock<Sf2Synth["warmUp"]>;
  cancelScheduledNotes: Mock<Sf2Synth["cancelScheduledNotes"]>;
  destroy: Mock<Sf2Synth["destroy"]>;
  synth: MockMethods<Sf2Synth["synth"]>;
}

export function recordingSynth(context: AudioContext): RecordingSynth {
  return {
    context,
    outputNode: context.createGain(),
    warmUp: vi.fn<Sf2Synth["warmUp"]>().mockResolvedValue(undefined),
    cancelScheduledNotes: vi.fn<Sf2Synth["cancelScheduledNotes"]>(),
    destroy: vi.fn(),
    synth: {
      controllerChange: vi.fn<Sf2Synth["synth"]["controllerChange"]>(),
      programChange: vi.fn<Sf2Synth["synth"]["programChange"]>(),
      noteOn: vi.fn<Sf2Synth["synth"]["noteOn"]>(),
      noteOff: vi.fn<Sf2Synth["synth"]["noteOff"]>(),
      sendMessage: vi.fn(),
      stopAll: vi.fn(),
      midiChannels: Array.from({ length: 16 }, () => ({
        setDrums: vi.fn<Sf2Synth["synth"]["midiChannels"][number]["setDrums"]>(),
        setSystemParameter: vi.fn<Sf2Synth["synth"]["midiChannels"][number]["setSystemParameter"]>(),
      })),
      connect: vi.fn<(node: AudioNode) => AudioNode>((node) => node),
      isReady: Promise.resolve(),
      soundBankManager: { addSoundBank: vi.fn().mockResolvedValue(undefined) },
      presetList: [],
    },
  } satisfies Pick<Sf2Synth, keyof Sf2Synth>;
}

export function nativeTransport() {
  return {
    prepare: vi.fn<VstTransport["prepare"]>().mockImplementation(async (_score, plan) => {
      return new Set(plan.sf2Parts.map((part) => part.partIndex));
    }),
    start: vi.fn<VstTransport["start"]>().mockResolvedValue(undefined),
    stop: vi.fn<VstTransport["stop"]>().mockResolvedValue(undefined),
    seek: vi.fn<VstTransport["seek"]>().mockResolvedValue(undefined),
    setPartGain: vi.fn<VstTransport["setPartGain"]>().mockResolvedValue(undefined),
    setPartPan: vi.fn<NonNullable<VstTransport["setPartPan"]>>().mockResolvedValue(undefined),
    setMutedParts: vi.fn<VstTransport["setMutedParts"]>().mockResolvedValue(undefined),
    previewNote: vi.fn<VstTransport["previewNote"]>().mockResolvedValue(true),
    previewChord: vi.fn<NonNullable<VstTransport["previewChord"]>>().mockResolvedValue(true),
    release: vi.fn<VstTransport["release"]>().mockResolvedValue(undefined),
  } satisfies VstTransport;
}
