import { LogOut, Settings } from "lucide-react";
import { Button } from "@viritura/ui";
import { toast } from "sonner";
import type { GitHubAccountState } from "../github/useGitHubAccount";
import type { VirituraAccountState } from "./useVirituraAccount";
import type { VirituraUser } from "./api";
import { AvatarBubble } from "./AccountDetails";
import { getInitials, isPlaceholderEmail, pickAvatarUrl } from "./accountIdentity";
import styles from "./AccountButton.module.css";

export function AccountMenu({
  account,
  github,
  user,
  onOpenSettings,
}: {
  account: VirituraAccountState;
  github: GitHubAccountState;
  user: VirituraUser;
  onOpenSettings: () => void;
}) {
  const displayLabel = user.displayName?.trim() || user.email;
  return (
    <>
      <header className={styles.identity}>
        <AvatarBubble avatarUrl={pickAvatarUrl(user, github)} initials={getInitials(user)} size={32} />
        <div className={styles.identityText}>
          <div className={styles.identityName}>{displayLabel}</div>
          {!isPlaceholderEmail(user.email) && <div className={styles.identityEmail}>{user.email}</div>}
        </div>
      </header>
      <div className={styles.compactActions}>
        <Button variant="utility-row" size="sm" fullWidth onClick={onOpenSettings}>
          <Settings size={15} />
          Account settings…
        </Button>
        <Button
          variant="utility-row"
          size="sm"
          fullWidth
          onClick={() => {
            void account
              .signOut()
              .then(() => toast.success("Signed out"))
              .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Sign-out failed"));
          }}
        >
          <LogOut size={15} />
          Sign out
        </Button>
      </div>
    </>
  );
}
