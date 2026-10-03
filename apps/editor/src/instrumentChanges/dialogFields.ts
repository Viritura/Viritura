import { resolveActiveInstrument, type InstrumentChange, type Part } from "@viritura/core";
import { barStartChange } from "./barChanges";

export function initialBarChangeFields(part: Part, measureIndex: number) {
  const state = resolveActiveInstrument(part, measureIndex);
  const change = barStartChange(part, measureIndex);
  return {
    change,
    instrumentId: state.instrument?.instrumentId ?? part._x?.viritura?.instrumentId ?? "",
    halfSteps: state.transposition?.interval.halfSteps ?? 0,
    staffDistance: state.transposition?.interval.staffDistance ?? 0,
    flipAt: state.transposition?.keyFifthsFlipAt ?? ("" as const),
    prefersWritten: state.transposition?.prefersWrittenPitches ?? false,
    text: change?.instruction?.text ?? "",
    hidden: change?.instruction?.hidden ?? false,
  };
}

export function numberFieldValue(value: string): number | "" {
  return value === "" ? "" : Number(value);
}

export function changeInstruction(text: string, hidden: boolean): InstrumentChange["instruction"] {
  return text.trim() || hidden
    ? { ...(text.trim() ? { text: text.trim() } : {}), ...(hidden ? { hidden: true } : {}) }
    : undefined;
}
