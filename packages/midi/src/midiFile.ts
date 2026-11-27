import type { MidiEvent, MidiTimeline } from "./types";

const TICKS_PER_BEAT = 9600;
const MAX_VLQ = 0x0fffffff;
const MAX_TEMPO = 0xffffff;

interface TimedBytes {
  tick: number;
  order: number;
  bytes: number[];
}

interface TimeSegment {
  startTime: number;
  endTime: number;
  startTick: number;
  endTick: number;
  tempo: number;
}

function tempoSegments(timeline: MidiTimeline): TimeSegment[] {
  const { model } = timeline;
  const lastTime = timeline.events.reduce((latest, event) => Math.max(latest, event.time), timeline.duration);
  const endBeat = Math.max(timeline.totalBeats, model.beatAtTime(lastTime), 0);
  const points = model.breakpoints().filter(({ beat }) => beat >= 0 && beat <= endBeat);
  const segments: TimeSegment[] = [];
  let tick = 0;
  // Point holds add beats; tempo ramps use short constant-tempo segments.
  const add = (startTime: number, endTime: number, beats: number) => {
    if (
      !Number.isFinite(startTime) ||
      !Number.isFinite(endTime) ||
      !Number.isFinite(beats) ||
      beats <= 0 ||
      endTime <= startTime
    ) {
      throw new Error("The score contains an invalid tempo interval.");
    }
    const tempo = Math.round(((endTime - startTime) / beats) * 1_000_000);
    if (!Number.isFinite(tempo) || tempo < 1 || tempo > MAX_TEMPO) {
      throw new Error("The score contains a tempo that cannot be represented in a MIDI file.");
    }
    const endTick = tick + beats * TICKS_PER_BEAT;
    segments.push({ startTime, endTime, startTick: tick, endTick, tempo });
    tick = endTick;
  };
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    const start = model.timeAtBeat(point.beat);
    if (point.insertionSeconds > 0) {
      add(start - point.insertionSeconds, start, point.insertionSeconds / model.spbAtBeat(point.beat));
    }
    const endBeatHere = points[i + 1]?.beat ?? endBeat;
    const length = endBeatHere - point.beat;
    if (length <= 0) continue;
    const bpmStart = model.bpmAtBeat(point.beat);
    const bpmEnd = model.bpmAtBeat(endBeatHere - Math.min(length / 2, 1e-7));
    const divisions = Math.abs(bpmEnd - bpmStart) > 1e-6 ? Math.ceil(length * 32) : 1;
    for (let step = 0; step < divisions; step++) {
      const a = point.beat + (length * step) / divisions;
      const b = point.beat + (length * (step + 1)) / divisions;
      add(model.timeAtBeat(a), model.timeAtBeat(b, "release"), b - a);
    }
  }
  return segments;
}

function tickAtTime(segments: readonly TimeSegment[], time: number): number {
  if (!Number.isFinite(time)) throw new Error("The score contains an invalid playback time.");
  if (time <= 0) return 0;
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (segments[mid]!.endTime < time) low = mid + 1;
    else high = mid;
  }
  const segment = segments[low]!;
  const fraction = Math.max(0, Math.min(1, (time - segment.startTime) / (segment.endTime - segment.startTime)));
  return Math.round(segment.startTick + fraction * (segment.endTick - segment.startTick));
}

function variableLength(value: number): number[] {
  if (!Number.isInteger(value) || value < 0 || value > MAX_VLQ) {
    throw new Error("The score is too long to represent as a MIDI file.");
  }
  const bytes = [value & 0x7f];
  while ((value = Math.floor(value / 128)) > 0) bytes.unshift((value & 0x7f) | 0x80);
  return bytes;
}

function uint32(value: number): number[] {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new Error("MIDI file is too large.");
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function meta(type: number, data: number[]): number[] {
  return [0xff, type, ...variableLength(data.length), ...data];
}

function track(events: TimedBytes[], endTick: number): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const data: number[] = [];
  let previous = 0;
  for (const event of events) {
    data.push(...variableLength(event.tick - previous), ...event.bytes);
    previous = event.tick;
  }
  data.push(...variableLength(Math.max(0, endTick - previous)), 0xff, 0x2f, 0);
  return [0x4d, 0x54, 0x72, 0x6b, ...uint32(data.length), ...data];
}

function channelMessage(event: MidiEvent): number[] | undefined {
  const channel = event.channel;
  if (!Number.isInteger(channel) || channel < 0 || channel > 15) throw new Error("Invalid MIDI channel.");
  const byte = (value: number | undefined): number => {
    if (value === undefined || !Number.isInteger(value) || value < 0 || value > 127) {
      throw new Error("The score contains an invalid MIDI event.");
    }
    return value;
  };
  switch (event.type) {
    case "noteOn":
      return [0x90 | channel, byte(event.midiNote), byte(event.velocity)];
    case "noteOff":
      return [0x80 | channel, byte(event.midiNote), byte(event.velocity)];
    case "controlChange":
      return [0xb0 | channel, byte(event.cc), byte(event.value)];
    case "programChange":
      return event.program === undefined ? undefined : [0xc0 | channel, byte(event.program)];
    case "pitchBend": {
      const value = event.value;
      if (value === undefined || !Number.isInteger(value) || value < 0 || value > 16383) {
        throw new Error("The score contains an invalid MIDI pitch bend.");
      }
      return [0xe0 | channel, value & 127, value >> 7];
    }
  }
}

/** Serialize the already-realized performance to a type 1 Standard MIDI File. */
export function writeMidiFile(
  timeline: MidiTimeline,
  partNames: readonly string[],
  programs: readonly number[],
): Uint8Array {
  if (timeline.duration <= 0 || !Number.isFinite(timeline.duration)) {
    throw new Error("The document has no playable duration to export.");
  }
  const segments = tempoSegments(timeline);
  const lastSegment = segments.at(-1);
  if (!lastSegment) throw new Error("The score has no valid MIDI tempo interval.");
  const endTick = Math.round(lastSegment.endTick);
  const conductor: TimedBytes[] = [];
  let previousTempo = -1;
  for (const segment of segments) {
    if (segment.tempo === previousTempo) continue;
    conductor.push({
      tick: Math.round(segment.startTick),
      order: 0,
      bytes: meta(0x51, [(segment.tempo >> 16) & 255, (segment.tempo >> 8) & 255, segment.tempo & 255]),
    });
    previousTempo = segment.tempo;
  }
  let lastMeter = "";
  timeline.measureTimeSignatures.forEach(({ count, unit }, index) => {
    const meter = `${count}/${unit}`;
    if (meter === lastMeter) return;
    const exponent = Math.log2(unit);
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 255 ||
      !Number.isInteger(exponent) ||
      exponent < 0 ||
      exponent > 7
    ) {
      throw new Error(`The time signature ${meter} cannot be represented in a MIDI file.`);
    }
    conductor.push({
      tick: tickAtTime(segments, timeline.measureStartTimes[index]!),
      order: 1,
      bytes: meta(0x58, [count, exponent, 24, 8]),
    });
    lastMeter = meter;
  });
  const tracks = partNames.map((name, partIndex) => {
    const events: TimedBytes[] = [{ tick: 0, order: 0, bytes: meta(0x03, [...new TextEncoder().encode(name)]) }];
    const partEvents = timeline.events.filter((event) => event.partIndex === partIndex);
    const channels = new Set(partEvents.map((event) => event.channel));
    for (const channel of channels) {
      if (channel === 9) continue;
      const program = programs[partIndex];
      if (program === undefined || !Number.isInteger(program) || program < 0 || program > 127) {
        throw new Error(`No MIDI instrument program is available for "${name}".`);
      }
      events.push({ tick: 0, order: 1, bytes: [0xc0 | channel, program] });
    }
    for (const event of partEvents) {
      const bytes = channelMessage(event);
      if (!bytes) continue;
      const order = event.type === "noteOff" ? 2 : event.type === "noteOn" ? 4 : 3;
      events.push({ tick: tickAtTime(segments, event.time), order, bytes });
    }
    return track(events, endTick);
  });
  if (tracks.length + 1 > 0xffff) throw new Error("The score has too many MIDI tracks.");
  return new Uint8Array([
    0x4d,
    0x54,
    0x68,
    0x64,
    0,
    0,
    0,
    6,
    0,
    1,
    ((tracks.length + 1) >> 8) & 255,
    (tracks.length + 1) & 255,
    TICKS_PER_BEAT >> 8,
    TICKS_PER_BEAT & 255,
    ...track(conductor, endTick),
    ...tracks.flat(),
  ]);
}
