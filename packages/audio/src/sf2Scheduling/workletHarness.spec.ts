import { createContext, runInContext } from "node:vm";
import { vi, type Mock } from "vitest";
import { buildSchedulingWorklet, cancelScheduledNotes } from "./index";
import type { Sf2Sampler } from "../Sf2Sampler";

export interface MidiEnvelope {
  type: "midiMessage";
  channelNumber: -1;
  data: {
    messageData: Uint8Array;
    channelOffset: number;
    options: { time: number };
  };
}

interface TestPort {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(data: unknown): void;
}

interface TestProcessor {
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: object): boolean;
}

const fakeVendor = `
class VendorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = event => receiveVendorMessage(event.data);
  }
  process() {
    renderVendorQuantum();
    return true;
  }
}
registerProcessor("test-synth", VendorProcessor);
`;

export function createWorkletHarness(
  vendorSource = fakeVendor,
  receiveVendorMessage: (data: unknown) => void = () => {},
  renderVendorQuantum: () => void = () => {},
) {
  const posted: unknown[] = [];
  const sent: unknown[] = [];
  const mainPort: TestPort = {
    onmessage: null,
    postMessage(data) {
      sent.push(structuredClone(data));
      workerPort.onmessage?.({ data: structuredClone(data) });
    },
  };
  const workerPort: TestPort = {
    onmessage: null,
    postMessage(data) {
      posted.push(structuredClone(data));
      queueMicrotask(() => mainPort.onmessage?.({ data: structuredClone(data) }));
    },
  };
  class AudioWorkletProcessor {
    get port() {
      return workerPort;
    }
  }
  let Processor: (new (options: object) => TestProcessor) | undefined;
  const registerProcessor = (_name: string, constructor: new (options: object) => TestProcessor) => {
    Processor = constructor;
  };
  const sandbox = createContext({
    AudioWorkletProcessor,
    registerProcessor,
    currentTime: 10,
    sampleRate: 48_000,
    WebAssembly,
    TextDecoder,
    TextEncoder,
    console: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    receiveVendorMessage,
    renderVendorQuantum,
  });
  runInContext(buildSchedulingWorklet(vendorSource), sandbox);
  if (!Processor) throw new Error("The worklet did not register a processor");
  const processor = new Processor({ processorOptions: { oneOutput: false, eventsEnabled: true } });
  const outputs = Array.from({ length: 17 }, () => [new Float32Array(128), new Float32Array(128)]);
  return {
    port: mainPort as unknown as MessagePort,
    posted,
    sent,
    sandbox,
    originalGlobals: { AudioWorkletProcessor, registerProcessor },
    advance(time: number) {
      sandbox.currentTime = time;
      return processor.process([], outputs, {});
    },
  };
}

export function midiEnvelope(bytes: number[], time = 0, channelOffset = 0): MidiEnvelope {
  return {
    type: "midiMessage",
    channelNumber: -1,
    data: { messageData: Uint8Array.from(bytes), channelOffset, options: { time } },
  };
}

export function createSamplerWorkletHarness() {
  const channels = Array.from({ length: 32 }, () => ({
    voices: new Set<number>(),
    released: new Set<number>(),
    controllers: new Map<number, number>(),
    program: 0,
    muted: false,
  }));
  const received: MidiEnvelope[] = [];
  const attacks: { channel: number; note: number; time: number }[] = [];
  const nativeQueue: MidiEnvelope[] = [];
  let time = 10;
  function apply(message: MidiEnvelope) {
    const [status, first = 0, second = 0] = message.data.messageData;
    const channelNumber = (status! & 0x0f) + message.data.channelOffset;
    const channel = channels[channelNumber]!;
    const release = () => {
      if ((channel.controllers.get(64) ?? 0) >= 64) {
        if (channel.voices.has(first)) channel.released.add(first);
      } else channel.voices.delete(first);
    };
    switch (status! & 0xf0) {
      case 0x90:
        if (second === 0) release();
        else if (!channel.muted) {
          channel.voices.add(first);
          channel.released.delete(first);
          attacks.push({ channel: channelNumber, note: first, time });
        }
        break;
      case 0x80:
        release();
        break;
      case 0xb0:
        channel.controllers.set(first, second);
        if (first === 120 || first === 123) {
          channel.voices.clear();
          channel.released.clear();
        } else if (first === 64 && second < 64) {
          for (const note of channel.released) channel.voices.delete(note);
          channel.released.clear();
        }
        break;
      case 0xc0:
        channel.program = first;
        break;
    }
  }
  const worklet = createWorkletHarness(
    fakeVendor,
    (data) => {
      const message = data as MidiEnvelope;
      received.push(message);
      if (message.data.options.time > time) nativeQueue.push(message);
      else apply(message);
    },
    () => {
      const due = nativeQueue.filter((message) => message.data.options.time <= time);
      for (const message of due) {
        nativeQueue.splice(nativeQueue.indexOf(message), 1);
        apply(message);
      }
    },
  );
  function sendMessage(bytes: Iterable<number>, offset = 0, options?: { time: number }) {
    worklet.port.postMessage(midiEnvelope([...bytes], options?.time, offset));
  }
  const synth = {
    noteOn: (channel: number, note: number, velocity: number, options?: { time: number }) =>
      sendMessage([0x90 | channel, note, velocity], 0, options),
    noteOff: (channel: number, note: number, options?: { time: number }) =>
      sendMessage([0x80 | channel, note], 0, options),
    controllerChange: (channel: number, cc: number, value: number, options?: { time: number }) =>
      sendMessage([0xb0 | channel, cc, value], 0, options),
    programChange: (channel: number, program: number) => sendMessage([0xc0 | channel, program]),
    sendMessage,
    midiChannels: channels.map((channel) => ({
      setDrums: () => {},
      setSystemParameter: (_parameter: "isMuted", value: boolean) => {
        channel.muted = value;
      },
    })),
    stopAll: () => {
      throw new Error("Global panic would affect unrelated channels");
    },
  };
  const outputNode = { gain: { value: 0.35 } };
  const sf2Synth = {
    synth,
    context: {
      state: "running",
      get currentTime() {
        return time;
      },
    },
    outputNode,
    cancelScheduledNotes: vi.fn((owned: readonly number[], cutoff: number) =>
      cancelScheduledNotes(worklet.port, owned, cutoff),
    ) as Mock<(owned: readonly number[], cutoff: number) => void>,
  };
  return {
    ...worklet,
    synth,
    sf2Synth: sf2Synth as unknown as ConstructorParameters<typeof Sf2Sampler>[0],
    cancel: sf2Synth.cancelScheduledNotes,
    channels,
    attacks,
    received,
    outputNode,
    setClock(nextTime: number) {
      time = nextTime;
      worklet.sandbox.currentTime = nextTime;
    },
    advance(nextTime: number) {
      time = nextTime;
      worklet.advance(nextTime);
    },
  };
}
