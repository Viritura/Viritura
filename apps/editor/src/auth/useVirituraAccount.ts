/**
 * Re-export shim — the real implementation lives in {@link
 * file://./AccountContext} so a single state machine serves all
 * `useVirituraAccount` consumers instead of each one running its own
 * `/auth/me` polling loop. Keeping the original import path means
 * existing callers don't churn.
 */

export { useVirituraAccount } from "./AccountContext";
export type { VirituraAccountState } from "./AccountContext";
