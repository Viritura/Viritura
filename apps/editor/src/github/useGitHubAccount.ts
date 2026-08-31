/**
 * Re-export shim — the real implementation lives in {@link
 * file://../auth/AccountContext} so a single state machine serves all
 * `useGitHubAccount` consumers instead of each one running its own
 * `/github/session` + `/github/app` polling loop. Keeping the original
 * import path means existing callers don't churn.
 */

export { useGitHubAccount } from "../auth/AccountContext";
export type { GitHubAccountState } from "../auth/AccountContext";
