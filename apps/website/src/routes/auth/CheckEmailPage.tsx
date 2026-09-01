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
  readonly email?: string;
}

export function CheckEmailPage({ email }: CheckEmailPageProps) {
  const resolvedEmail =
    email ?? (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("email") ?? "");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const onResend = async () => {
    if (!resolvedEmail || status === "sending") return;
    setStatus("sending");
    setError(null);
    try {
      await Promise.all([forgotPassword(resolvedEmail), resendVerification(resolvedEmail)]);
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
        If the address <strong>{resolvedEmail || "you entered"}</strong> can continue, a confirmation link is on its
        way. Open the message to verify the mailbox or recover the existing account.
      </p>
      {status === "sent" ? <p className="auth-success">Resent. Check your inbox again in a moment.</p> : null}
      {status === "error" && error ? <p className="auth-error">{error}</p> : null}
      <button
        type="button"
        className="auth-resend"
        onClick={onResend}
        disabled={!resolvedEmail || status === "sending"}
      >
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
