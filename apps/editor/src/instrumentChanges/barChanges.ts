import {
  resolveActiveInstrument,
  type InstrumentChange,
  type InstrumentDefinition,
  type Part,
  type Score,
  type Transposition,
} from "@viritura/core";
import type { SelectionState } from "../store/selectionStore";
import { resolveSelectionScope } from "../store/selectionUtils";
import {
  buildPartTransposition,
  enrichInstrumentIdentities,
  getCatalogInstrument,
  type CatalogInstrument,
} from "../score/InstrumentCatalog";
import { nextInstrumentKey } from "./initialInstrument";
import { createCatalogPart } from "../score/catalogPart";

export interface BarInstrumentTarget {
  partIndex: number;
  measureIndex: number;
}

export interface BarChangeResult {
  score: Score;
  error?: string;
}

export function resolveBarInstrumentTarget(score: Score | null, selection: SelectionState): BarInstrumentTarget | null {
  if (!score) return null;
  const scope = resolveSelectionScope(selection, score);
  if (!scope || scope.startPart !== scope.endPart || scope.startMeasure !== scope.endMeasure) return null;
  if (!score.parts[scope.startPart]?.measures[scope.startMeasure]) return null;
  return { partIndex: scope.startPart, measureIndex: scope.startMeasure };
}

export function barStartChange(part: Part, measureIndex: number): InstrumentChange | undefined {
  return part.measures[measureIndex]?.instrumentChanges?.find((change) => (change.position?.fraction[0] ?? 0) === 0);
}

export function instrumentChangeCompatibility(part: Part, instrument: CatalogInstrument): string | undefined {
  if ((part.staves ?? 1) !== instrument.staves) {
    return "A mid-piece change must keep the same number of staves. Add a separate part for this instrument.";
  }
  if (part.kit || instrument.kit || instrument.unpitchedDrum !== undefined) {
    return "Percussion-map changes need separate source parts; this command currently supports pitched instruments.";
  }
  return undefined;
}

function setStartChange(part: Part, measureIndex: number, change: InstrumentChange): void {
  const measure = part.measures[measureIndex]!;
  measure.instrumentChanges = [
    change,
    ...(measure.instrumentChanges ?? []).filter((entry) => (entry.position?.fraction[0] ?? 0) !== 0),
  ];
}

function catalogDefinition(instrument: CatalogInstrument): InstrumentDefinition {
  return {
    instrumentId: instrument.id,
    name: instrument.name,
    shortName: instrument.shortName,
    midiProgram: instrument.midiProgram,
    ...(instrument.transposition ? { transposition: buildPartTransposition(instrument.transposition) } : {}),
  };
}

function ensureInstruments(part: Part): string | undefined {
  if (part._x?.viritura?.instruments && part._x.viritura.initialInstrument) return undefined;
  const vendorExtensions = part._x;
  enrichInstrumentIdentities({ parts: [part] });
  part._x = { ...vendorExtensions, ...part._x };
  const ext = part._x?.viritura;
  if (!ext?.instrumentId) return "Choose the part's starting instrument in Setup before adding an instrument change.";
  const initial: InstrumentDefinition = {
    instrumentId: ext.instrumentId,
    name: part.name,
    ...(part.shortName ? { shortName: part.shortName } : {}),
    ...(part.transposition ? { transposition: structuredClone(part.transposition) } : {}),
    ...(ext.midiProgram !== undefined ? { midiProgram: ext.midiProgram } : {}),
  };
  const instruments = { ...ext.instruments };
  const key = nextInstrumentKey(instruments, "initial");
  part._x = {
    ...part._x,
    viritura: { ...ext, instruments: { ...instruments, [key]: initial }, initialInstrument: key },
  };
  return undefined;
}

function updateClefs(part: Part, measureIndex: number, instrument: CatalogInstrument): void {
  const measure = part.measures[measureIndex]!;
  const later = (measure.clefs ?? []).filter((clef) => (clef.position?.fraction[0] ?? 0) !== 0);
  const template = createCatalogPart(instrument, part.id ?? "", { name: instrument.name }, 1, 0).part;
  measure.clefs = [...(template.measures[0]?.clefs ?? []), ...later];
  measure.staffConfigs = [
    ...Array.from({ length: part.staves ?? 1 }, (_, index) => ({
      config: { lines: instrument.staffLines?.[index + 1] ?? 5 },
      ...((part.staves ?? 1) > 1 ? { staff: index + 1 } : {}),
    })),
    ...(measure.staffConfigs ?? []).filter((config) => (config.position?.fraction[0] ?? 0) !== 0),
  ];
}

export function setBarInstrument(
  score: Score,
  target: BarInstrumentTarget,
  instrumentId: string,
  instruction?: InstrumentChange["instruction"],
  reminder?: InstrumentChange["reminder"],
): BarChangeResult {
  const part = score.parts[target.partIndex];
  const instrument = getCatalogInstrument(instrumentId);
  if (!part?.measures[target.measureIndex] || !instrument)
    return { score, error: "The bar or instrument no longer exists." };
  const error = instrumentChangeCompatibility(part, instrument);
  if (error) return { score, error };
  const next = structuredClone(score);
  const nextPart = next.parts[target.partIndex]!;
  const identityError = ensureInstruments(nextPart);
  if (identityError) return { score, error: identityError };
  const instruments = nextPart._x!.viritura!.instruments!;
  const definition = catalogDefinition(instrument);
  const existingKey = Object.entries(instruments).find(
    ([, value]) => JSON.stringify(value) === JSON.stringify(definition),
  )?.[0];
  const key = existingKey ?? nextInstrumentKey(instruments, instrumentId);
  instruments[key] = definition;
  const previousReminder = reminder ?? barStartChange(nextPart, target.measureIndex)?.reminder;
  setStartChange(nextPart, target.measureIndex, {
    instrument: key,
    ...(instruction ? { instruction } : {}),
    ...(previousReminder ? { reminder: previousReminder } : {}),
  });
  updateClefs(nextPart, target.measureIndex, instrument);
  return { score: next };
}

export function setBarTransposition(
  score: Score,
  target: BarInstrumentTarget,
  transposition: Transposition,
  instruction?: InstrumentChange["instruction"],
  reminder?: InstrumentChange["reminder"],
): BarChangeResult {
  const part = score.parts[target.partIndex];
  if (!part?.measures[target.measureIndex]) return { score, error: "The selected bar no longer exists." };
  if (part.kit) return { score, error: "Percussion-map instruments do not have a pitched transposition." };
  const values = [
    transposition.interval.halfSteps,
    transposition.interval.staffDistance,
    transposition.keyFifthsFlipAt ?? 0,
  ];
  if (!values.every(Number.isSafeInteger)) return { score, error: "Transposition values must be whole numbers." };
  const next = structuredClone(score);
  const nextPart = next.parts[target.partIndex]!;
  const previous = barStartChange(nextPart, target.measureIndex);
  setStartChange(nextPart, target.measureIndex, {
    ...(previous?.instrument ? { instrument: previous.instrument } : {}),
    transposition: structuredClone(transposition),
    ...(instruction ? { instruction } : {}),
    ...((reminder ?? previous?.reminder) ? { reminder: reminder ?? previous?.reminder } : {}),
  });
  return { score: next };
}

export function removeBarInstrumentChange(score: Score, target: BarInstrumentTarget): BarChangeResult {
  const part = score.parts[target.partIndex];
  if (!part?.measures[target.measureIndex]) return { score, error: "The selected bar no longer exists." };
  const previous = barStartChange(part, target.measureIndex);
  if (!previous) return { score, error: "There is no change at the start of this bar." };
  const next = structuredClone(score);
  const nextPart = next.parts[target.partIndex]!;
  const measure = nextPart.measures[target.measureIndex]!;
  measure.instrumentChanges = measure.instrumentChanges?.filter((entry) => (entry.position?.fraction[0] ?? 0) !== 0);
  if (!measure.instrumentChanges?.length) delete measure.instrumentChanges;
  if (previous.instrument) {
    const state = resolveActiveInstrument(nextPart, target.measureIndex);
    const id = state.instrument?.instrumentId ?? nextPart._x?.viritura?.instrumentId;
    const instrument = id ? getCatalogInstrument(id) : undefined;
    if (!instrument)
      return { score, error: "Cannot restore the previous instrument's clefs; its catalog entry is unavailable." };
    updateClefs(nextPart, target.measureIndex, instrument);
  }
  return { score: next };
}
