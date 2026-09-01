import { type FormEvent, useEffect, useState } from "react";
import {
  AuthApiError,
  getAuthCapabilities,
  registerAccount,
  type AuthCapabilities,
  type RegisterPendingVerificationResponse,
} from "../../api/auth";
import { PASSWORD_MIN_LENGTH, PASSWORD_PATTERN, PASSWORD_TITLE } from "../../api/passwordPolicy";
import { PasswordHints } from "./PasswordHints";

/**
 * Sign-up page (email + password). Posts to /auth/register, which creates
 * the account with EmailConfirmed=false and sends a verification link. On
 * 202 we navigate to /signup/check-email?email=…; on the (disabled by
 * default in dev) auto-confirm path we redirect straight into the editor.
 *
 * OAuth (GitHub/Google) lives on the editor's sign-in dialog — those flows
 * verify the email via the provider and don't need a separate sign-up step.
 */
interface SignUpPageProps {
  readonly appUrl: string;
}

export function SignUpPage({ appUrl }: SignUpPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(null);

  useEffect(() => {
    let active = true;
    void getAuthCapabilities()
      .then((value) => {
        if (active) setCapabilities(value);
      })
      .catch(() => {
        // Registration POST remains server-enforced if capability discovery fails.
      });
    return () => {
      active = false;
    };
  }, []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await registerAccount({
        email: email.trim(),
        password,
        displayName: displayName.trim() || undefined,
      });
      // Every 202 path uses the same response shape and copy so registration
      // cannot reveal whether the address is new, unconfirmed, local, or OAuth-linked.
      if (!("id" in result)) {
        const pending = result as RegisterPendingVerificationResponse;
        const search = new URLSearchParams({ email: pending.email });
        window.location.href = `/signup/check-email?${search}`;
        return;
      }
      // Verification disabled (e.g. test envs) — user is signed in already; go to the editor.
      window.location.href = appUrl;
    } catch (err) {
      const message = err instanceof AuthApiError ? err.message : "Something went wrong. Please try again.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="auth-card">
      <h1>Create your Viritura account</h1>
      <p className="auth-sub">
        {capabilities?.emailRegistrationMode === "Disabled"
          ? "New email registration is currently closed. Existing accounts can still sign in."
          : capabilities?.emailRegistrationMode === "AllowList"
            ? "Early access is invitation-only. Use the invited email address and we'll send a verification link."
            : "Sign up with email and password. We'll send a verification link to confirm your address."}
      </p>
      {capabilities?.emailRegistrationMode !== "Disabled" ? (
        <form className="auth-form" onSubmit={onSubmit}>
          <div className="auth-field">
            <label htmlFor="signup-email">Email</label>
            <input
              id="signup-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="auth-field">
            <label htmlFor="signup-password">Password</label>
            <input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              pattern={PASSWORD_PATTERN}
              // eslint-disable-next-line no-restricted-syntax -- HTML pattern mismatch message
              title={PASSWORD_TITLE}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <PasswordHints value={password} />
          </div>
          <div className="auth-field">
            <label htmlFor="signup-displayname">Display name (optional)</label>
            <input
              id="signup-displayname"
              type="text"
              autoComplete="nickname"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          {error ? <p className="auth-error">{error}</p> : null}
          <button type="submit" className="btn btn-primary auth-submit" disabled={submitting}>
            {submitting ? "Creating account…" : "Create account"}
          </button>
        </form>
      ) : null}
      <p className="auth-footer-link">
        Already have an account? <a href={appUrl}>Sign in</a>
      </p>
      <p className="auth-footer-link">
        Prefer GitHub{capabilities?.googleLoginEnabled ? " or Google" : ""}?{" "}
        <a href="/">Use the sign-in dialog in the editor</a>
      </p>
    </section>
  );
}
