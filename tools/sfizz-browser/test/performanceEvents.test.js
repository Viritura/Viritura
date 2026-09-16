import assert from "node:assert/strict";
import test from "node:test";
import { maxScheduleSeconds, validateEvents } from "../src/performanceEvents.js";

test("rejects non-finite, out-of-range and empty playback requests", () => {
  const note = { note: 60, time: 0.05, type: "noteOn", velocity: 0.8 };
  assert.throws(() => validateEvents([]), /between 1/);
  assert.throws(() => validateEvents([{ ...note, time: Infinity }]), /Event time/);
  assert.throws(() => validateEvents([{ ...note, time: maxScheduleSeconds + 1 }]), /Event time/);
  assert.throws(() => validateEvents([{ ...note, note: 128 }]), /MIDI note/);
  assert.throws(() => validateEvents([{ ...note, velocity: NaN }]), /Velocity/);
  assert.throws(() => validateEvents([{ type: "cc", time: 0, number: 11, value: 2 }]), /CC value/);
});

test("permits the full four-note phrase at the maximum five-second tone setting", () => {
  const duration = 5 * 0.65;
  const events = [60, 64, 67, 72].flatMap((note, index) => {
    const time = 0.08 + index * (duration + 0.08);
    return [
      { type: "noteOn", note, time, velocity: 1 },
      { type: "noteOff", note, time: time + duration, velocity: 0 },
    ];
  });
  assert.deepEqual(validateEvents(events), events);
});
