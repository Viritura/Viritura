import { useEffect, useRef, useState } from "react";
import { AuthApiError, resendVerification, verifyEmail } from "../../api/auth";
import { clearSensitiveLinkUrl } from "./sensitiveLink";

/**
 * Handles the click-through from the verification email. Posts {uid, token} to
 * /auth/verify; on success the API sets the auth cookie and we redirect into
 * the editor. The cookie is host-only on localhost (shared across ports in
 * dev) and will be scoped to the parent domain in prod.
 */
interface VerifyEmailPageProps {
  readonly uid?: string;
  readonly token?: string;
  readonly appUrl: string;
}

type VerifyStatus = "verifying" | "success" | "failed" | "invalid";

export function VerifyEmailPage({ uid, token, appUrl }: VerifyEmailPageProps) {
  const resolvedUid = uid ?? (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("uid") ?? "");
  const resolvedToken =
    token ?? (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("token") ?? "");
  const [status, setStatus] = useState<VerifyStatus>(resolvedUid && resolvedToken ? "verifying" : "invalid");
  const [error, setError] = useState<string | null>(null);
  const [resendEmail, setResendEmail] = useState("");
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent">("idle");
  // Effects run twice in Strict Mode; guard against double-POST so we don't
  // burn the (single-use) confirmation token on the dev re-mount.
  const attempted = useRef(false);

  useEffect(() => {
    if (!resolvedUid || !resolvedToken || attempted.current) return;
    attempted.current = true;
    clearSensitiveLinkUrl();
    // No `cancelled` flag here: the `attempted` ref already prevents the Strict-Mode
    // double-invoke from posting twice, and a cleanup-driven cancel would swallow the
    // success/failure of the (single) in-flight request when the first effect tears
    // down before the response arrives.
    (async () => {
      try {
        await verifyEmail(resolvedUid, resolvedToken);
        setStatus("success");
        // Brief delay so the user sees the success state before we navigate away.
        setTimeout(() => {
          window.location.href = appUrl;
        }, 1200);
      } catch (err) {
        setStatus("failed");
        setError(err instanceof AuthApiError ? err.message : "Verification failed.");
      }
    })();
  }, [resolvedUid, resolvedToken, appUrl]);

  const onResend = async () => {
    if (!resendEmail || resendStatus === "sending") return;
    setResendStatus("sending");
    try {
      await resendVerification(resendEmail.trim());
      setResendStatus("sent");
    } catch {
      // Endpoint always succeeds; if it doesn't, fall back to idle so the user can retry.
      setResendStatus("idle");
    }
  };

  if (status === "invalid") {
    return (
      <section className="auth-card">
        <h1>Invalid verification link</h1>
        <p className="auth-sub">
          The link is missing required parameters. Sign up again or request a fresh verification email below.
        </p>
        <p className="auth-footer-link">
          <a href="/signup">Back to sign up</a>
        </p>
      </section>
    );
  }

  if (status === "verifying") {
    return (
      <section className="auth-card">
        <h1>Verifying your email…</h1>
        <p className="auth-sub">One moment.</p>
      </section>
    );
  }

  if (status === "success") {
    return (
      <section className="auth-card">
        <h1>You&apos;re in.</h1>
        <p className="auth-success">Email verified. Redirecting you to the editor…</p>
        <p className="auth-footer-link">
          Not redirected? <a href={appUrl}>Open the editor</a>
        </p>
      </section>
    );
  }

  // status === "failed"
  return (
    <section className="auth-card">
      <h1>That link didn&apos;t work</h1>
      <p className="auth-sub">
        {error ?? "The verification link is invalid or expired."} Enter your email and we&apos;ll send a new one.
      </p>
      <div className="auth-form">
        <div className="auth-field">
          <label htmlFor="resend-email">Email</label>
          <input
            id="resend-email"
            type="email"
            autoComplete="email"
            value={resendEmail}
            onChange={(e) => setResendEmail(e.target.value)}
          />
        </div>
        {resendStatus === "sent" ? (
          <p className="auth-success">If that account exists, a new verification email is on the way.</p>
        ) : null}
        <button
          type="button"
          className="btn btn-primary auth-submit"
          onClick={onResend}
          disabled={!resendEmail || resendStatus === "sending"}
        >
          {resendStatus === "sending" ? "Sending…" : "Send new verification email"}
        </button>
      </div>
    </section>
  );
}
