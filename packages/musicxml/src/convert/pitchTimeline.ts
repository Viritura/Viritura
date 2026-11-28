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

function directionShifts(
  element: Element,
  measure: number,
  cursor: Fraction,
  divisions: number,
  report: OttavaIssueReporter,
): ShiftChange[] {
  const result: ShiftChange[] = [];
  const position = cursor.add(durationFraction(Number(childText(element, "offset") ?? "0"), divisions));
  for (const type of findChildren(element, "direction-type")) {
    const shift = findChild(type, "octave-shift");
    if (!shift || shift.getAttribute("type") === "continue") continue;
    const size = Number(shift.getAttribute("size") ?? "8");
    const shiftType = shift.getAttribute("type");
    if (!["up", "down", "stop"].includes(shiftType ?? "") || ![8, 15, 22].includes(size)) {
      report(measure, "Invalid MusicXML octave-shift was ignored.");
      continue;
    }
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
function sourceTimeline(part: Element, report: OttavaIssueReporter = () => {}) {
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
        shifts.push(...directionShifts(element, mi, cursor, divisions, report));
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

export type OttavaIssueReporter = (measure: number, message: string) => void;

/**
 * Pairs MusicXML octave-shift boundaries into MNX spans. Malformed boundaries
 * are reported and skipped rather than failing the whole import; a span left
 * open at the end of the part ends at its last affected event.
 */
export function sourceOttavaSpans(
  part: Element,
  measureIds: readonly string[],
  report: OttavaIssueReporter = () => {},
): Map<number, MnxOttava[]> {
  const { shifts, notes } = sourceTimeline(part, report);
  const open = new Map<string, ShiftChange>();
  const spans = new Map<number, MnxOttava[]>();
  const close = (start: ShiftChange, stop: Location | undefined): void => {
    // MusicXML stops at a boundary; MNX ends at the last affected event's onset.
    const last = notes.findLast(
      (note) =>
        note.staff === start.staff &&
        (start.voice === undefined || note.voice === start.voice) &&
        before(start, note) &&
        (stop === undefined ||
          (before(note, stop) && !(note.measure === stop.measure && note.position.key() === stop.position.key()))),
    );
    const measure = last && measureIds[last.measure];
    if (!last || !measure || start.value === undefined) {
      report(start.measure, "MusicXML octave-shift covers no notes and was dropped.");
      return;
    }
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
  };
  for (const shift of shifts) {
    const key = `${shift.staff}:${shift.number}`;
    const start = open.get(key);
    if (shift.value !== undefined) {
      if (start) {
        report(
          shift.measure,
          "MusicXML octave-shift starts before its previous span stops; closing the previous span.",
        );
        close(start, shift);
      }
      open.set(key, shift);
      continue;
    }
    if (!start) {
      report(shift.measure, "MusicXML octave-shift stop has no matching start and was ignored.");
      continue;
    }
    close(start, shift);
    open.delete(key);
  }
  for (const start of open.values()) {
    report(start.measure, "MusicXML octave-shift has no matching stop; ending it at its last note.");
    close(start, undefined);
  }
  return spans;
}
