import { type FormEvent, useState } from "react";
import { AuthApiError, forgotPassword } from "../../api/auth";

/**
 * Kicks off the password-reset flow. POSTs to /auth/forgot-password which always returns 204
 * (enumeration-safe), so the success state shows a generic "if that account exists" message.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      // The endpoint is enumeration-safe — any failure here is transport/server, not user-facing data.
      setError(err instanceof AuthApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <section className="auth-card">
        <h1>Check your email</h1>
        <p className="auth-sub">
          If an account exists for <strong>{email}</strong>, we&apos;ve sent a link to reset your password. The link
          expires shortly for security.
        </p>
        <p className="auth-footer-link">
          Didn&apos;t get it?{" "}
          <button type="button" className="auth-resend" onClick={() => setSent(false)}>
            Try a different email
          </button>
        </p>
      </section>
    );
  }

  return (
    <section className="auth-card">
      <h1>Reset your password</h1>
      <p className="auth-sub">Enter your account email and we&apos;ll send you a link to set a new password.</p>
      <form className="auth-form" onSubmit={onSubmit}>
        <div className="auth-field">
          <label htmlFor="forgot-email">Email</label>
          <input
            id="forgot-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {error ? <p className="auth-error">{error}</p> : null}
        <button type="submit" className="btn btn-primary auth-submit" disabled={submitting}>
          {submitting ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <p className="auth-footer-link">
        Remembered it? <a href="/signup">Back to sign up</a>
      </p>
    </section>
  );
}
