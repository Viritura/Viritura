import type { DenigmaGapAnchor, DenigmaGapPosition } from "../types";
import { isRecord, type JsonRecord } from "./types";

interface PositionedEvent {
  event: JsonRecord;
  start: number;
  end: number;
  staff?: number;
  grace: boolean;
}

export interface MeasureTarget {
  measureIndex: number;
  globalMeasure: JsonRecord;
  partIndex?: number;
  partMeasure?: JsonRecord;
}

export interface EventTarget {
  event: JsonRecord;
  edge: "start" | "end";
}

const BASE_DURATION: Readonly<Record<string, number>> = {
  maxima: 8,
  longa: 4,
  breve: 2,
  whole: 1,
  half: 1 / 2,
  quarter: 1 / 4,
  eighth: 1 / 8,
  "16th": 1 / 16,
  "32nd": 1 / 32,
  "64th": 1 / 64,
  "128th": 1 / 128,
  "256th": 1 / 256,
  "512th": 1 / 512,
  "1024th": 1 / 1024,
  "2048th": 1 / 2048,
  "4096th": 1 / 4096,
};

function durationValue(value: unknown): number {
  if (Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number" && value[1] !== 0) {
    return value[0] / value[1];
  }
  if (!isRecord(value) || typeof value["base"] !== "string") return 0;
  let duration = BASE_DURATION[value["base"]] ?? 0;
  const dots = typeof value["dots"] === "number" ? Math.max(0, Math.floor(value["dots"])) : 0;
  let increment = duration / 2;
  for (let index = 0; index < dots; index++) {
    duration += increment;
    increment /= 2;
  }
  return duration;
}

function collectPositionedEvents(content: unknown, scale = 1, start = 0, grace = false): PositionedEvent[] {
  if (!Array.isArray(content)) return [];
  const events: PositionedEvent[] = [];
  let cursor = start;
  for (const item of content) {
    if (!isRecord(item)) continue;
    if (item["type"] === "space") {
      cursor += durationValue(item["duration"]) * scale;
      continue;
    }
    if (
      isRecord(item["duration"]) &&
      (Array.isArray(item["notes"]) || Array.isArray(item["kitNotes"]) || "rest" in item)
    ) {
      const duration = durationValue(item["duration"]) * scale;
      events.push({ event: item, start: cursor, end: cursor + duration, grace });
      if (!grace) cursor += duration;
      continue;
    }
    const nested = item["content"];
    if (!Array.isArray(nested)) continue;
    let nestedScale = scale;
    if (isRecord(item["inner"]) && isRecord(item["outer"])) {
      const innerDuration = durationValue(item["inner"]["duration"]);
      const outerDuration = durationValue(item["outer"]["duration"]);
      const innerMultiple = typeof item["inner"]["multiple"] === "number" ? item["inner"]["multiple"] : 1;
      const outerMultiple = typeof item["outer"]["multiple"] === "number" ? item["outer"]["multiple"] : 1;
      if (innerDuration > 0 && innerMultiple > 0) {
        nestedScale *= (outerDuration * outerMultiple) / (innerDuration * innerMultiple);
      }
    }
    const isGraceContainer = item["type"] === "grace";
    const nestedEvents = collectPositionedEvents(nested, nestedScale, cursor, grace || isGraceContainer);
    events.push(...nestedEvents);
    if (!isGraceContainer && !grace) cursor = nestedEvents.at(-1)?.end ?? cursor;
  }
  return events;
}

function positionValue(position: DenigmaGapPosition | undefined): number {
  return position ? position.numerator / position.denominator : 0;
}

function idOf(value: JsonRecord): string | undefined {
  return typeof value["id"] === "string" ? value["id"] : undefined;
}

function isEvent(value: JsonRecord): boolean {
  return (
    isRecord(value["duration"]) &&
    (Array.isArray(value["notes"]) || Array.isArray(value["kitNotes"]) || "rest" in value)
  );
}

export class TargetIndex {
  private readonly ids = new Map<string, JsonRecord>();
  private readonly notesToEvents = new Map<string, JsonRecord>();
  private readonly measures = new Map<string, MeasureTarget>();
  private readonly positionedEvents = new Map<string, PositionedEvent[]>();

  constructor(private readonly document: JsonRecord) {
    const global = isRecord(document["global"]) ? document["global"] : undefined;
    const globalMeasures = Array.isArray(global?.["measures"]) ? global["measures"] : [];
    const parts = Array.isArray(document["parts"]) ? document["parts"] : [];

    globalMeasures.forEach((value, measureIndex) => {
      if (!isRecord(value)) return;
      const anchor = `m${measureIndex + 1}`;
      const target = { measureIndex, globalMeasure: value };
      this.measures.set(anchor, target);
      this.register(value);
      const tempos = Array.isArray(value["tempos"]) ? value["tempos"] : [];
      tempos.forEach((tempo) => {
        if (isRecord(tempo)) this.register(tempo);
      });
    });

    parts.forEach((partValue, partIndex) => {
      if (!isRecord(partValue) || !Array.isArray(partValue["measures"])) return;
      partValue["measures"].forEach((measureValue, measureIndex) => {
        if (!isRecord(measureValue)) return;
        const globalMeasure = globalMeasures[measureIndex];
        if (!isRecord(globalMeasure)) return;
        const anchor = `P${partIndex + 1}.m${measureIndex + 1}`;
        const target = { partIndex, measureIndex, partMeasure: measureValue, globalMeasure };
        this.measures.set(anchor, target);
        this.register(measureValue);

        const sequences = Array.isArray(measureValue["sequences"]) ? measureValue["sequences"] : [];
        const allEvents: PositionedEvent[] = [];
        sequences.forEach((sequence) => {
          if (!isRecord(sequence)) return;
          const events = collectPositionedEvents(sequence["content"]);
          const staff =
            typeof sequence["staff"] === "number" && Number.isInteger(sequence["staff"])
              ? sequence["staff"]
              : undefined;
          if (staff !== undefined) events.forEach((event) => (event.staff = staff));
          allEvents.push(...events);
          for (const { event } of events) {
            this.register(event);
            const notes = Array.isArray(event["notes"]) ? event["notes"] : [];
            notes.forEach((note) => {
              if (!isRecord(note)) return;
              this.register(note);
              const noteId = idOf(note);
              if (noteId) this.notesToEvents.set(noteId, event);
            });
          }
        });
        this.positionedEvents.set(anchor, allEvents);
      });
    });
  }

  private register(value: JsonRecord): void {
    const id = idOf(value);
    if (id) this.ids.set(id, value);
  }

  byId(id: string): JsonRecord | undefined {
    return this.ids.get(id);
  }

  measure(anchor: string): MeasureTarget | undefined {
    return this.measures.get(anchor);
  }

  event(anchor: DenigmaGapAnchor, preferEnd = false): EventTarget | undefined {
    const direct = this.ids.get(anchor.anchor);
    const parent = this.notesToEvents.get(anchor.anchor);
    if (parent) return { event: parent, edge: preferEnd ? "end" : "start" };
    if (direct && isEvent(direct)) return { event: direct, edge: preferEnd ? "end" : "start" };
    const allEvents = this.positionedEvents.get(anchor.anchor);
    const events =
      anchor.staff === undefined ? allEvents : allEvents?.filter((candidate) => candidate.staff === anchor.staff);
    if (!events || events.length === 0) return undefined;
    const position = positionValue(anchor.position);
    const tolerance = 1e-8;
    const atEnd =
      events.find((candidate) => !candidate.grace && Math.abs(candidate.end - position) < tolerance) ??
      events.find((candidate) => Math.abs(candidate.end - position) < tolerance);
    const atStart =
      events.find((candidate) => !candidate.grace && Math.abs(candidate.start - position) < tolerance) ??
      events.find((candidate) => Math.abs(candidate.start - position) < tolerance);
    if (preferEnd && atEnd) return { event: atEnd.event, edge: "end" };
    if (atStart) return { event: atStart.event, edge: "start" };
    if (atEnd) return { event: atEnd.event, edge: "end" };
    return undefined;
  }
}

export function ensureRecordProperty(owner: JsonRecord, key: string): JsonRecord {
  const existing = owner[key];
  if (isRecord(existing)) return existing;
  if (existing !== undefined) throw new Error(`Expected ${key} to be an object while adapting Denigma gaps.`);
  const created: JsonRecord = {};
  owner[key] = created;
  return created;
}

export function ensureArrayProperty(owner: JsonRecord, key: string): unknown[] {
  const existing = owner[key];
  if (Array.isArray(existing)) return existing;
  if (existing !== undefined) throw new Error(`Expected ${key} to be an array while adapting Denigma gaps.`);
  const created: unknown[] = [];
  owner[key] = created;
  return created;
}

export function ensureViritura(owner: JsonRecord): JsonRecord {
  return ensureRecordProperty(ensureRecordProperty(owner, "_x"), "viritura");
}

export function eventId(event: JsonRecord): string | undefined {
  return idOf(event);
}

export function asDocumentRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}
