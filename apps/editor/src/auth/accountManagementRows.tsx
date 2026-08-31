import { useState, type FormEvent } from "react";
import { ChevronDown, Mail, Trash2, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { FormField, FormInput } from "@viritura/ui";
import { deleteVirituraAccount, getRecentAuthStatus, requestVirituraEmailChange, updateVirituraProfile } from "./api";
import type { VirituraUser } from "./api";
import type { VirituraAccountState } from "./useVirituraAccount";
import { isPlaceholderEmail } from "./accountIdentity";
import { PASSWORD_FORM_STYLE, unpackAuthError } from "./accountFormShared";
import { PasswordFormActions } from "./PasswordFormActions";
import { RecentAuthPanel } from "./RecentAuthPanel";
import styles from "./AccountButton.module.css";

// -- Email change ----------------------------------------------------------------

/**
 * Account-email management row. The current address is the row label; the actual change runs
 * through an inline form behind an "Advanced" disclosure. Mirrors the Password / GitHub rows so
 * the surface stays visually consistent. Submitting the form posts to <c>/account/email</c>,
 * which always returns 204 and emails a confirmation link to the new address — the actual swap
 * happens after the user clicks the link.
 */
export function EmailRow({ user }: { readonly user: VirituraUser }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const requiresPassword = user.hasPassword;
  const [recentVerified, setRecentVerified] = useState(requiresPassword);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});
    requestVirituraEmailChange({
      newEmail,
      currentPassword: requiresPassword ? currentPassword : undefined,
    })
      .then(() => {
        toast.success("Check your email", {
          description: `If ${newEmail} is available, a confirmation link is on its way.`,
        });
        setOpen(false);
        setNewEmail("");
        setCurrentPassword("");
      })
      .catch((err: unknown) => {
        const { fieldErrors, message } = unpackAuthError(err);
        const next: { email?: string; password?: string } = {};
        if (fieldErrors.newEmail?.[0]) next.email = fieldErrors.newEmail[0];
        if (fieldErrors.currentPassword?.[0]) next.password = fieldErrors.currentPassword[0];
        setErrors(next);
        if (!next.email && !next.password) toast.error(message);
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <div className={styles.provider} data-connected="true">
      <div className={styles.providerIcon} aria-hidden="true">
        <Mail size={16} />
      </div>
      <div className={styles.providerBody}>
        <div className={styles.providerName}>
          <span>Email</span>
          <span className={styles.providerStatus} data-state="connected">
            {isPlaceholderEmail(user.email) ? "Not set" : "Set"}
          </span>
        </div>
        {!isPlaceholderEmail(user.email) && <div className={styles.providerMeta}>{user.email}</div>}
        <div className={styles.providerActions}>
          {/* eslint-disable-next-line no-restricted-syntax -- muted disclosure toggle; matches GitHubAdvancedUnlink. */}
          <button
            type="button"
            className={styles.advancedToggle}
            data-open={open ? "true" : "false"}
            aria-expanded={open}
            onClick={() => {
              setOpen((prev) => !prev);
              setErrors({});
              if (!requiresPassword && !open) {
                void getRecentAuthStatus("ChangeEmail").then(setRecentVerified);
              }
            }}
          >
            <span>Change email</span>
            <ChevronDown size={11} aria-hidden="true" className={styles.advancedChevron} />
          </button>
          {open && (
            <div className={styles.advancedPanel}>
              {!recentVerified ? (
                <RecentAuthPanel
                  user={user}
                  action="ChangeEmail"
                  onCancel={() => setOpen(false)}
                  onVerified={() => setRecentVerified(true)}
                />
              ) : (
                <form onSubmit={submit} style={PASSWORD_FORM_STYLE}>
                  <FormField label="New email address" error={errors.email}>
                    <FormInput
                      type="email"
                      autoComplete="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      required
                      disabled={submitting}
                    />
                  </FormField>
                  {requiresPassword && (
                    <FormField label="Confirm current password" error={errors.password}>
                      <FormInput
                        type="password"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        required
                        disabled={submitting}
                      />
                    </FormField>
                  )}
                  <span className={styles.confirmPrompt}>
                    We’ll email a confirmation link to the new address. Your account email won’t change until you click
                    it.
                  </span>
                  <PasswordFormActions
                    onCancel={() => {
                      setOpen(false);
                      setErrors({});
                    }}
                    submitting={submitting}
                    submitLabel="Send confirmation"
                  />
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// -- Delete account --------------------------------------------------------------

/**
 * Permanent-account-deletion row. Two-step confirm to ensure no accidental clicks, then a
 * password gate for accounts with a password (OAuth-only accounts skip the password field —
 * the cookie + antiforgery token are the gate, and the prior confirmation tap is the
 * intent gate). On success the cookie is cleared server-side and we refresh local state to
 * land back at the signed-out view.
 */
export function DeleteAccountRow({
  account,
  user,
}: {
  readonly account: VirituraAccountState;
  readonly user: VirituraUser;
}) {
  const requiresPassword = user.hasPassword;
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [recentVerified, setRecentVerified] = useState(requiresPassword);

  const reset = () => {
    setOpen(false);
    setConfirming(false);
    setCurrentPassword("");
    setError(undefined);
  };

  const handleDelete = () => {
    setSubmitting(true);
    setError(undefined);
    deleteVirituraAccount({ currentPassword: requiresPassword ? currentPassword : undefined })
      .then(() => {
        toast.success("Account deleted");
        reset();
        // The server already cleared the cookie; refresh local state so /auth/me reports
        // unauthenticated and the UI returns to the signed-out surface.
        void account.refresh();
      })
      .catch((err: unknown) => {
        const { fieldErrors, message } = unpackAuthError(err);
        if (fieldErrors.currentPassword?.[0]) {
          setError(fieldErrors.currentPassword[0]);
        } else {
          toast.error(message);
        }
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <div className={styles.provider} data-connected="false">
      <div className={styles.providerIcon} aria-hidden="true">
        <Trash2 size={16} />
      </div>
      <div className={styles.providerBody}>
        <div className={styles.providerName}>
          <span>Delete account</span>
          <span className={styles.providerStatus} data-state="disconnected">
            Danger zone
          </span>
        </div>
        <div className={styles.providerActions}>
          {/* eslint-disable-next-line no-restricted-syntax -- muted disclosure toggle. */}
          <button
            type="button"
            className={styles.advancedToggle}
            data-open={open ? "true" : "false"}
            aria-expanded={open}
            onClick={() => {
              setOpen((prev) => !prev);
              setConfirming(false);
              setError(undefined);
              if (!requiresPassword && !open) {
                void getRecentAuthStatus("DeleteAccount").then(setRecentVerified);
              }
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
                    action="DeleteAccount"
                    onCancel={reset}
                    onVerified={() => setRecentVerified(true)}
                  />
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleDelete();
                    }}
                    style={PASSWORD_FORM_STYLE}
                  >
                    <span className={styles.confirmPrompt}>
                      This is permanent. All Viritura data tied to your account is removed and can’t be restored.
                      {requiresPassword && " Confirm your current password to continue."}
                    </span>
                    {requiresPassword && (
                      <FormField label="Confirm current password" error={error}>
                        <FormInput
                          type="password"
                          autoComplete="current-password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          required
                          disabled={submitting}
                        />
                      </FormField>
                    )}
                    <PasswordFormActions
                      onCancel={reset}
                      submitting={submitting}
                      submitLabel="Delete my account"
                      danger
                    />
                  </form>
                )
              ) : (
                /* eslint-disable-next-line no-restricted-syntax -- destructive text-link inside disclosure. */
                <button type="button" className={styles.linkActionDanger} onClick={() => setConfirming(true)}>
                  <span>Delete this account permanently</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// -- Display name ----------------------------------------------------------------

/**
 * Display-name management row. Shown as the user's friendly label in the popover header and
 * elsewhere (`AccountDetails` falls back to email when unset). Posts to <c>/account/profile</c>;
 * server normalizes whitespace-only input to null.
 */
export function DisplayNameRow({
  account,
  user,
}: {
  readonly account: VirituraAccountState;
  readonly user: VirituraUser;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [displayName, setDisplayName] = useState(user.displayName ?? "");
  const [error, setError] = useState<string | undefined>();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(undefined);
    const trimmed = displayName.trim();
    updateVirituraProfile({ displayName: trimmed.length > 0 ? trimmed : null })
      .then(() => {
        toast.success(trimmed.length > 0 ? "Display name updated" : "Display name cleared");
        setOpen(false);
        void account.refresh();
      })
      .catch((err: unknown) => {
        const { fieldErrors, message } = unpackAuthError(err);
        if (fieldErrors.displayName?.[0]) {
          setError(fieldErrors.displayName[0]);
        } else {
          toast.error(message);
        }
      })
      .finally(() => setSubmitting(false));
  };

  const current = user.displayName?.trim() ?? "";

  return (
    <div className={styles.provider} data-connected={current ? "true" : "false"}>
      <div className={styles.providerIcon} aria-hidden="true">
        <UserIcon size={16} />
      </div>
      <div className={styles.providerBody}>
        <div className={styles.providerName}>
          <span>Display name</span>
          <span className={styles.providerStatus} data-state={current ? "connected" : "disconnected"}>
            {current ? "Set" : "Not set"}
          </span>
        </div>
        {current && <div className={styles.providerMeta}>{current}</div>}
        <div className={styles.providerActions}>
          {/* eslint-disable-next-line no-restricted-syntax -- muted disclosure toggle; matches EmailRow. */}
          <button
            type="button"
            className={styles.advancedToggle}
            data-open={open ? "true" : "false"}
            aria-expanded={open}
            onClick={() => {
              setOpen((prev) => !prev);
              setError(undefined);
              setDisplayName(user.displayName ?? "");
            }}
          >
            <span>{current ? "Change" : "Set"}</span>
            <ChevronDown size={11} aria-hidden="true" className={styles.advancedChevron} />
          </button>
          {open && (
            <div className={styles.advancedPanel}>
              <form onSubmit={submit} style={PASSWORD_FORM_STYLE}>
                <FormField label="Display name" error={error}>
                  <FormInput
                    type="text"
                    autoComplete="name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    disabled={submitting}
                    maxLength={64}
                    placeholder="How others see you"
                  />
                </FormField>
                <PasswordFormActions
                  submitLabel={submitting ? "Saving…" : "Save"}
                  submitting={submitting}
                  onCancel={() => setOpen(false)}
                />
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
