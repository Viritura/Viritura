import { resolveActiveInstrument, type InstrumentChange, type Part, type Transposition } from "@viritura/core";
import { barStartChange } from "./barChanges";
import { buildPartTransposition, getCatalogInstrument } from "../score/InstrumentCatalog";

function initialTuning(
  instrumentId: string,
  active: Transposition | undefined,
  change: InstrumentChange | undefined,
  mode: "instrument" | "transposition",
) {
  if (mode === "transposition" || change?.transposition) return active;
  const instrument = getCatalogInstrument(instrumentId);
  if (!instrument) return active;
  return instrument.transposition && buildPartTransposition(instrument.transposition);
}

export function initialBarChangeFields(part: Part, measureIndex: number, mode: "instrument" | "transposition") {
  const state = resolveActiveInstrument(part, measureIndex);
  const change = barStartChange(part, measureIndex);
  const instrumentId = state.instrument?.instrumentId ?? part._x?.viritura?.instrumentId ?? "";
  const tuning = initialTuning(instrumentId, state.transposition, change, mode);
  return {
    change,
    instrumentId,
    halfSteps: tuning?.interval.halfSteps ?? 0,
    staffDistance: tuning?.interval.staffDistance ?? 0,
    flipAt: tuning?.keyFifthsFlipAt ?? ("" as const),
    prefersWritten: tuning?.prefersWrittenPitches ?? false,
    text: change?.instruction?.text ?? "",
    hidden: change?.instruction?.hidden ?? false,
    reminderText: change?.reminder?.text ?? "",
    reminderEnabled: change?.reminder?.hidden !== true,
  };
}

export function changeReminder(text: string, enabled: boolean): InstrumentChange["reminder"] {
  if (enabled) return text.trim() ? { text: text.trim() } : {};
  return { ...(text.trim() ? { text: text.trim() } : {}), hidden: true };
}

export function numberFieldValue(value: string): number | "" {
  return value === "" ? "" : Number(value);
}

export function changeInstruction(text: string, hidden: boolean): InstrumentChange["instruction"] {
  return text.trim() || hidden
    ? { ...(text.trim() ? { text: text.trim() } : {}), ...(hidden ? { hidden: true } : {}) }
    : undefined;
}
