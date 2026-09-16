import type { MidiEvent, ScheduleCallback } from "../types";

interface NoteSpan {
  on: MidiEvent;
  off?: MidiEvent;
  end?: MidiEvent;
}

function channelKey(event: MidiEvent): string {
  return JSON.stringify([event.partIndex, event.playbackLaneId, event.channel]);
}

function noteKey(event: MidiEvent): string {
  return JSON.stringify([channelKey(event), event.midiNote, event.drumKitProgram]);
}

/** Logical note lifetimes include pedal sustain, independently of audible voices. */
function collectNotes(events: readonly MidiEvent[]): NoteSpan[] {
  const notes: NoteSpan[] = [];
  const held = new Map<string, NoteSpan[]>();
  const sustained = new Map<string, NoteSpan[]>();
  const pedal = new Set<string>();
  for (const event of events) {
    const channel = channelKey(event);
    if (event.type === "controlChange" && event.cc === 64) {
      if ((event.value ?? 0) >= 64) {
        pedal.add(channel);
      } else {
        pedal.delete(channel);
        for (const note of sustained.get(channel) ?? []) note.end = event;
        sustained.delete(channel);
      }
    } else if (event.type === "noteOn") {
      const note: NoteSpan = { on: event };
      notes.push(note);
      const key = noteKey(event);
      const voices = held.get(key) ?? [];
      voices.push(note);
      held.set(key, voices);
    } else if (event.type === "noteOff") {
      const note = held.get(noteKey(event))?.shift();
      if (!note) continue;
      note.off = event;
      if (pedal.has(channel)) {
        const voices = sustained.get(channel) ?? [];
        voices.push(note);
        sustained.set(channel, voices);
      } else {
        note.end = event;
      }
    }
  }
  return notes;
}

/** Tracks scheduler delivery separately from logical note lifetimes and visibility. */
export class FilterContinuity {
  private readonly notes: readonly NoteSpan[];
  private readonly scheduled = new Map<MidiEvent, number>();
  private readonly deliveredAttacks = new Map<MidiEvent, number>();

  constructor(events: readonly MidiEvent[]) {
    this.notes = collectNotes(events);
  }

  reset(): void {
    this.scheduled.clear();
    this.deliveredAttacks.clear();
  }

  rescheduleFrom(scoreTime: number, audioTime: number, cancelled: (event: MidiEvent) => boolean): void {
    // Tempo changes rewind the scheduler's future frontier. Those events
    // must be scheduled by the new clock, not recovered from the old window.
    for (const event of this.scheduled.keys()) {
      if (event.time >= scoreTime) this.scheduled.delete(event);
    }
    // Forget an old audio-clock delivery only after its real sampler queue
    // has been cancelled. Otherwise the old attack can still reach the synth.
    for (const [event, time] of this.deliveredAttacks) {
      if (time >= audioTime && cancelled(event)) this.deliveredAttacks.delete(event);
    }
  }

  shouldSchedule(event: MidiEvent): boolean {
    // Recovery can deliver an attack before the scheduler visits it (for
    // example between a tempo change and its next tick).
    return event.type !== "noteOn" || !this.deliveredAttacks.has(event);
  }

  record(event: MidiEvent, audioTime: number, delivered: boolean): void {
    if (event.type !== "noteOn" && event.type !== "noteOff") return;
    this.scheduled.set(event, audioTime);
    if (event.type === "noteOn" && delivered) this.deliveredAttacks.set(event, audioTime);
  }

  silence(partIndex: number, retainsQueuedNotes: (event: MidiEvent) => boolean): void {
    for (const event of this.deliveredAttacks.keys()) {
      if (event.partIndex === partIndex && !retainsQueuedNotes(event)) this.deliveredAttacks.delete(event);
    }
  }

  restore(
    parts: ReadonlySet<number>,
    scoreTime: number,
    audioTime: number,
    retainsQueuedNotes: (event: MidiEvent) => boolean,
    dispatch: ScheduleCallback,
  ): void {
    if (parts.size === 0) return;
    for (const { on, off, end } of this.notes) {
      if (!parts.has(on.partIndex) || (end && end.time <= scoreTime)) continue;
      const scheduledOn = this.scheduled.get(on);
      // Unvisited future attacks remain the scheduler's responsibility.
      if (on.time >= scoreTime && scheduledOn === undefined) continue;
      const deliveredOn = this.deliveredAttacks.get(on);
      if (deliveredOn !== undefined && deliveredOn > audioTime) continue;

      dispatch(on, Math.max(audioTime, scheduledOn ?? audioTime));
      if (!off) continue;
      const scheduledOff = this.scheduled.get(off);
      // A restored voice needs its own release if panic cancelled a queued
      // release, or if the key is already up and only the pedal sustains it.
      if (off.time <= scoreTime || (scheduledOff !== undefined && !retainsQueuedNotes(on))) {
        dispatch(off, Math.max(audioTime, scheduledOff ?? audioTime));
      }
    }
  }
}
