import type { TimeSignature } from "@viritura/core";

export const TIME_SIGNATURE_UNITS = [1, 2, 4, 8, 16, 32, 64, 128] as const;

const TIME_SIGNATURE_RE = /^(\d{1,3})\s*\/\s*(\d{1,3})$/;

export function parseTimeSignatureInput(input: string): TimeSignature | null {
  const match = TIME_SIGNATURE_RE.exec(input.trim());
  if (!match) return null;

  const count = Number(match[1]);
  const unit = Number(match[2]);
  if (count < 1 || count > 999 || !TIME_SIGNATURE_UNITS.some((allowed) => allowed === unit)) return null;

  return { count, unit };
}
