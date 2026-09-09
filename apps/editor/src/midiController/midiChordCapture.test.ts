import { describe, expect, it } from "vitest";
import { MidiChordCapture } from "./midiChordCapture";

describe("MidiChordCapture", () => {
  it("returns the chord only after every held note is released", () => {
    const capture = new MidiChordCapture();
    capture.noteOn(67);
    capture.noteOn(60);
    capture.noteOn(64);

    expect(capture.noteOff(60)).toBeNull();
    expect(capture.noteOff(67)).toBeNull();
    expect(capture.noteOff(64)).toEqual([60, 64, 67]);
  });

  it("waits for matching note-off events when a pitch is retriggered", () => {
    const capture = new MidiChordCapture();
    capture.noteOn(60);
    capture.noteOn(60);

    expect(capture.noteOff(60)).toBeNull();
    expect(capture.noteOff(60)).toEqual([60]);
  });

  it("discards an unfinished gesture when reset", () => {
    const capture = new MidiChordCapture();
    capture.noteOn(60);
    capture.reset();

    expect(capture.noteOff(60)).toBeNull();
  });
});
