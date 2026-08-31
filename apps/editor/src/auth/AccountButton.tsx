import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Loader2, UserRound } from "lucide-react";
import { Tooltip } from "@viritura/ui";
import { useGitHubAccount, type GitHubAccountState } from "../github/useGitHubAccount";
import { SignInDialog } from "./SignInDialog";
import { useVirituraAccount, type VirituraAccountState } from "./useVirituraAccount";
import { AvatarBubble } from "./AccountDetails";
import { AccountMenu } from "./AccountMenu";
import { getInitials, pickAvatarUrl } from "./accountIdentity";
import { hasPendingTwoFactorChallenge } from "./api";
import styles from "./AccountButton.module.css";

interface AccountButtonProps {
  readonly account?: VirituraAccountState;
  readonly githubAccount?: GitHubAccountState;
  readonly onOpenSettings: () => void;
}

/**
 * Single activity-bar persona for the signed-in user. Replaces the prior
 * split between `VirituraAccountButton` (account identity) and
 * `GitHubAccountButton` (provider plumbing). Signed-in users get a compact
 * identity menu; full account management lives in Settings → Account.
 */
export function AccountButton({
  account: providedAccount,
  githubAccount: providedGitHub,
  onOpenSettings,
}: AccountButtonProps) {
  const ownAccount = useVirituraAccount();
  const account = providedAccount ?? ownAccount;
  const ownGitHub = useGitHubAccount();
  const github = providedGitHub ?? ownGitHub;

  const [dialogOpen, setDialogOpen] = useState(hasPendingTwoFactorChallenge);
  // Controlled so the trigger's tooltip can be suppressed while the account
  // popover is open — an uncontrolled Root gives us no way to know.
  const [popoverOpen, setPopoverOpen] = useState(false);

  const user = account.user;
  const signedIn = user !== null;
  const loading = account.status === "loading";

  if (!signedIn) {
    return (
      <>
        {/* Opens to the right: the activity bar is a vertical strip, so a
         *  bottom-opening tooltip would cover the next button down. */}
        <Tooltip content="Sign in to Viritura" side="right" open={dialogOpen ? false : undefined}>
          {/* eslint-disable-next-line no-restricted-syntax -- activity-bar avatar trigger; bespoke circular chrome with status-based hover treatment, no @viritura/ui primitive models it. */}
          <button
            type="button"
            className={styles.trigger}
            data-state-kind={account.status}
            aria-label="Sign in to Viritura"
            onClick={() => setDialogOpen(true)}
          >
            {loading ? (
              <Loader2 size={18} className={styles.spin} aria-hidden="true" />
            ) : (
              <UserRound size={18} aria-hidden="true" />
            )}
          </button>
        </Tooltip>
        <SignInDialog open={dialogOpen} account={account} onClose={() => setDialogOpen(false)} />
      </>
    );
  }

  const displayLabel = user.displayName?.trim() || user.email;
  const avatarUrl = pickAvatarUrl(user, github);
  const initials = getInitials(user);

  return (
    <Popover.Root open={popoverOpen} onOpenChange={setPopoverOpen}>
      {/* Suppressed while the popover is open, or it would sit over the panel. */}
      <Tooltip content={`Signed in as ${displayLabel}`} side="right" open={popoverOpen ? false : undefined}>
        <Popover.Trigger asChild>
          {/* eslint-disable-next-line no-restricted-syntax -- activity-bar avatar trigger; bespoke circular chrome with status-based hover treatment, no @viritura/ui primitive models it. */}
          <button
            type="button"
            className={styles.trigger}
            data-state-kind={account.status}
            aria-label={`Signed in as ${displayLabel}`}
          >
            <AvatarBubble avatarUrl={avatarUrl} initials={initials} size={22} />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content className={styles.popover} side="right" align="end" sideOffset={8}>
          <AccountMenu
            account={account}
            github={github}
            user={user}
            onOpenSettings={() => {
              setPopoverOpen(false);
              onOpenSettings();
            }}
          />
          <Popover.Arrow className={styles.arrow} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
