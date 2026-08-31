import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { FormField, FormInput } from "@viritura/ui";
import type { GitHubAccountState } from "../github/useGitHubAccount";
import { getRecentAuthStatus, unlinkVirituraExternalLogin, type VirituraUser } from "./api";
import type { VirituraAccountState } from "./useVirituraAccount";
import { unpackAuthError } from "./accountFormShared";
import { RecentAuthPanel } from "./RecentAuthPanel";
import styles from "./AccountButton.module.css";

/**
 * Destructive provider-action disclosure for GitHub. Unlink is hidden behind an
 * "Advanced" toggle so it can't be mistaken for sign-out, then requires a
 * second explicit confirmation tap inside the same disclosure. The two-step
 * pattern is intentional — a modal Dialog would have to fight popover z-index
 * stacking (the StartCenter persona popover spawns from inside another
 * Dialog), and inline confirmation keeps the gesture local to the trigger.
 *
 * When the account has a password set, a re-auth gate is shown in the confirm
 * step. OAuth-only accounts skip the gate (cookie + antiforgery + the existing
 * orphan check on the server are the gate).
 */
export function GitHubAdvancedUnlink({
  github,
  viewerLogin,
  user,
}: {
  readonly github: GitHubAccountState;
  readonly viewerLogin: string | null;
  readonly user: VirituraUser;
}) {
  const hasPassword = user.hasPassword;
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [recentVerified, setRecentVerified] = useState(hasPassword);

  const handleUnlink = () => {
    setUnlinking(true);
    setPasswordError(null);
    void github
      .unlink(hasPassword ? { currentPassword } : undefined)
      .then(() => {
        toast.success("Unlinked GitHub");
        setConfirming(false);
        setOpen(false);
        setCurrentPassword("");
      })
      .catch((err: unknown) => {
        const { fieldErrors, message } = unpackAuthError(err);
        const fieldMessage = fieldErrors.currentPassword?.[0];
        if (fieldMessage) {
          setPasswordError(fieldMessage);
        } else {
          toast.error(message || "Unlink failed");
        }
      })
      .finally(() => setUnlinking(false));
  };

  return (
    <>
      {/* eslint-disable-next-line no-restricted-syntax -- muted disclosure toggle (text-link affordance); not a Button candidate. */}
      <button
        type="button"
        className={styles.advancedToggle}
        data-open={open ? "true" : "false"}
        aria-expanded={open}
        onClick={() => {
          setOpen((prev) => !prev);
          setConfirming(false);
        }}
      >
        <span>Advanced</span>
        <ChevronDown size={11} aria-hidden="true" className={styles.advancedChevron} />
      </button>
      {open && (
        <div className={styles.advancedPanel}>
          {confirming ? (
            !recentVerified ? (
              <RecentAuthPanel
                user={user}
                action="UnlinkLogin"
                onCancel={() => setConfirming(false)}
                onVerified={() => setRecentVerified(true)}
              />
            ) : (
              <div className={styles.confirmRow}>
                <span className={styles.confirmPrompt}>
                  Unlink
                  {viewerLogin ? (
                    <>
                      {" "}
                      <strong>@{viewerLogin}</strong>
                    </>
                  ) : (
                    " GitHub"
                  )}
                  ? Local files are unaffected; you’ll stay signed in.
                </span>
                {hasPassword && (
                  <UnlinkPasswordField
                    value={currentPassword}
                    onChange={setCurrentPassword}
                    error={passwordError}
                    disabled={unlinking}
                  />
                )}
                <div className={styles.confirmActions}>
                  {/* eslint-disable-next-line no-restricted-syntax -- inline cancel for two-step confirm; @viritura/ui Button chrome doesn't fit the inline disclosure. */}
                  <button
                    type="button"
                    className={styles.linkAction}
                    disabled={unlinking}
                    onClick={() => setConfirming(false)}
                  >
                    <span>Cancel</span>
                  </button>
                  {/* eslint-disable-next-line no-restricted-syntax -- destructive inline confirm; @viritura/ui Button chrome doesn't fit the inline disclosure. */}
                  <button type="button" className={styles.linkActionDanger} disabled={unlinking} onClick={handleUnlink}>
                    <span>{unlinking ? "Unlinking…" : "Yes, unlink"}</span>
                  </button>
                </div>
              </div>
            )
          ) : (
            /* eslint-disable-next-line no-restricted-syntax -- destructive text-link action inside provider-row disclosure; @viritura/ui Button chrome doesn't fit the inline disclosure. */
            <button
              type="button"
              className={styles.linkActionDanger}
              onClick={() => {
                setConfirming(true);
                if (!hasPassword) void getRecentAuthStatus("UnlinkLogin").then(setRecentVerified);
              }}
            >
              <span>Unlink GitHub from this account</span>
            </button>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Mirrors {@link GitHubAdvancedUnlink} for the Google provider. Routes through the generic
 * `/account/unlink` endpoint (GitHub uses its own `/github/auth/unlink` for installation
 * cleanup; Google has nothing extra to unwind beyond the Identity row).
 */
export function GoogleAdvancedUnlink({
  account,
  providerKey,
  displayName,
  user,
}: {
  readonly account: VirituraAccountState;
  readonly providerKey: string;
  readonly displayName: string | null;
  readonly user: VirituraUser;
}) {
  const hasPassword = user.hasPassword;
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [recentVerified, setRecentVerified] = useState(hasPassword);

  const handleUnlink = () => {
    setUnlinking(true);
    setPasswordError(null);
    unlinkVirituraExternalLogin({
      provider: "Google",
      providerKey,
      ...(hasPassword ? { currentPassword } : {}),
    })
      .then(() => {
        toast.success("Unlinked Google");
        setConfirming(false);
        setOpen(false);
        setCurrentPassword("");
        void account.refresh();
      })
      .catch((err: unknown) => {
        const { fieldErrors, message } = unpackAuthError(err);
        const fieldMessage = fieldErrors.currentPassword?.[0];
        if (fieldMessage) {
          setPasswordError(fieldMessage);
        } else {
          toast.error(message || "Unlink failed");
        }
      })
      .finally(() => setUnlinking(false));
  };

  return (
    <>
      {/* eslint-disable-next-line no-restricted-syntax -- muted disclosure toggle; matches GitHubAdvancedUnlink. */}
      <button
        type="button"
        className={styles.advancedToggle}
        data-open={open ? "true" : "false"}
        aria-expanded={open}
        onClick={() => {
          setOpen((prev) => !prev);
          setConfirming(false);
        }}
      >
        <span>Advanced</span>
        <ChevronDown size={11} aria-hidden="true" className={styles.advancedChevron} />
      </button>
      {open && (
        <div className={styles.advancedPanel}>
          {confirming ? (
            !recentVerified ? (
              <RecentAuthPanel
                user={user}
                action="UnlinkLogin"
                onCancel={() => setConfirming(false)}
                onVerified={() => setRecentVerified(true)}
              />
            ) : (
              <div className={styles.confirmRow}>
                <span className={styles.confirmPrompt}>
                  Unlink
                  {displayName ? (
                    <>
                      {" "}
                      <strong>{displayName}</strong>
                    </>
                  ) : (
                    " Google"
                  )}
                  ? You’ll stay signed in; you can re-link anytime.
                </span>
                {hasPassword && (
                  <UnlinkPasswordField
                    value={currentPassword}
                    onChange={setCurrentPassword}
                    error={passwordError}
                    disabled={unlinking}
                  />
                )}
                <div className={styles.confirmActions}>
                  {/* eslint-disable-next-line no-restricted-syntax -- inline cancel matches GitHubAdvancedUnlink. */}
                  <button
                    type="button"
                    className={styles.linkAction}
                    disabled={unlinking}
                    onClick={() => setConfirming(false)}
                  >
                    <span>Cancel</span>
                  </button>
                  {/* eslint-disable-next-line no-restricted-syntax -- destructive confirm matches GitHubAdvancedUnlink. */}
                  <button type="button" className={styles.linkActionDanger} disabled={unlinking} onClick={handleUnlink}>
                    <span>{unlinking ? "Unlinking…" : "Yes, unlink"}</span>
                  </button>
                </div>
              </div>
            )
          ) : (
            /* eslint-disable-next-line no-restricted-syntax -- destructive text-link inside disclosure. */
            <button
              type="button"
              className={styles.linkActionDanger}
              onClick={() => {
                setConfirming(true);
                if (!hasPassword) void getRecentAuthStatus("UnlinkLogin").then(setRecentVerified);
              }}
            >
              <span>Unlink Google from this account</span>
            </button>
          )}
        </div>
      )}
    </>
  );
}

function UnlinkPasswordField({
  value,
  onChange,
  error,
  disabled,
}: {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly error: string | null;
  readonly disabled: boolean;
}) {
  return (
    <FormField label="Current password" error={error ?? undefined}>
      <FormInput
        type="password"
        autoComplete="current-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required
      />
    </FormField>
  );
}
