import type { ISampler, MidiEvent } from "./types";

export function samplerRoutingKey(event: MidiEvent): string | number {
  const lane = event.playbackLaneId ?? event.partIndex;
  return event.playbackInstrumentKey === undefined ? lane : JSON.stringify([lane, event.playbackInstrumentKey]);
}

export function dispatchSamplerEvent(sampler: ISampler, event: MidiEvent, audioTime?: number): void {
  switch (event.type) {
    case "noteOn":
      sampler.noteOn(event.midiNote, event.velocity, audioTime, event.drumKitProgram);
      break;
    case "noteOff":
      sampler.noteOff(event.midiNote, audioTime, event.drumKitProgram);
      break;
    case "programChange":
      if (event.instrumentChange) sampler.resetInstrument?.(audioTime);
      else if (event.program !== undefined) sampler.setProgram?.(event.program, audioTime);
      break;
    case "controlChange":
      if (event.cc !== undefined && event.value !== undefined) sampler.sendControl?.(event.cc, event.value, audioTime);
      break;
    case "pitchBend":
      if (!sampler.sendPitchBend || event.value === undefined) {
        throw new Error("Sampler does not support pitch-bend playback.");
      }
      sampler.sendPitchBend(event.value, audioTime, event.bendRange);
      break;
  }
}
