import { useState } from "react";
import { AuthApiError, forgotPassword, resendVerification } from "../../api/auth";

const IS_DEV = import.meta.env.DEV;

/**
 * Post sign-up confirmation: "we sent a link to {email}".
 *
 * Copy and resend behavior are deliberately identical for new, existing,
 * unconfirmed, local, and OAuth-linked accounts.
 */
interface CheckEmailPageProps {
  readonly email: string;
}

export function CheckEmailPage({ email }: CheckEmailPageProps) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const onResend = async () => {
    if (!email || status === "sending") return;
    setStatus("sending");
    setError(null);
    try {
      await Promise.all([forgotPassword(email), resendVerification(email)]);
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setError(err instanceof AuthApiError ? err.message : "Couldn't resend right now.");
    }
  };

  return (
    <section className="auth-card">
      <h1>Check your email</h1>
      <p className="auth-sub">
        If the address <strong>{email || "you entered"}</strong> can continue, a confirmation link is on its way. Open
        the message to verify the mailbox or recover the existing account.
      </p>
      {status === "sent" ? <p className="auth-success">Resent. Check your inbox again in a moment.</p> : null}
      {status === "error" && error ? <p className="auth-error">{error}</p> : null}
      <button type="button" className="auth-resend" onClick={onResend} disabled={!email || status === "sending"}>
        {status === "sending" ? "Sending…" : "Resend confirmation email"}
      </button>
      {IS_DEV ? (
        <p className="auth-dev-note">
          Dev: the link is logged to the API terminal (look for the EMAIL block) instead of being delivered.
        </p>
      ) : null}
    </section>
  );
}
