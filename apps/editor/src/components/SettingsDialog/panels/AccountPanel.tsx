import { AccountDetails, useVirituraAccount } from "../../../auth";
import { useGitHubAccount } from "../../../github/useGitHubAccount";
import styles from "./AccountPanel.module.css";

export function AccountPanel() {
  const account = useVirituraAccount();
  const github = useGitHubAccount();

  if (account.status === "loading") {
    return <p className={styles.status}>Loading account…</p>;
  }
  if (!account.user) {
    return <p className={styles.status}>Sign in from the account button to manage your account.</p>;
  }
  return (
    <div className={styles.panel}>
      <AccountDetails account={account} github={github} user={account.user} />
    </div>
  );
}
