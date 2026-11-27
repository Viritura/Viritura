import type { ActiveInstrumentState, KitNote, Note, Score, Transposition } from "@viritura/core";
import type { ExportPart, PartPlan } from "./types";
import { compare, divide, rational, type Rational } from "./rhythm";
import { node, type XmlContext, type XmlElement } from "./xml";

interface XmlInstrument {
  id: string;
  name: string;
  sound?: string;
  program?: number;
  unpitched?: number;
}

function instruments(score: Score, selected: ExportPart): XmlInstrument[] {
  const { part, xmlId } = selected;
  if (part.kit) {
    return Object.values(part.kit).map((component, i) => ({
      id: `${xmlId}-I${i + 1}`,
      name: component.name ?? part.name,
      unpitched: component.sound ? score.global.sounds?.[component.sound]?.midiNumber : undefined,
    }));
  }
  const ext = part._x?.viritura;
  return [
    { id: `${xmlId}-I0`, name: part.name, sound: ext?.instrumentId, program: ext?.midiProgram },
    ...Object.values(ext?.instruments ?? {}).map((instrument, i) => ({
      id: `${xmlId}-I${i + 1}`,
      name: instrument.name ?? part.name,
      sound: instrument.instrumentId,
      program: instrument.midiProgram,
    })),
  ];
}

export function partListEntry(context: XmlContext, score: Score, selected: ExportPart): XmlElement {
  const list = instruments(score, selected);
  const midi = list.filter((instrument) => instrument.program !== undefined || instrument.unpitched !== undefined);
  for (const instrument of midi) {
    if (
      [instrument.program, instrument.unpitched].some(
        (value) => value !== undefined && (!Number.isInteger(value) || value < 0 || value > 127),
      )
    ) {
      throw new Error("Instrument MIDI numbers must be in the range 0–127.");
    }
  }
  return node(
    context,
    "score-part",
    [
      node(context, "part-name", selected.part.name),
      selected.part.shortName ? node(context, "part-abbreviation", selected.part.shortName) : undefined,
      ...list.map((instrument) =>
        node(
          context,
          "score-instrument",
          [
            node(context, "instrument-name", instrument.name),
            instrument.sound ? node(context, "instrument-sound", instrument.sound) : undefined,
          ],
          { id: instrument.id },
        ),
      ),
      ...midi.map((instrument) =>
        node(
          context,
          "midi-instrument",
          [
            instrument.unpitched !== undefined ? node(context, "midi-channel", 10) : undefined,
            instrument.program !== undefined ? node(context, "midi-program", instrument.program + 1) : undefined,
            instrument.unpitched !== undefined ? node(context, "midi-unpitched", instrument.unpitched + 1) : undefined,
          ],
          { id: instrument.id },
        ),
      ),
    ],
    { id: selected.xmlId },
  );
}

export function sourcePosition(plan: PartPlan, mi: number, staff: number, position: Rational): Rational {
  const ratio = plan.measures[mi]!.staffMeters.get(staff)?.ratioToGlobal;
  return ratio ? divide(position, rational(ratio.num, ratio.den)) : position;
}

export function instrumentAt(plan: PartPlan, mi: number, position: Rational): ActiveInstrumentState {
  let active = plan.initialInstrument;
  for (const located of plan.instrumentChanges) {
    if (
      located.measureIndex > mi ||
      (located.measureIndex === mi && compare(rational(...located.position), position) > 0)
    )
      break;
    active = located.state;
  }
  return active;
}

export function displayTransposition(state: ActiveInstrumentState, useWritten: boolean): Transposition | undefined {
  const transposition = state.transposition;
  const interval = transposition?.interval;
  const octaveOnly = interval && interval.halfSteps % 12 === 0 && interval.staffDistance % 7 === 0;
  if (useWritten) return transposition ?? { interval: { staffDistance: 0, halfSteps: 0 } };
  return octaveOnly && transposition?.prefersWrittenPitches ? transposition : undefined;
}

export function instrumentNoteId(plan: PartPlan, note: Note | KitNote, state: ActiveInstrumentState): string {
  const { part, xmlId } = plan.selection;
  if ("kitComponent" in note) {
    const i = Object.keys(part.kit ?? {}).indexOf(note.kitComponent);
    if (i < 0) throw new Error(`Unknown percussion component "${note.kitComponent}".`);
    return `${xmlId}-I${i + 1}`;
  }
  const i =
    state.instrumentKey === undefined
      ? -1
      : Object.keys(part._x?.viritura?.instruments ?? {}).indexOf(state.instrumentKey);
  return `${xmlId}-I${i + 1}`;
}
