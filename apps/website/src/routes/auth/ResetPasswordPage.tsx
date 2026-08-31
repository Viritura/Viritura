import { type FormEvent, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AuthApiError, resetPassword } from "../../api/auth";
import { PASSWORD_MIN_LENGTH, PASSWORD_PATTERN, PASSWORD_TITLE } from "../../api/passwordPolicy";
import { PasswordHints } from "./PasswordHints";
import { clearSensitiveLinkUrl } from "./sensitiveLink";

/**
 * Landing page for the password-reset email link. Posts {uid, token, newPassword} to
 * /auth/reset-password; on success the API sets the auth cookie and we redirect into the editor
 * (cookies are shared across localhost ports in dev and *.viritura.com in prod).
 */
interface ResetPasswordPageProps {
  readonly uid: string;
  readonly token: string;
  readonly appUrl: string;
}

export function ResetPasswordPage({ uid, token, appUrl }: ResetPasswordPageProps) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(clearSensitiveLinkUrl, []);

  const missingParams = !uid || !token;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await resetPassword(uid, token, newPassword);
      setDone(true);
      setTimeout(() => {
        window.location.href = appUrl;
      }, 1200);
    } catch (err) {
      setError(err instanceof AuthApiError ? err.message : "Reset failed. The link may have expired.");
    } finally {
      setSubmitting(false);
    }
  };

  if (missingParams) {
    return (
      <section className="auth-card">
        <h1>Invalid reset link</h1>
        <p className="auth-sub">The link is missing required parameters. Request a fresh reset email below.</p>
        <p className="auth-footer-link">
          <Link to="/auth/forgot-password">Send a new reset link</Link>
        </p>
      </section>
    );
  }

  if (done) {
    return (
      <section className="auth-card">
        <h1>Password updated</h1>
        <p className="auth-success">You&apos;re signed in. Redirecting you to the editor…</p>
        <p className="auth-footer-link">
          Not redirected? <a href={appUrl}>Open the editor</a>
        </p>
      </section>
    );
  }

  return (
    <section className="auth-card">
      <h1>Set a new password</h1>
      <p className="auth-sub">Choose a new password for your account. We&apos;ll sign you in once it&apos;s set.</p>
      <form className="auth-form" onSubmit={onSubmit}>
        <div className="auth-field">
          <label htmlFor="reset-password">New password</label>
          <input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            pattern={PASSWORD_PATTERN}
            // eslint-disable-next-line no-restricted-syntax -- HTML pattern mismatch message
            title={PASSWORD_TITLE}
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <PasswordHints value={newPassword} />
        </div>
        <div className="auth-field">
          <label htmlFor="reset-password-confirm">Confirm password</label>
          <input
            id="reset-password-confirm"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        {error ? <p className="auth-error">{error}</p> : null}
        <button type="submit" className="btn btn-primary auth-submit" disabled={submitting}>
          {submitting ? "Updating…" : "Update password"}
        </button>
      </form>
      <p className="auth-footer-link">
        Link expired? <Link to="/auth/forgot-password">Request a new one</Link>
      </p>
    </section>
  );
}
