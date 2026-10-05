import type { InstrumentChangeStyle } from "@viritura/core";

export function parseRootInstrumentChangeStyle(
  rootX: Record<string, unknown> | undefined,
): InstrumentChangeStyle | undefined {
  const viritura = rootX?.["viritura"] as Record<string, unknown> | undefined;
  const raw = viritura?.["instrumentChangeStyle"] as Record<string, unknown> | undefined;
  if (!raw) return undefined;
  return {
    ...(typeof raw["showChangeLabel"] === "boolean" ? { showChangeLabel: raw["showChangeLabel"] } : {}),
    ...(typeof raw["showAdvanceReminder"] === "boolean" ? { showAdvanceReminder: raw["showAdvanceReminder"] } : {}),
  };
}
