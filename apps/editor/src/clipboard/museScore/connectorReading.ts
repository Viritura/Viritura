import { generateId, type Note, type Tie } from "@viritura/core";
import type { CapturedDynamic } from "../ClipboardFragment";
import { MuseScoreConversionError, unsupported } from "./errors";
import { compare, fromTuple, tuple, type Fraction } from "./fractions";
import { midiFromPitch } from "./pitch";
import {
  connectorChildren,
  pairRelativeConnectors,
  readRelativeConnector,
  type ConnectorLocation,
  type RelativeConnector,
} from "./relativeConnectors";
import { children, integerText, text } from "./xml";

export interface NoteConnector extends RelativeConnector {
  note: Note;
}

export interface LocatedDynamic {
  captured: CapturedDynamic;
  location: ConnectorLocation;
}

export function readNoteConnectors(
  element: Element,
  note: Note,
  location: ConnectorLocation,
  grace: boolean,
  path: string,
): NoteConnector[] {
  return children(element, "Spanner").map((spanner) => {
    if (grace) unsupported("ties involving grace notes are not supported", path);
    return { ...readRelativeConnector(spanner, location, "Tie", path), note };
  });
}

function tieSide(body: Element, path: string): Tie["side"] {
  connectorChildren(body, ["ticks_f", "up"], path);
  const side = text(body, "up");
  if (side === undefined || side === "auto") return undefined;
  if (side === "up" || side === "down") return side;
  unsupported(`Tie direction "${side}" is not supported`, path);
}

export function resolveNoteConnectors(endpoints: readonly NoteConnector[], length: Fraction, staffCount: number): void {
  for (const { start, end } of pairRelativeConnectors(endpoints, length, staffCount)) {
    if (midiFromPitch(start.note.pitch) !== midiFromPitch(end.note.pitch)) {
      throw new MuseScoreConversionError("invalid-pitch", "tie endpoints must have the same MIDI pitch", start.path);
    }
    const side = tieSide(start.body!, start.path);
    const crossVoice = start.current.staff !== end.current.staff || start.current.voice !== end.current.voice;
    start.note.ties = [
      {
        target: end.note.id!,
        ...(crossVoice ? { targetType: "crossVoice" as const } : {}),
        ...(side ? { side } : {}),
      },
    ];
  }
}

function hairpinSubtype(body: Element, path: string): number {
  connectorChildren(body, ["subtype", "ticks_f"], path);
  const subtype = integerText(body, "subtype", path, 0);
  if (subtype !== 0 && subtype !== 1) unsupported(`HairPin subtype "${subtype}" is not supported`, path);
  return subtype;
}

export function resolveHairpinConnectors(
  endpoints: readonly RelativeConnector[],
  dynamics: readonly LocatedDynamic[],
  length: Fraction,
  staffCount: number,
): CapturedDynamic[] {
  const absorbed = new Set<CapturedDynamic>();
  const hairpins = pairRelativeConnectors(endpoints, length, staffCount).map(({ start, end }): CapturedDynamic => {
    if (start.current.staff !== end.current.staff || start.current.voice !== end.current.voice) {
      unsupported("cross-staff or cross-voice HairPin endpoints are not supported by MuseScore paste", start.path);
    }
    const subtype = hairpinSubtype(start.body!, start.path);
    const coincident = dynamics.filter(
      ({ location, captured }) =>
        location.staff === start.current.staff &&
        compare(location.time, start.current.time) === 0 &&
        captured.dynamic.type === "immediate",
    );
    if (coincident.length > 1 || coincident.some(({ captured }) => absorbed.has(captured))) {
      throw new MuseScoreConversionError("invalid-structure", "ambiguous coincident HairPin dynamics", start.path);
    }
    const current = coincident[0]?.captured;
    if (current) absorbed.add(current);
    return {
      measureOffset: 0,
      endMeasureOffset: 0,
      staffOffset: start.current.staff,
      offset: tuple(start.current.time),
      endOffset: tuple(end.current.time),
      dynamic: {
        ...(current?.dynamic ?? { id: generateId(), position: { fraction: [0, 1] } }),
        type: "gradual",
        wedgeType: subtype === 0 ? "increasing" : "decreasing",
        end: { measure: "0", position: { fraction: tuple(end.current.time) } },
      },
    };
  });
  return [
    ...dynamics.filter(({ captured }) => !absorbed.has(captured)).map(({ captured }) => captured),
    ...hairpins,
  ].sort((left, right) => compare(fromTuple(left.offset!), fromTuple(right.offset!)));
}
