import type { CSSProperties } from "react";
import { AuthApiError } from "./api";

/**
 * Shared style + error helpers for the inline forms inside `AccountDetails.tsx` and its
 * row siblings (password / email / delete). Kept as a `.ts` (no components) so each row
 * file can import freely without tripping `react-refresh/only-export-components`.
 */

export const PASSWORD_FORM_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginTop: 4,
};

export const PASSWORD_FORM_ACTIONS_STYLE: CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  marginTop: 2,
};

export function unpackAuthError(err: unknown): {
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
  readonly message: string;
} {
  if (err instanceof AuthApiError) {
    return { fieldErrors: err.fieldErrors ?? {}, message: err.message };
  }
  return { fieldErrors: {}, message: err instanceof Error ? err.message : "Request failed." };
}
