import { childElements, childText, findChild, findChildren } from "../xmlHelpers";
import { Fraction } from "../fraction";
import { durationFraction } from "./durationFraction";
import type { TransposeInterval } from "./pitchDuration";

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
/** Attribute and octave-shift offsets affect score time, not XML voice order. */
export function sourcePitchTimeline(part: Element): Map<Element, TransposeInterval> {
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
  shifts.sort(order);
  return new Map(
    notes.map((location) => {
      let interval: TransposeInterval = { halfSteps: 0, staffDistance: 0, octaveChange: 0 };
      for (const change of changes)
        if (before(change, location) && (change.staff === undefined || change.staff === location.staff))
          interval = change.interval;
      const active = new Map<string, number>();
      for (const shift of shifts) {
        if (
          shift.staff !== location.staff ||
          (shift.voice !== undefined && shift.voice !== location.voice) ||
          !before(shift, location)
        )
          continue;
        if (shift.value === undefined) active.delete(shift.number);
        else active.set(shift.number, shift.value);
      }
      const octaves = [...active.values()].reduce((sum, value) => sum + value, 0);
      return [location.note, { ...interval, octaveChange: interval.octaveChange + octaves }];
    }),
  );
}
