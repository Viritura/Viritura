import { parseMnxUnvalidated } from "@viritura/format";
import { generateTimeline } from "@viritura/midi";
import type { TimedEvent, Timeline, TimelineOptions } from "./timeline";
import { stablePartIds } from "./partIds";

/** Collect only IDs actually supplied by the source (the parser mints missing IDs). */
function authoredEventIds(raw: unknown): Set<string> {
  const ids = new Set<string>();
  function visit(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const item = value as Record<string, unknown>;
    if (item["type"] === "event" && typeof item["id"] === "string" && item["id"]) ids.add(item["id"]);
    for (const child of Object.values(item)) visit(child);
  }
  visit(raw);
  return ids;
}

/** Build a layout-independent timeline on the MIDI generator's exact written beat axis. */
export function buildTimeline(mnx: string | object, opts: TimelineOptions = {}): Timeline {
  const raw: unknown = typeof mnx === "string" ? JSON.parse(mnx) : mnx;
  const partIds = stablePartIds(raw);
  const sourceIds = authoredEventIds(raw);
  const midi = generateTimeline(parseMnxUnvalidated(raw), { expandRepeats: opts.repeatExpansion !== "ignore" });
  const tempoMap = midi.tempoMap.map((entry) => ({
    beat: (midi.measureStartBeats[entry.measureIndex] ?? 0) + entry.beatInMeasure,
    timeSeconds: entry.timeSeconds,
    bpm: entry.bpm,
  }));

  const events: TimedEvent[] = [];
  const open = new Map<string, number[]>();
  for (const ev of midi.events) {
    if (ev.partIndex >= partIds.length || (ev.type !== "noteOn" && ev.type !== "noteOff")) continue;
    const key = `${ev.partIndex}:${ev.midiNote}:${ev.channel}:${ev.playbackLaneId ?? ""}`;
    if (ev.type === "noteOn") {
      const beat = ev.scoreBeat ?? midi.model.beatAtTime(ev.time);
      const event: TimedEvent = {
        partId: partIds[ev.partIndex]!,
        beat,
        durationBeats: ev.scoreDurationBeats ?? 0,
        timeSeconds: ev.time,
        midiPitch: ev.midiNote,
        isRest: false,
      };
      if (ev.scoreEventId && sourceIds.has(ev.scoreEventId)) event.eventId = ev.scoreEventId;
      events.push(event);
      const queue = open.get(key) ?? [];
      queue.push(events.length - 1);
      open.set(key, queue);
    } else {
      const index = open.get(key)?.shift();
      if (index !== undefined && events[index]!.durationBeats === 0) {
        events[index]!.durationBeats = midi.model.beatAtTime(ev.time) - events[index]!.beat;
      }
    }
  }
  events.sort((a, b) => a.beat - b.beat);
  return {
    totalBeats: midi.totalBeats,
    totalSeconds: midi.duration,
    partIds,
    events,
    tempoMap,
  };
}
