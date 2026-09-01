import { type FormEvent, useEffect, useState } from "react";
import { AuthApiError, disableTwoFactorByRecoveryToken } from "../../api/auth";
import { clearSensitiveLinkUrl } from "./sensitiveLink";

/**
 * Landing page for the two-factor recovery email link. The user got here because they clicked
 * "lost your authenticator and recovery codes" in the editor's 2FA prompt and then opened the
 * email we sent. They explicitly confirm via the button before we call the disable endpoint —
 * we never auto-disable on link visit so link prefetchers and security scanners can't trip the
 * flow.
 *
 * On confirm:
 *  - 2FA is turned off on the account.
 *  - The authenticator shared secret is cleared (so re-enabling later requires a fresh pairing).
 *  - The security stamp rolls, invalidating the recovery token + every other outstanding token.
 *  - The full auth cookie is set; we redirect into the editor.
 *
 * If the user wants 2FA back on after this, they'll go to Account → Two-factor authentication
 * and pair a fresh authenticator.
 */
interface TwoFactorRecoveryPageProps {
  readonly uid?: string;
  readonly token?: string;
  readonly appUrl: string;
}

export function TwoFactorRecoveryPage({ uid, token, appUrl }: TwoFactorRecoveryPageProps) {
  const resolvedUid =
    uid ?? (typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("uid") ?? ""));
  const resolvedToken =
    token ?? (typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("token") ?? ""));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(clearSensitiveLinkUrl, []);

  const missingParams = !resolvedUid || !resolvedToken;

  const onConfirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await disableTwoFactorByRecoveryToken(resolvedUid, resolvedToken);
      setDone(true);
      setTimeout(() => {
        window.location.href = appUrl;
      }, 1200);
    } catch (err) {
      setError(err instanceof AuthApiError ? err.message : "This link is invalid or has expired.");
    } finally {
      setSubmitting(false);
    }
  };

  if (missingParams) {
    return (
      <section className="auth-card">
        <h1>Invalid recovery link</h1>
        <p className="auth-sub">
          The link is missing required parameters. Try signing in again and request a fresh recovery email from the
          two-factor prompt.
        </p>
        <p className="auth-footer-link">
          <a href="/">Back to home</a>
        </p>
      </section>
    );
  }

  if (done) {
    return (
      <section className="auth-card">
        <h1>Two-factor authentication turned off</h1>
        <p className="auth-success">You&apos;re signed in. Redirecting you to the editor…</p>
        <p className="auth-footer-link">
          Not redirected? <a href={appUrl}>Open the editor</a>
        </p>
      </section>
    );
  }

  return (
    <section className="auth-card">
      <h1>Turn off two-factor authentication?</h1>
      <p className="auth-sub">
        Confirming will disable two-factor authentication on your account and sign you in. We recommend turning it back
        on as soon as you have access to an authenticator app again — you can do that from{" "}
        <strong>Account → Two-factor authentication</strong>.
      </p>
      {error ? <p className="auth-error">{error}</p> : null}
      <form className="auth-form" onSubmit={onConfirm}>
        <button type="submit" className="auth-submit" disabled={submitting}>
          {submitting ? "Disabling…" : "Yes, turn off 2FA and sign me in"}
        </button>
      </form>
      <p className="auth-footer-link">Didn&apos;t request this? Close this page and change your password instead.</p>
    </section>
  );
}
