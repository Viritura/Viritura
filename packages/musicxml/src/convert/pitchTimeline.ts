import { childElements, childText, findChild, findChildren } from "../xmlHelpers";
import { Fraction } from "../fraction";
import { durationFraction } from "./durationFraction";
import type { TransposeInterval } from "./pitchDuration";
import type { MnxOttava } from "../types";

interface Location {
  measure: number;
  position: Fraction;
}
interface PitchChange extends Location {
  staff?: number;
  interval: TransposeInterval;
}
interface ShiftChange extends Location {
  staff: number;
  voice?: string;
  number: string;
  value?: number;
}
interface NoteLocation extends Location {
  note: Element;
  staff: number;
  voice: string;
}

function before(a: Location, b: Location): boolean {
  return (
    a.measure < b.measure || (a.measure === b.measure && a.position.n * b.position.d <= b.position.n * a.position.d)
  );
}

function directionShifts(element: Element, measure: number, cursor: Fraction, divisions: number): ShiftChange[] {
  const result: ShiftChange[] = [];
  const position = cursor.add(durationFraction(Number(childText(element, "offset") ?? "0"), divisions));
  for (const type of findChildren(element, "direction-type")) {
    const shift = findChild(type, "octave-shift");
    if (!shift || shift.getAttribute("type") === "continue") continue;
    const size = Number(shift.getAttribute("size") ?? "8");
    const shiftType = shift.getAttribute("type");
    if (!["up", "down", "stop"].includes(shiftType ?? "") || ![8, 15, 22].includes(size))
      throw new Error("Invalid MusicXML octave-shift.");
    const value =
      shift.getAttribute("type") === "stop"
        ? undefined
        : ((size - 1) / 7) * (shift.getAttribute("type") === "down" ? 1 : -1);
    result.push({
      measure,
      position,
      staff: Number(childText(element, "staff") ?? "1"),
      voice: childText(element, "voice") ?? undefined,
      number: shift.getAttribute("number") ?? "1",
      value,
    });
  }
  return result;
}
/** Attribute and direction offsets affect score time, not XML voice order. */
function sourceTimeline(part: Element) {
  const changes: PitchChange[] = [];
  const shifts: ShiftChange[] = [];
  const notes: NoteLocation[] = [];
  let divisions = 1;
  findChildren(part, "measure").forEach((measure, mi) => {
    let cursor = Fraction.ZERO;
    let chordPosition = cursor;
    for (const element of childElements(measure)) {
      if (element.tagName === "attributes") {
        const declared = childText(element, "divisions");
        if (declared !== null) divisions = Number(declared);
        if (!Number.isFinite(divisions) || divisions <= 0) throw new Error("Invalid MusicXML divisions.");
        for (const transpose of findChildren(element, "transpose")) {
          const interval = {
            halfSteps: parseInt(childText(transpose, "chromatic") ?? "0", 10),
            staffDistance: parseInt(childText(transpose, "diatonic") ?? "0", 10),
            octaveChange: parseInt(childText(transpose, "octave-change") ?? "0", 10),
          };
          if (!Object.values(interval).every(Number.isSafeInteger)) throw new Error("Invalid MusicXML transposition.");
          changes.push({
            measure: mi,
            position: cursor,
            staff: transpose.hasAttribute("number") ? Number(transpose.getAttribute("number")) : undefined,
            interval,
          });
        }
      } else if (element.tagName === "direction") {
        shifts.push(...directionShifts(element, mi, cursor, divisions));
      } else if (element.tagName === "note") {
        const chord = findChild(element, "chord") !== null;
        if (!chord) chordPosition = cursor;
        notes.push({
          measure: mi,
          position: chord ? chordPosition : cursor,
          note: element,
          staff: Number(childText(element, "staff") ?? "1"),
          voice: childText(element, "voice") ?? "1",
        });
        if (!chord && !findChild(element, "grace"))
          cursor = cursor.add(durationFraction(Number(childText(element, "duration") ?? "0"), divisions));
      } else if (element.tagName === "forward" || element.tagName === "backup") {
        const amount = durationFraction(Number(childText(element, "duration") ?? "0"), divisions);
        cursor = element.tagName === "forward" ? cursor.add(amount) : cursor.subtract(amount);
      }
    }
  });
  const order = (a: Location, b: Location) =>
    a.measure - b.measure || a.position.n * b.position.d - b.position.n * a.position.d;
  changes.sort(order);
  shifts.sort((a, b) => order(a, b) || Number(a.value !== undefined) - Number(b.value !== undefined));
  notes.sort(order);
  return { changes, shifts, notes };
}

export function sourcePitchTimeline(part: Element): Map<Element, TransposeInterval> {
  const { changes, notes } = sourceTimeline(part);
  return new Map(
    notes.map((location) => {
      let interval: TransposeInterval = { halfSteps: 0, staffDistance: 0, octaveChange: 0 };
      for (const change of changes)
        if (before(change, location) && (change.staff === undefined || change.staff === location.staff))
          interval = change.interval;
      // MusicXML pitch already accounts for ottava; only instrument transposition applies.
      return [location.note, interval];
    }),
  );
}

export function sourceOttavaSpans(part: Element, measureIds: readonly string[]): Map<number, MnxOttava[]> {
  const { shifts, notes } = sourceTimeline(part);
  const open = new Map<string, ShiftChange>();
  const spans = new Map<number, MnxOttava[]>();
  for (const shift of shifts) {
    const key = `${shift.staff}:${shift.number}`;
    if (shift.value !== undefined) {
      if (open.has(key)) throw new Error("MusicXML octave-shift starts before its previous span stops.");
      open.set(key, shift);
      continue;
    }
    const start = open.get(key);
    if (!start) throw new Error("MusicXML octave-shift stop has no matching start.");
    // MusicXML stops at a boundary; MNX ends at the last affected event's onset.
    const last = notes.findLast(
      (note) =>
        note.staff === start.staff &&
        (start.voice === undefined || note.voice === start.voice) &&
        before(start, note) &&
        before(note, shift) &&
        !(note.measure === shift.measure && note.position.key() === shift.position.key()),
    );
    if (!last || start.value === undefined) throw new Error("MusicXML octave-shift contains no events.");
    const measure = measureIds[last.measure];
    if (!measure) throw new Error("MusicXML octave-shift references a missing measure.");
    const span: MnxOttava = {
      value: start.value,
      position: { fraction: [start.position.n, start.position.d] },
      end: { measure, position: { fraction: [last.position.n, last.position.d] } },
      staff: start.staff,
      ...(start.voice === undefined ? {} : { voice: `v${start.voice}` }),
    };
    const list = spans.get(start.measure) ?? [];
    list.push(span);
    spans.set(start.measure, list);
    open.delete(key);
  }
  if (open.size) throw new Error("MusicXML octave-shift has no matching stop.");
  return spans;
}
