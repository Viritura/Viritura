/** spessasynth_lib 4.3 has no queue cancellation API. Own timed MIDI before it
 * reaches the native queue, without changing vendor state or worklet globals.
 * Keep this as worklet JavaScript rather than serializing a function: bundler
 * transforms can otherwise introduce references unavailable in the worklet. */
export function buildSchedulingWorklet(vendorSource: string): string {
  return `
(() => {
  const RealProcessor = globalThis.AudioWorkletProcessor;
  const realRegister = globalThis.registerProcessor.bind(globalThis);
  const drains = new WeakMap();

  class SchedulingProcessor extends RealProcessor {
    constructor() {
      super();
      const realPort = this.port;
      let handler = null;
      let queue = [];
      const forward = (event) => {
        if (handler) handler.call(port, event);
      };
      const forwardMidi = (event) => {
        const message = event.data;
        // Zero prevents the native core from queueing again, even when its
        // internal clock differs slightly from the AudioWorklet clock.
        // The vendor onmessage callback consumes only the data envelope.
        forward({ data: {
          ...message,
          data: { ...message.data, options: { ...message.data.options, time: 0 } }
        } });
      };
      const drain = (throughTime) => {
        let count = 0;
        while (count < queue.length && queue[count].data.data.options.time <= throughTime) {
          forwardMidi(queue[count++]);
        }
        if (count) queue.splice(0, count);
      };
      const receive = (event) => {
        const message = event.data;
        if (message?.type === "viritura:cancelScheduledNotes") {
          const { channels, fromAudioTime } = message;
          const owned = new Set(channels);
          queue = queue.filter((event) => {
            const { messageData, channelOffset, options } = event.data.data;
            const status = messageData[0];
            const kind = status & 0xf0;
            return !(options.time >= fromAudioTime &&
              (kind === 0x80 || kind === 0x90) &&
              owned.has((status & 0x0f) + channelOffset));
          });
          return;
        }
        if (message?.type !== "midiMessage") {
          forward(event);
          return;
        }
        const time = message.data.options?.time;
        if (time > currentTime) {
          // Upper-bound insertion keeps arrival order at equal timestamps,
          // including controllers and program changes preceding an attack.
          let low = 0;
          let high = queue.length;
          while (low < high) {
            const mid = (low + high) >>> 1;
            if (queue[mid].data.data.options.time <= time) low = mid + 1;
            else high = mid;
          }
          queue.splice(low, 0, event);
        } else {
          // Due MIDI must not overtake older queued state. Drain only here,
          // after any preceding cancellation has removed obsolete attacks.
          drain(time > 0 ? time : currentTime);
          forwardMidi(event);
        }
      };
      const port = new Proxy(realPort, {
        get(target, key) {
          if (key === "onmessage") return handler;
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
        set(target, key, value) {
          if (key !== "onmessage") return Reflect.set(target, key, value, target);
          handler = value;
          // Preserve MessagePort's buffering until the vendor is initialized.
          target.onmessage = value ? receive : null;
          return true;
        }
      });
      Object.defineProperty(this, "port", { value: port });
      drains.set(this, () => drain(currentTime));
    }
  }

  const register = (name, VendorProcessor) => {
    realRegister(name, class extends VendorProcessor {
      process(...args) {
        drains.get(this)();
        return super.process(...args);
      }
    });
  };
  ((AudioWorkletProcessor, registerProcessor) => {
${vendorSource}
  })(SchedulingProcessor, register);
})();
`;
}
