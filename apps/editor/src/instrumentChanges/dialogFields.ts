import { resolveActiveInstrument, type InstrumentChange, type Part } from "@viritura/core";
import { barStartChange } from "./barChanges";
import { getCatalogInstrument } from "../score/InstrumentCatalog";
import { hasCustomTuning } from "../components/parts/roster/transposition";

function opensCustomTuning(part: Part, instrumentId: string, change: InstrumentChange | undefined): boolean {
  return !!change?.transposition || hasCustomTuning(part, getCatalogInstrument(instrumentId));
}

export function initialBarChangeFields(part: Part, measureIndex: number) {
  const state = resolveActiveInstrument(part, measureIndex);
  const change = barStartChange(part, measureIndex);
  const instrumentId = state.instrument?.instrumentId ?? part._x?.viritura?.instrumentId ?? "";
  const tuning = state.transposition;
  return {
    change,
    instrumentId,
    customTuning: opensCustomTuning({ ...part, transposition: tuning }, instrumentId, change),
    halfSteps: tuning?.interval.halfSteps ?? 0,
    staffDistance: tuning?.interval.staffDistance ?? 0,
    flipAt: tuning?.keyFifthsFlipAt ?? ("" as const),
    prefersWritten: tuning?.prefersWrittenPitches ?? false,
    text: change?.instruction?.text ?? "",
    hidden: change?.instruction?.hidden,
    reminderText: change?.reminder?.text ?? "",
    reminderHidden: change?.reminder?.hidden,
  };
}

export function changeReminder(text: string, hidden: boolean | undefined): InstrumentChange["reminder"] {
  return { ...(text.trim() ? { text: text.trim() } : {}), ...(hidden !== undefined ? { hidden } : {}) };
}

export function numberFieldValue(value: string): number | "" {
  return value === "" ? "" : Number(value);
}

export function changeInstruction(text: string, hidden: boolean | undefined): InstrumentChange["instruction"] {
  return text.trim() || hidden !== undefined
    ? { ...(text.trim() ? { text: text.trim() } : {}), ...(hidden !== undefined ? { hidden } : {}) }
    : undefined;
}
