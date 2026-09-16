import { validateWavBytes } from "./sampleWav.js";
import { validateEvents, validateInteger, validateNumber } from "./performanceEvents.js";

const commandTimeoutMs = 60000;
const loadTimeoutMs = 120000;
const maxGain = 0.6;
const processorUrl = new URL("./sfizzProcessor.js", import.meta.url);

export class SfizzAudioWorkletPlayer {
  constructor({ meterElement, onError, onMetrics }) {
    this.analyser = null;
    this.commandId = 0;
    this.compressor = null;
    this.context = null;
    this.currentRequestId = 0;
    this.gain = null;
    this.meterElement = meterElement;
    this.monitorAnimation = 0;
    this.monitorStopTimeout = 0;
    this.node = null;
    this.onError = onError;
    this.onMetrics = onMetrics;
    this.pending = new Map();
  }

  async loadPatch(plan) {
    await this.close();
    try {
      await this.createContext();
      await this.resume();
      await this.sendCommand("prepare", {}, { timeoutMs: commandTimeoutMs });
      const wavFormats = [];
      for (const sample of plan.samples) {
        const bytes = new Uint8Array(await sample.file.arrayBuffer());
        wavFormats.push({ path: sample.originalPath, ...validateWavBytes(bytes, sample.originalPath) });
        await this.sendCommand(
          "writeSample",
          { bytes, path: sample.virtualPath },
          { timeoutMs: commandTimeoutMs, transfer: [bytes.buffer] },
        );
      }
      const result = await this.sendCommand(
        "loadPatch",
        {
          expectedRegions: plan.expectedRegionCount,
          path: "/vsco/patch.sfz",
          sfz: plan.rewrittenSfz,
        },
        { timeoutMs: loadTimeoutMs },
      );
      await this.resume();
      return { ...result, wavFormats };
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async reloadPatch(plan) {
    if (!this.node) {
      throw new Error("Load an SFZ patch before reloading it.");
    }
    return await this.sendCommand(
      "loadPatch",
      {
        expectedRegions: plan.expectedRegionCount,
        path: "/vsco/patch.sfz",
        sfz: plan.rewrittenSfz,
      },
      { timeoutMs: loadTimeoutMs },
    );
  }

  async resume() {
    if (!this.context) {
      throw new Error("Load an SFZ patch before playback.");
    }
    await this.context.resume();
  }

  async playEvents(events, gainValue) {
    const validatedEvents = validateEvents(events);
    await this.resume();
    this.setGain(gainValue);
    const requestId = this.currentRequestId + 1;
    this.currentRequestId = requestId;
    this.startMonitor(requestId);
    await this.sendCommand("events", { events: validatedEvents, requestId, resetStats: true });
    return requestId;
  }

  async sendCc(number, value) {
    if (!this.node) {
      return null;
    }
    return await this.sendCommand("cc", {
      number: validateInteger(number, "CC number", 0, 127),
      value: validateNumber(value, "CC value", 0, 1),
    });
  }

  async panic() {
    if (this.gain) {
      this.gain.gain.cancelScheduledValues(this.context.currentTime);
      this.gain.gain.setValueAtTime(0, this.context.currentTime);
    }
    if (!this.node) {
      this.stopMonitor();
      return { activeVoices: 0, pendingEvents: 0 };
    }
    const result = await this.sendCommand("reset", {});
    this.stopMonitorSoon();
    return result;
  }

  setGain(value) {
    const gain = validateNumber(value, "Master gain", 0, maxGain);
    if (this.gain) {
      this.gain.gain.setTargetAtTime(gain, this.context.currentTime, 0.01);
    }
  }

  async close() {
    this.stopMonitor();
    this.rejectPending(new Error("sfizz AudioWorklet context was closed."));
    const context = this.context;
    if (this.node) {
      this.node.port.postMessage({ command: "shutdown", id: 0 });
      this.node.port.onmessage = null;
      this.node.port.close();
      this.node.onprocessorerror = null;
      this.node.disconnect();
    }
    this.node = null;
    this.analyser = null;
    this.compressor = null;
    this.gain = null;
    this.context = null;
    if (context && context.state !== "closed") {
      await context.close();
    }
  }

  async createContext() {
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    this.context = new AudioContextClass();
    await this.context.audioWorklet.addModule(processorUrl);
    this.node = new AudioWorkletNode(this.context, "sfizz-browser-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.gain = new GainNode(this.context, { gain: 0 });
    this.compressor = new DynamicsCompressorNode(this.context, {
      attack: 0.003,
      knee: 6,
      ratio: 20,
      release: 0.1,
      threshold: -6,
    });
    this.analyser = new AnalyserNode(this.context, { fftSize: 2048 });
    this.node.connect(this.gain).connect(this.compressor).connect(this.analyser).connect(this.context.destination);
    this.node.port.onmessage = (event) => this.handleProcessorMessage(event.data);
    this.node.onprocessorerror = (event) => {
      const error = new Error(`sfizz AudioWorklet processor failed: ${event.message ?? "unknown error"}`);
      this.rejectPending(error);
      this.gain.gain.setValueAtTime(0, this.context.currentTime);
      this.onError?.(error);
    };
  }

  sendCommand(command, payload = {}, options = {}) {
    if (!this.node) {
      return Promise.reject(new Error("sfizz AudioWorklet is not running."));
    }
    const id = this.commandId + 1;
    this.commandId = id;
    const timeoutMs = options.timeoutMs ?? commandTimeoutMs;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for sfizz worklet command: ${command}`));
      }, timeoutMs);
      this.pending.set(id, { reject, resolve, timeout });
      try {
        this.node.port.postMessage({ ...payload, command, id }, options.transfer ?? []);
      } catch (error) {
        window.clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  handleProcessorMessage(message) {
    if (message.type === "metrics") {
      this.onMetrics?.(message.metrics);
      return;
    }
    if (message.type !== "ack" && message.type !== "error") {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    window.clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    if (message.type === "error") {
      pending.reject(new Error(message.error));
      return;
    }
    pending.resolve(message.result);
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  startMonitor(requestId) {
    this.stopMonitor();
    const samples = new Float32Array(this.analyser.fftSize);
    const update = () => {
      this.analyser.getFloatTimeDomainData(samples);
      const peak = samples.reduce((currentPeak, value) => Math.max(currentPeak, Math.abs(value)), 0);
      this.meterElement.style.width = `${Math.min(100, peak * 120)}%`;
      this.onMetrics?.({ analyserPeak: peak, requestId, source: "analyser" });
      this.monitorAnimation = requestAnimationFrame(update);
    };
    update();
  }

  stopMonitorSoon() {
    window.clearTimeout(this.monitorStopTimeout);
    this.monitorStopTimeout = window.setTimeout(() => this.stopMonitor(), 250);
  }

  stopMonitor() {
    window.clearTimeout(this.monitorStopTimeout);
    this.monitorStopTimeout = 0;
    if (this.monitorAnimation) {
      cancelAnimationFrame(this.monitorAnimation);
      this.monitorAnimation = 0;
    }
    if (this.meterElement) {
      this.meterElement.style.width = "0%";
    }
  }
}
