/**
 * Provisional mid-part instrument and transposition changes
 * (`_x.viritura.instruments` / `initialInstrument` on a part and
 * `_x.viritura.instrumentChanges` on a part measure).
 *
 * A part is one player's continuous line. An instrument is its timbre and
 * identity, keyed by a MusicXML standard sound ID; its transposition is how
 * the written notes are read. A change can switch the instrument, the
 * transposition, or both:
 *
 * - instrument only: the new instrument's default transposition applies;
 * - transposition only (e.g. a horn crook change): the instrument is kept and
 *   the transposition lasts until the next change;
 * - both: the new instrument with a non-default transposition.
 *
 * Notes stay in sounding pitch, so readers that ignore these extensions still
 * get correct pitches from the native part transposition and names.
 */
import type { RhythmicPosition } from "./measure";
import type { Part, Transposition } from "./part";

/** One instrument a part can play. */
export interface InstrumentDefinition {
  /** MusicXML standard sound ID (e.g. "wind.flutes.flute.piccolo"). */
  instrumentId: string;
  /** Full display name while active; falls back to the part name. */
  name?: string;
  /** Short display name while active; falls back to the part short name. */
  shortName?: string;
  /** Default transposition while active; absent means concert pitch. */
  transposition?: Transposition;
  /** General-MIDI program fallback for unresolvable standard sound IDs. */
  midiProgram?: number;
}

/** Display control for the printed change instruction. */
export interface InstrumentChangeInstruction {
  /** Literal text overriding the derived instruction ("To Picc.", "in E♭"). */
  text?: string;
  /** Suppress the printed instruction. */
  hidden?: boolean;
}

/** A change of instrument, transposition, or both from `position` onward. */
export interface InstrumentChange {
  /** Position within the measure; absent means the start of the measure. */
  position?: RhythmicPosition;
  /** Key into the part's `instruments`. */
  instrument?: string;
  /** Transposition from this point; a zero interval returns to concert pitch. */
  transposition?: Transposition;
  instruction?: InstrumentChangeInstruction;
}

/** The instrument state in effect at one point of a part. */
export interface ActiveInstrumentState {
  /** Active key into the part's `instruments`; undefined without an instrument list. */
  instrumentKey?: string;
  instrument?: InstrumentDefinition;
  /** Effective transposition; undefined means concert pitch. */
  transposition?: Transposition;
}

/** A change located in the part, with the state it produces. */
export interface LocatedInstrumentChange {
  measureIndex: number;
  position: [number, number];
  change: InstrumentChange;
  state: ActiveInstrumentState;
}

const MEASURE_START: [number, number] = [0, 1];

function comparePositions(a: readonly [number, number], b: readonly [number, number]): number {
  return a[0] * b[1] - b[0] * a[1];
}

function changePosition(change: InstrumentChange): [number, number] {
  return change.position?.fraction ?? MEASURE_START;
}

/** The instrument state at the start of the part, before any change. */
export function initialInstrumentState(part: Part): ActiveInstrumentState {
  const ext = part._x?.viritura;
  const instrumentKey = ext?.initialInstrument;
  const instrument =
    instrumentKey !== undefined && ext?.instruments && Object.hasOwn(ext.instruments, instrumentKey)
      ? ext.instruments[instrumentKey]
      : undefined;
  const transposition = part.transposition ?? instrument?.transposition;
  return {
    ...(instrumentKey !== undefined ? { instrumentKey } : {}),
    ...(instrument ? { instrument } : {}),
    ...(transposition ? { transposition } : {}),
  };
}

function applyChange(part: Part, state: ActiveInstrumentState, change: InstrumentChange): ActiveInstrumentState {
  if (change.instrument === undefined) {
    return { ...state, ...(change.transposition ? { transposition: change.transposition } : {}) };
  }
  const instruments = part._x?.viritura?.instruments;
  const instrument =
    instruments && Object.hasOwn(instruments, change.instrument) ? instruments[change.instrument] : undefined;
  const transposition = change.transposition ?? instrument?.transposition;
  return {
    instrumentKey: change.instrument,
    ...(instrument ? { instrument } : {}),
    ...(transposition ? { transposition } : {}),
  };
}

/** Every change in the part in musical order, with the state each one produces. */
export function listInstrumentChanges(part: Part): LocatedInstrumentChange[] {
  const located: LocatedInstrumentChange[] = [];
  let state = initialInstrumentState(part);
  part.measures.forEach((measure, measureIndex) => {
    const ordered = [...(measure.instrumentChanges ?? [])].sort((a, b) =>
      comparePositions(changePosition(a), changePosition(b)),
    );
    for (const change of ordered) {
      state = applyChange(part, state, change);
      located.push({ measureIndex, position: changePosition(change), change, state });
    }
  });
  return located;
}

/**
 * The instrument state in effect at `position` of measure `measureIndex`.
 * A change takes effect at its own position.
 */
export function resolveActiveInstrument(
  part: Part,
  measureIndex: number,
  position: readonly [number, number] = MEASURE_START,
): ActiveInstrumentState {
  let state = initialInstrumentState(part);
  for (const located of listInstrumentChanges(part)) {
    const before =
      located.measureIndex < measureIndex ||
      (located.measureIndex === measureIndex && comparePositions(located.position, position) <= 0);
    if (!before) break;
    state = located.state;
  }
  return state;
}
