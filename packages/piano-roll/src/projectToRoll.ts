/**
 * Score → PianoRollNote[] projection.
 *
 * Strategy: piggy-back on `@viritura/midi`'s `generateTimeline`, which
 * already does the heavy work — repeat / jump expansion, tempo, ties,
 * articulation-driven velocity & duration scaling, grace notes, drums.
 * We pair its time-ordered `noteOn` / `noteOff` events back into
 * sustained rectangles (FIFO per `partIndex × channel × midiNote`) and
 * resolve each note's starting measure via the timeline's
 * `measureStartTimes` array.
 *
 * The locator / `noteIndex` / `notatedDurationQuarters` fields are
 * populated with placeholders for now: the playback timeline currently
 * doesn't surface MNX `eventId` back through its events. When edit
 * gestures land we'll thread that identity through the timeline
 * builder so the canvas can route patches to the right MNX node.
 */

import { generateTimeline, type MidiEvent } from "@viritura/midi";
import type { EventLocator, Score } from "@viritura/core";
import type { PianoRollNote } from "./types";

const PLACEHOLDER_LOCATOR_VOICE = 0;

export function projectToRoll(score: Score | null | undefined): PianoRollNote[] {
  if (!score) return [];

  let timeline: ReturnType<typeof generateTimeline>;
  try {
    timeline = generateTimeline(score);
  } catch {
    // Malformed scores happen during in-progress editing; render empty.
    return [];
  }

  const open = new Map<string, MidiEvent[]>();
  const out: PianoRollNote[] = [];
  let counter = 0;

  for (const ev of timeline.events) {
    if (ev.type === "noteOn") {
      pushOpen(open, ev);
      continue;
    }
    if (ev.type !== "noteOff") continue;

    const on = popOpen(open, ev);
    if (!on) continue;

    const startMeasure = findMeasureAt(timeline.measureStartTimes, on.time);
    const partId = score.parts[on.partIndex]?.id ?? `p${on.partIndex}`;
    const noteId = `roll-${counter++}`;
    const locator: EventLocator = {
      sequencePath: { partId, measureIndex: startMeasure, voice: PLACEHOLDER_LOCATOR_VOICE },
      eventId: noteId,
    };

    out.push({
      locator,
      noteIndex: 0,
      noteId,
      midiNote: on.midiNote,
      velocity: on.velocity,
      partIndex: on.partIndex,
      startSeconds: on.time,
      endSeconds: ev.time,
      startMeasure,
      startBeat: 0,
      notatedDurationQuarters: 0,
      fromTie: false,
      fromRepeat: false,
    });
  }

  return out;
}

function eventKey(ev: MidiEvent): string {
  return `${ev.partIndex}:${ev.channel}:${ev.midiNote}`;
}

function pushOpen(open: Map<string, MidiEvent[]>, ev: MidiEvent): void {
  const key = eventKey(ev);
  const stack = open.get(key);
  if (stack) {
    stack.push(ev);
  } else {
    open.set(key, [ev]);
  }
}

/** FIFO pop — long notes that overlap retriggered notes still pair correctly. */
function popOpen(open: Map<string, MidiEvent[]>, ev: MidiEvent): MidiEvent | undefined {
  const key = eventKey(ev);
  const stack = open.get(key);
  if (!stack || stack.length === 0) return undefined;
  return stack.shift();
}

/** Binary-search the latest measure whose start time is ≤ `t`. */
function findMeasureAt(measureStartTimes: readonly number[], t: number): number {
  if (measureStartTimes.length === 0) return 0;
  let lo = 0;
  let hi = measureStartTimes.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const start = measureStartTimes[mid] ?? 0;
    if (start <= t) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}
