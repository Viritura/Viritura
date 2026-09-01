import { useEffect, useRef, useState } from "react";
import { AuthApiError, confirmEmailChange } from "../../api/auth";
import { clearSensitiveLinkUrl } from "./sensitiveLink";

/**
 * Landing page for the email-change confirmation link. The user got here because they (or
 * someone signed in as them) clicked "Change email" in the editor's account settings, which
 * sent a confirmation link to the NEW address. The actual swap happens on visit: the token is
 * single-use and bound to the new address, the security stamp rolls (invalidating other
 * sessions / outstanding tokens), and the full auth cookie is set so we can redirect into the
 * editor signed in with the updated identity.
 *
 * Unlike the 2FA-recovery landing page (which requires an explicit confirm button so prefetchers
 * can't trip a destructive action), changing an email is reversible and the user already
 * confirmed intent in the editor before requesting the link. We still guard against the
 * Strict-Mode double-mount with a ref so the single-use token isn't burned twice.
 */
interface ConfirmEmailChangePageProps {
  readonly uid?: string;
  readonly newEmail?: string;
  readonly token?: string;
  readonly appUrl: string;
}

type Status = "confirming" | "success" | "failed" | "invalid";

export function ConfirmEmailChangePage({ uid, newEmail, token, appUrl }: ConfirmEmailChangePageProps) {
  const search = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const resolvedUid = uid ?? search?.get("uid") ?? "";
  const resolvedEmail = newEmail ?? search?.get("email") ?? "";
  const resolvedToken = token ?? search?.get("token") ?? "";
  const [status, setStatus] = useState<Status>(resolvedUid && resolvedEmail && resolvedToken ? "confirming" : "invalid");
  const [error, setError] = useState<string | null>(null);
  // Effects fire twice in Strict Mode; guard so we don't burn the single-use token on re-mount.
  const attempted = useRef(false);

  useEffect(() => {
    if (!resolvedUid || !resolvedEmail || !resolvedToken || attempted.current) return;
    attempted.current = true;
    clearSensitiveLinkUrl();
    (async () => {
      try {
        await confirmEmailChange(resolvedUid, resolvedEmail, resolvedToken);
        setStatus("success");
        setTimeout(() => {
          window.location.href = appUrl;
        }, 1200);
      } catch (err) {
        setStatus("failed");
        setError(err instanceof AuthApiError ? err.message : "This confirmation link is invalid or has expired.");
      }
    })();
  }, [resolvedUid, resolvedEmail, resolvedToken, appUrl]);

  if (status === "invalid") {
    return (
      <section className="auth-card">
        <h1>Invalid confirmation link</h1>
        <p className="auth-sub">
          The link is missing required parameters. Sign in and request a fresh email-change confirmation from{" "}
          <strong>Account → Email</strong>.
        </p>
        <p className="auth-footer-link">
          <a href="/">Back to home</a>
        </p>
      </section>
    );
  }

  if (status === "confirming") {
    return (
      <section className="auth-card">
        <h1>Confirming your new email…</h1>
        <p className="auth-sub">One moment.</p>
      </section>
    );
  }

  if (status === "success") {
    return (
      <section className="auth-card">
        <h1>Email updated.</h1>
        <p className="auth-success">
          Your Viritura account email is now <strong>{resolvedEmail}</strong>. Redirecting you to the editor…
        </p>
        <p className="auth-footer-link">
          Not redirected? <a href={appUrl}>Open the editor</a>
        </p>
      </section>
    );
  }

  return (
    <section className="auth-card">
      <h1>That link didn&apos;t work</h1>
      <p className="auth-error">{error}</p>
      <p className="auth-sub">
        Email-change links expire after a day and can only be used once. Sign in to your account and request a fresh one
        from <strong>Account → Email</strong>.
      </p>
      <p className="auth-footer-link">
        <a href="/">Back to home</a>
      </p>
    </section>
  );
}
