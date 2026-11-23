import { CLICK_LEVEL_CODES } from "./clickProgram";

export const CLICK_PROCESSOR_NAME = "viritura-click";

/** Synthesized click voices: [frequency Hz, duration s, peak gain] per level code. */
export const CLICK_VOICE_SPECS: readonly (readonly [number, number, number])[] = (() => {
  const specs: [number, number, number][] = [];
  specs[CLICK_LEVEL_CODES.accent] = [1760, 0.04, 0.9];
  specs[CLICK_LEVEL_CODES.beat] = [880, 0.03, 0.6];
  specs[CLICK_LEVEL_CODES.subdivision] = [660, 0.02, 0.3];
  return specs;
})();

/**
 * Source of the dedicated click AudioWorklet. It is served as a staged,
 * same-origin script (the production CSP forbids blob: worklets) and built as a
 * plain string so no bundler transform touches the audio-thread code.
 *
 * The processor owns the whole click program and a single anchor frame. Every
 * onset is placed by comparing program frames against the render quantum's
 * `currentFrame`, so a click lands on its exact sample no matter how busy the
 * main thread is. Nothing is allocated inside `process()`.
 */
export function buildClickWorklet(): string {
  return `"use strict";
const VOICE_SPECS = ${JSON.stringify(CLICK_VOICE_SPECS)};
const MAX_ACTIVE = 16;

function buildVoice(rate, frequency, duration, gain) {
  const length = Math.max(1, Math.ceil(duration * rate));
  const samples = new Float32Array(length);
  const decay = Math.log(1000) / length;
  for (let i = 0; i < length; i++) {
    samples[i] = gain * Math.sin((2 * Math.PI * frequency * i) / rate) * Math.exp(-decay * i);
  }
  return samples;
}

function lowerBound(frames, frame) {
  let low = 0;
  let high = frames.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (frames[middle] < frame) low = middle + 1;
    else high = middle;
  }
  return low;
}

function validProgram(frames, levels) {
  const tag = (value) => Object.prototype.toString.call(value);
  if (tag(frames) !== "[object Float64Array]" || tag(levels) !== "[object Uint8Array]") return false;
  if (frames.length !== levels.length) return false;
  let previous = 0;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (!Number.isFinite(frame) || frame < previous || levels[i] >= VOICE_SPECS.length) return false;
    previous = frame;
  }
  return true;
}

class ClickProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = VOICE_SPECS.map(([frequency, duration, gain]) => buildVoice(sampleRate, frequency, duration, gain));
    this.frames = new Float64Array(0);
    this.levels = new Uint8Array(0);
    this.running = false;
    this.anchorFrame = 0;
    this.offsetFrame = 0;
    this.next = 0;
    this.gain = 1;
    this.announced = false;
    this.activeVoice = new Int8Array(MAX_ACTIVE).fill(-1);
    this.activePosition = new Float64Array(MAX_ACTIVE);
    this.port.onmessage = (event) => this.receive(event.data);
  }

  receive(message) {
    const requestId = message.requestId;
    switch (message.type) {
      case "load": {
        if (this.running) return this.port.postMessage({ type: "error", requestId, code: "busy" });
        if (!validProgram(message.frames, message.levels)) {
          return this.port.postMessage({ type: "error", requestId, code: "invalid-program" });
        }
        this.frames = message.frames;
        this.levels = message.levels;
        return this.port.postMessage({ type: "loaded", requestId, count: this.frames.length });
      }
      case "start": {
        if (this.frames.length === 0) return this.port.postMessage({ type: "error", requestId, code: "no-program" });
        if (!(message.atFrame >= currentFrame)) {
          // Refuse rather than start late: a late anchor would drop or shift the countoff.
          return this.port.postMessage({ type: "error", requestId, code: "late-start", currentFrame });
        }
        this.anchorFrame = message.atFrame;
        this.offsetFrame = Math.max(0, message.offsetFrame);
        this.next = lowerBound(this.frames, this.offsetFrame);
        this.activeVoice.fill(-1);
        this.announced = false;
        this.running = true;
        return this.port.postMessage({ type: "armed", requestId, atFrame: this.anchorFrame });
      }
      case "stop": {
        const programFrame = this.running
          ? this.offsetFrame + Math.max(0, currentFrame - this.anchorFrame)
          : this.offsetFrame;
        this.running = false;
        this.offsetFrame = programFrame;
        this.activeVoice.fill(-1);
        return this.port.postMessage({ type: "stopped", requestId, programFrame });
      }
      case "gain":
        this.gain = Math.min(1, Math.max(0, Number(message.gain) || 0));
        return undefined;
      default:
        return undefined;
    }
  }

  startVoice(level, delay) {
    let slot = -1;
    let oldest = -1;
    for (let i = 0; i < MAX_ACTIVE; i++) {
      if (this.activeVoice[i] < 0) {
        slot = i;
        break;
      }
      if (oldest < 0 || this.activePosition[i] > this.activePosition[oldest]) oldest = i;
    }
    if (slot < 0) slot = oldest;
    this.activeVoice[slot] = level;
    this.activePosition[slot] = -delay;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const left = output[0];
    const length = left.length;
    left.fill(0);
    if (this.running) {
      const programStart = this.offsetFrame + (currentFrame - this.anchorFrame);
      const programEnd = programStart + length;
      let missed = 0;
      while (this.next < this.frames.length && this.frames[this.next] < programEnd) {
        const delay = this.frames[this.next] - programStart;
        if (delay >= 0) this.startVoice(this.levels[this.next], delay);
        else missed++;
        this.next++;
      }
      if (missed > 0) this.port.postMessage({ type: "missed", count: missed });
      if (!this.announced && currentFrame + length > this.anchorFrame) {
        this.announced = true;
        this.port.postMessage({ type: "started", atFrame: this.anchorFrame });
      }
      let sounding = false;
      for (let slot = 0; slot < MAX_ACTIVE; slot++) {
        const level = this.activeVoice[slot];
        if (level < 0) continue;
        const samples = this.voices[level];
        const position = this.activePosition[slot];
        const first = Math.max(0, -position);
        const last = Math.min(length, samples.length - position);
        for (let i = first; i < last; i++) left[i] += samples[position + i] * this.gain;
        this.activePosition[slot] = position + length;
        if (position + length >= samples.length) this.activeVoice[slot] = -1;
        else sounding = true;
      }
      if (!sounding && this.next >= this.frames.length && programStart >= this.offsetFrame) {
        this.running = false;
        this.offsetFrame = this.frames.length > 0 ? this.frames[this.frames.length - 1] : 0;
        this.port.postMessage({ type: "ended" });
      }
    }
    for (let channel = 1; channel < output.length; channel++) output[channel].set(left);
    return true;
  }
}

registerProcessor(${JSON.stringify(CLICK_PROCESSOR_NAME)}, ClickProcessor);
`;
}
