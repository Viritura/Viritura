/* Qualification-only AudioWorklet: records the click node's output stamped with render frames. */
/* global AudioWorkletProcessor, currentFrame, registerProcessor -- AudioWorkletGlobalScope */
class ClickQualificationTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.data = new Float32Array(options.processorOptions.capacity);
    this.length = 0;
    this.startFrame = -1;
    this.lastFrame = -1;
    this.discontinuities = 0;
    this.port.onmessage = () => {
      this.port.postMessage({
        startFrame: this.startFrame,
        discontinuities: this.discontinuities,
        overflow: this.length >= this.data.length,
        data: this.data.slice(0, this.length),
      });
    };
  }

  process(inputs) {
    if (this.startFrame < 0) this.startFrame = currentFrame;
    if (this.lastFrame >= 0 && currentFrame !== this.lastFrame + 128) this.discontinuities++;
    this.lastFrame = currentFrame;
    const channel = inputs[0] && inputs[0][0];
    const count = Math.min(128, this.data.length - this.length);
    if (channel) this.data.set(channel.subarray(0, count), this.length);
    this.length += count;
    return true;
  }
}

registerProcessor("click-qualification-tap", ClickQualificationTap);
