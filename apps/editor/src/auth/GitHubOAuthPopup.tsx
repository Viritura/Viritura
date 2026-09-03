import { useCallback, useEffect } from "react";
import { notifyGitHubOAuthCompletion } from "../github/api";
import { hasPendingTwoFactorChallenge } from "./api";
import { SignInDialog } from "./SignInDialog";
import type { VirituraAccountState } from "./useVirituraAccount";
import styles from "./GitHubOAuthPopup.module.css";

interface GitHubOAuthPopupProps {
  readonly account: VirituraAccountState;
}

export function GitHubOAuthPopup({ account }: GitHubOAuthPopupProps) {
  const requiresTwoFactor = hasPendingTwoFactorChallenge();

  const complete = useCallback((): void => {
    notifyGitHubOAuthCompletion();
    window.close();
  }, []);

  useEffect(() => {
    if (account.status === "ready" && account.user && !requiresTwoFactor) {
      complete();
    }
  }, [account.status, account.user, complete, requiresTwoFactor]);

  const failed = account.status === "error" || (account.status === "ready" && !account.user && !requiresTwoFactor);

  return (
    <main className={styles.root}>
      <section className={styles.status} aria-live="polite">
        <h1>{failed ? "GitHub sign-in was not completed" : "Completing GitHub sign-in"}</h1>
        <p>
          {failed
            ? (account.error ?? "Close this window and try signing in again.")
            : "This window will close automatically when your account is ready."}
        </p>
      </section>
      {requiresTwoFactor ? (
        <SignInDialog open account={account} onSignedIn={complete} onClose={() => window.close()} />
      ) : null}
    </main>
  );
}
