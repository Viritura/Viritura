import type { TransposeDirection, TransposeMode } from "../../commands/transposeCommands";
import { CHROMATIC_INTERVALS, DIATONIC_INTERVALS } from "../../commands/transposeCommands";

export interface TransposeIntervalOption {
  readonly value: string;
  readonly label: string;
}

function signedAmount(amount: number, direction: TransposeDirection): string {
  const value = direction === "up" ? amount : -amount;
  return value > 0 ? `+${value}` : `${value}`;
}

export function buildTransposeIntervalOptions(
  mode: TransposeMode,
  direction: TransposeDirection,
): TransposeIntervalOption[] {
  const intervals = mode === "chromatic" ? CHROMATIC_INTERVALS : DIATONIC_INTERVALS;
  return Object.entries(intervals).map(([name, amount]) => {
    const signed = signedAmount(amount, direction);
    const unit = amount === 1 ? "staff step" : "staff steps";
    return {
      value: name,
      label: mode === "chromatic" ? `${name} (${signed})` : `${name} (${signed} ${unit})`,
    };
  });
}
