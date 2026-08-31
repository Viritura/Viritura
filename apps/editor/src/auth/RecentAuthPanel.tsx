import { useState, type FormEvent } from "react";
import { FormField, FormInput } from "@viritura/ui";
import {
  establishRecentAuthWithPassword,
  getRecentAuthProviderUrl,
  type RecentAuthAction,
  type VirituraUser,
} from "./api";
import { PASSWORD_FORM_STYLE, unpackAuthError } from "./accountFormShared";
import { PasswordFormActions } from "./PasswordFormActions";
import styles from "./AccountButton.module.css";

export function RecentAuthPanel({
  user,
  action,
  onCancel,
  onVerified,
}: {
  readonly user: VirituraUser;
  readonly action: RecentAuthAction;
  readonly onCancel: () => void;
  readonly onVerified: () => void;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const providers = Array.from(
    new Set(
      user.externalLogins
        .map((login) => login.provider)
        .filter((provider): provider is "Google" | "GitHub" => provider === "Google" || provider === "GitHub"),
    ),
  );

  const submitPassword = (event: FormEvent): void => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    establishRecentAuthWithPassword({ action, password, code: code.trim() || undefined })
      .then(onVerified)
      .catch((reason: unknown) => setError(unpackAuthError(reason).message))
      .finally(() => setSubmitting(false));
  };

  return (
    <div className={styles.confirmRow}>
      <span className={styles.confirmPrompt}>
        Confirm an existing sign-in method before changing account security. Provider verification returns here; then
        repeat the action.
      </span>
      {user.hasPassword ? (
        <form onSubmit={submitPassword} style={PASSWORD_FORM_STYLE}>
          <FormField label="Current password" error={error}>
            <FormInput
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              disabled={submitting}
            />
          </FormField>
          <FormField label="Authenticator code (when 2FA is enabled)">
            <FormInput
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              disabled={submitting}
            />
          </FormField>
          <PasswordFormActions onCancel={onCancel} submitting={submitting} submitLabel="Verify" />
        </form>
      ) : (
        <div className={styles.confirmActions}>
          {providers.map((provider) => (
            <a key={provider} className={styles.linkActionPrimary} href={getRecentAuthProviderUrl(provider, action)}>
              Verify with {provider}
            </a>
          ))}
          {/* eslint-disable-next-line no-restricted-syntax -- inline cancel for recent-auth disclosure. */}
          <button type="button" className={styles.linkAction} onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
