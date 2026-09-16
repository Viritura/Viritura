/* global AudioWorkletProcessor, registerProcessor, sampleRate -- AudioWorklet globals supplied by the browser. */
import createSfizzModule from "../vendor/sfizz.wasm.min.js";
import { validateEvents, validateInteger, validateNumber } from "./performanceEvents.js";

const renderBlockFrames = 128;
const metricsIntervalFrames = 2048;
const sfizzModule = createSfizzModule();

class SfizzBrowserProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.events = [];
    this.frame = 0;
    this.leftPointer = 0;
    this.loadedSfz = "";
    this.module = sfizzModule;
    this.nextMetricsFrame = 0;
    this.requestId = 0;
    this.rightPointer = 0;
    this.samplePaths = [];
    this.synth = null;
    this.stats = createStats(0);
    this.validateModule();
    this.allocateRenderBuffers(renderBlockFrames);
    this.port.onmessage = (message) => this.handleCommand(message.data);
  }

  countActiveVoices() {
    return this.synth?.numActiveVoices() ?? 0;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output?.[0] || !output[1]) {
      return true;
    }
    const frames = output[0].length;
    this.ensureRenderBufferCapacity(frames);
    if (!this.synth) {
      output[0].fill(0);
      output[1].fill(0);
      this.updateStats(output[0], output[1], frames);
      this.frame += frames;
      return true;
    }

    this.dispatchDueEvents(frames);
    this.synth.render(this.leftPointer, this.rightPointer, frames);
    const left = this.heapView(this.leftPointer, frames);
    const right = this.heapView(this.rightPointer, frames);
    output[0].set(left);
    output[1].set(right);
    this.updateStats(left, right, frames);
    this.frame += frames;
    return true;
  }

  handleCommand(message) {
    const { id } = message;
    try {
      const result = this.runCommand(message);
      this.port.postMessage({ id, result, type: "ack" });
    } catch (error) {
      this.port.postMessage({
        error: error instanceof Error ? error.message : String(error),
        id,
        type: "error",
      });
    }
  }

  runCommand(message) {
    switch (message.command) {
      case "prepare":
        return this.prepare();
      case "writeSample":
        return this.writeSample(message);
      case "loadPatch":
        return this.loadPatch(message);
      case "events":
        return this.scheduleEvents(message);
      case "cc":
        return this.dispatchImmediateCc(message);
      case "reset":
        return this.resetSynth();
      case "shutdown":
        return this.shutdown();
      default:
        throw new Error(`Unknown sfizz worklet command: ${message.command}`);
    }
  }

  prepare() {
    this.deleteSynth();
    this.clearVirtualSamples();
    this.loadedSfz = "";
    this.events = [];
    this.module.FS.mkdirTree("/vsco");
    this.module.FS.chdir("/");
    this.synth = new this.module.SfizzWrapper(sampleRate);
    this.stats = createStats(0);
    return { ready: true, sampleRate };
  }

  writeSample(message) {
    const path = validateVirtualPath(message.path);
    if (!(message.bytes instanceof Uint8Array) || message.bytes.byteLength === 0) {
      throw new Error(`No WAV bytes were provided for ${path}.`);
    }
    this.module.FS.writeFile(path, message.bytes);
    this.samplePaths.push(path);
    return { bytes: message.bytes.byteLength, path };
  }

  loadPatch(message) {
    if (typeof message.sfz !== "string" || message.sfz.length === 0) {
      throw new Error("Cannot load an empty SFZ patch.");
    }
    const expectedRegions = validateInteger(message.expectedRegions, "expected region count", 1, 100000);
    if (!this.synth) {
      throw new Error("The sfizz wrapper was not prepared.");
    }
    const sfzPath = validateVirtualSfzPath(message.path ?? "/vsco/patch.sfz");
    const loadResult = this.synth.loadAtPath(sfzPath, message.sfz);
    if (loadResult === false) {
      this.deleteSynth();
      throw new Error("sfizz rejected the rewritten SFZ patch.");
    }
    const regions = this.synth.numRegions();
    if (regions !== expectedRegions) {
      this.deleteSynth();
      throw new Error(`sfizz loaded ${regions} regions; expected ${expectedRegions}.`);
    }
    this.loadedSfz = message.sfz;
    this.events = [];
    return { activeVoices: this.synth.numActiveVoices(), regions };
  }

  scheduleEvents(message) {
    if (!this.synth) {
      throw new Error("No sfizz patch is loaded.");
    }
    const requestId = validateInteger(message.requestId, "request id", 1, Number.MAX_SAFE_INTEGER);
    const absoluteEvents = validateEvents(message.events).map((event) => ({
      ...event,
      frame: this.frame + Math.max(0, Math.round(event.time * sampleRate)),
    }));
    this.resetSynth();
    this.events = absoluteEvents.sort((left, right) => left.frame - right.frame);
    if (message.resetStats) {
      this.requestId = requestId;
      this.stats = createStats(requestId);
      this.nextMetricsFrame = this.frame + metricsIntervalFrames;
    }
    return { eventCount: absoluteEvents.length, requestId };
  }

  dispatchImmediateCc(message) {
    if (!this.synth) {
      throw new Error("No sfizz patch is loaded.");
    }
    const number = validateInteger(message.number, "CC number", 0, 127);
    const value = validateNumber(message.value, "CC value", 0, 1);
    this.synth.cc(0, number, value);
    return { number, value };
  }

  resetSynth() {
    this.events = [];
    // sfizz handles MIDI All Sound Off by resetting voices without reloading samples.
    this.synth?.cc(0, 120, 0);
    this.stats.windowFrames = 0;
    this.stats.windowPeak = 0;
    this.stats.windowSumSquares = 0;
    return { activeVoices: this.countActiveVoices(), pendingEvents: this.events.length };
  }

  shutdown() {
    this.deleteSynth();
    this.clearVirtualSamples();
    this.freeRenderBuffers();
    return { closed: true };
  }

  dispatchDueEvents(frames) {
    const blockEnd = this.frame + frames;
    let nextIndex = 0;
    while (nextIndex < this.events.length && this.events[nextIndex].frame < blockEnd) {
      const event = this.events[nextIndex];
      const delay = Math.max(0, event.frame - this.frame);
      this.dispatchEvent(event, delay);
      nextIndex += 1;
    }
    if (nextIndex > 0) {
      this.events.splice(0, nextIndex);
    }
  }

  dispatchEvent(event, delay) {
    if (event.type === "noteOn") {
      this.synth.noteOn(delay, event.note, event.velocity);
      return;
    }
    if (event.type === "noteOff") {
      this.synth.noteOff(delay, event.note, event.velocity);
      return;
    }
    this.synth.cc(delay, event.number, event.value);
  }

  updateStats(left, right, frames) {
    for (let index = 0; index < frames; index += 1) {
      const peak = Math.max(Math.abs(left[index]), Math.abs(right[index]));
      const square = (left[index] * left[index] + right[index] * right[index]) / 2;
      this.stats.peak = Math.max(this.stats.peak, peak);
      this.stats.sumSquares += square;
      this.stats.windowPeak = Math.max(this.stats.windowPeak, peak);
      this.stats.windowSumSquares += square;
      if (peak > 0.0005) {
        this.stats.activeFrames += 1;
      }
    }
    this.stats.frames += frames;
    this.stats.windowFrames += frames;
    if (this.requestId && this.frame >= this.nextMetricsFrame) {
      this.postMetrics();
      this.nextMetricsFrame = this.frame + metricsIntervalFrames;
    }
  }

  postMetrics() {
    const frames = Math.max(1, this.stats.frames);
    const windowFrames = Math.max(1, this.stats.windowFrames);
    this.port.postMessage({
      metrics: {
        activeMs: (this.stats.activeFrames / sampleRate) * 1000,
        activeVoices: this.countActiveVoices(),
        frames: this.stats.frames,
        peak: this.stats.peak,
        pendingEvents: this.events.length,
        requestId: this.requestId,
        rms: Math.sqrt(this.stats.sumSquares / frames),
        sampleRate,
        windowPeak: this.stats.windowPeak,
        windowRms: Math.sqrt(this.stats.windowSumSquares / windowFrames),
      },
      type: "metrics",
    });
    this.stats.windowFrames = 0;
    this.stats.windowPeak = 0;
    this.stats.windowSumSquares = 0;
  }

  allocateRenderBuffers(frames) {
    this.leftPointer = this.module._malloc(frames * Float32Array.BYTES_PER_ELEMENT);
    this.rightPointer = this.module._malloc(frames * Float32Array.BYTES_PER_ELEMENT);
    this.renderBufferFrames = frames;
  }

  ensureRenderBufferCapacity(frames) {
    if (frames <= this.renderBufferFrames) {
      return;
    }
    this.freeRenderBuffers();
    this.allocateRenderBuffers(frames);
  }

  freeRenderBuffers() {
    if (this.leftPointer) {
      this.module._free(this.leftPointer);
      this.leftPointer = 0;
    }
    if (this.rightPointer) {
      this.module._free(this.rightPointer);
      this.rightPointer = 0;
    }
    this.renderBufferFrames = 0;
  }

  heapView(pointer, frames) {
    return new Float32Array(this.module.HEAPF32.buffer, pointer, frames);
  }

  deleteSynth() {
    if (this.synth) {
      this.synth.delete();
      this.synth = null;
    }
  }

  clearVirtualSamples() {
    for (const path of this.samplePaths) {
      try {
        this.module.FS.unlink(path);
      } catch (error) {
        if (error?.errno !== 44) {
          throw error;
        }
      }
    }
    this.samplePaths = [];
  }

  validateModule() {
    if (
      !this.module?.SfizzWrapper ||
      !this.module?.FS ||
      !this.module?.HEAPF32 ||
      !this.module?._malloc ||
      !this.module?._free
    ) {
      throw new Error("Pinned sfizz module did not expose the required wrapper, filesystem, heap, and allocator APIs.");
    }
  }
}

function createStats(requestId) {
  return {
    activeFrames: 0,
    frames: 0,
    peak: 0,
    requestId,
    sumSquares: 0,
    windowFrames: 0,
    windowPeak: 0,
    windowSumSquares: 0,
  };
}

function validateVirtualPath(path) {
  if (typeof path !== "string" || !/^\/vsco\/[A-Za-z0-9._-]+\.wav$/i.test(path)) {
    throw new Error(`Unsupported virtual sample path: ${path}`);
  }
  return path;
}

function validateVirtualSfzPath(path) {
  if (typeof path !== "string" || !/^\/vsco\/[A-Za-z0-9._-]+\.sfz$/i.test(path)) {
    throw new Error(`Unsupported virtual SFZ path: ${path}`);
  }
  return path;
}

registerProcessor("sfizz-browser-processor", SfizzBrowserProcessor);
