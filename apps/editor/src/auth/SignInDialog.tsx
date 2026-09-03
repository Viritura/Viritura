import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import {
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogCancelButton,
  DialogPrimaryButton,
  DialogTitle,
  FormField,
  FormInput,
} from "@viritura/ui";
import { beginGitHubLogin } from "../github/api";
import {
  AuthApiError,
  clearPendingTwoFactorChallenge,
  getVirituraAuthBaseUrl,
  hasPendingTwoFactorChallenge,
  resendVirituraVerification,
  type AuthCapabilities,
  type EmailRegistrationMode,
} from "./api";
import type { VirituraAccountState } from "./useVirituraAccount";
import { useAuthCapabilities } from "./useAuthCapabilities";
import { useTwoFactorRecoveryRequest } from "./useTwoFactorRecoveryRequest";
import { GitHubMark } from "../brand/GitHubMark";
import styles from "./SignInDialog.module.css";

interface SignInDialogProps {
  readonly open: boolean;
  readonly account: VirituraAccountState;
  readonly onClose: () => void;
  readonly onSignedIn?: () => void;
}

// Sign-up lives on the marketing site so the verification flow (link click ->
// /auth/verify) has dedicated routes. Cookies are shared across localhost ports
// in dev and across *.viritura.com in prod, so verification signs the user in
// for the editor automatically.
const IS_DEV = import.meta.env.DEV;
const WEBSITE_BASE_URL =
  (import.meta.env.VITE_VIRITURA_WEBSITE_URL as string | undefined)?.replace(/\/+$/, "") ??
  (IS_DEV ? "http://localhost:5180" : "https://viritura.com");
const SIGN_UP_URL = `${WEBSITE_BASE_URL}/signup`;
const FORGOT_PASSWORD_URL = `${WEBSITE_BASE_URL}/auth/forgot-password`;

const DESCRIPTION_STYLE: CSSProperties = {
  margin: "0 0 0.85rem",
  color: "var(--text-muted)",
  fontSize: "var(--type-small-size)",
};

const PROVIDER_LIST_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  margin: "0 0 0.85rem",
};

const PROVIDER_BUTTON_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.55rem",
  width: "100%",
  minHeight: "38px",
  padding: "0.5rem 0.9rem",
  borderRadius: "var(--radius-sm, 6px)",
  border: "1px solid var(--border, rgba(255, 255, 255, 0.12))",
  background: "var(--surface-1, rgba(255, 255, 255, 0.04))",
  color: "var(--text, inherit)",
  font: "inherit",
  fontWeight: "var(--type-heading-weight)",
  cursor: "pointer",
  textDecoration: "none",
};

const DIVIDER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.65rem",
  margin: "0.25rem 0 0.85rem",
  color: "var(--text-muted)",
  fontSize: "var(--type-eyebrow-size)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const DIVIDER_LINE_STYLE: CSSProperties = {
  flex: 1,
  height: "1px",
  background: "var(--border, rgba(255, 255, 255, 0.1))",
};

const FOOTER_STYLE: CSSProperties = {
  marginTop: "1rem",
  fontSize: "var(--type-small-size)",
  color: "var(--text-muted)",
  display: "flex",
  gap: "0.4rem",
  justifyContent: "center",
  alignItems: "center",
};

const FORM_ERROR_STYLE: CSSProperties = {
  background: "var(--surface-error, rgba(220, 38, 38, 0.1))",
  border: "1px solid var(--border-error, rgba(220, 38, 38, 0.4))",
  borderRadius: "var(--radius-sm, 6px)",
  color: "var(--text-error, #f87171)",
  padding: "0.5rem 0.75rem",
  marginBottom: "0.75rem",
  fontSize: "var(--type-small-size)",
};

const UNVERIFIED_STYLE: CSSProperties = {
  color: "var(--text-muted)",
  margin: "-0.35rem 0 0.75rem",
  fontSize: "var(--type-small-size)",
  display: "flex",
  alignItems: "center",
  gap: "0.35rem",
  flexWrap: "wrap",
};

const RESEND_BUTTON_STYLE: CSSProperties = {
  alignSelf: "flex-start",
  background: "none",
  border: "none",
  padding: 0,
  color: "var(--accent)",
  cursor: "pointer",
  font: "inherit",
  fontWeight: "var(--type-heading-weight)",
  textDecoration: "underline",
};

const REMEMBER_ROW_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.45rem",
  margin: "0.25rem 0 0.5rem",
  fontSize: "var(--type-small-size)",
  color: "var(--text-muted)",
};

const RECOVERY_HINT_STYLE: CSSProperties = {
  marginTop: "0.6rem",
  fontSize: "var(--type-small-size)",
  color: "var(--text-muted)",
};

const RECOVERY_FOOTER_STYLE: CSSProperties = {
  ...FOOTER_STYLE,
  marginTop: "0.6rem",
};

const RECOVERY_ERROR_STYLE: CSSProperties = {
  marginTop: "0.4rem",
  fontSize: "var(--type-small-size)",
  color: "var(--text-error, #f87171)",
};

function ProviderOptions({
  capabilities,
  googleStartUrl,
  submitting,
}: {
  capabilities: AuthCapabilities | null;
  googleStartUrl: string;
  submitting: boolean;
}) {
  const hasProvider = capabilities?.gitHubLoginEnabled === true || capabilities?.googleLoginEnabled === true;
  if (!hasProvider) return null;

  return (
    <>
      <p style={DESCRIPTION_STYLE}>Choose a provider or use your email.</p>
      <div style={PROVIDER_LIST_STYLE}>
        {capabilities?.gitHubLoginEnabled ? (
          <>
            {/* eslint-disable-next-line no-restricted-syntax -- bespoke OAuth provider button with provider icon + full-width brand chrome; Button from @viritura/ui doesn't model the provider-card pattern. */}
            <button
              type="button"
              style={PROVIDER_BUTTON_STYLE}
              disabled={submitting}
              onClick={() => beginGitHubLogin(undefined, "start-center")}
            >
              <GitHubMark size={16} aria-hidden="true" />
              <span>Continue with GitHub</span>
            </button>
          </>
        ) : null}
        {capabilities?.googleLoginEnabled ? (
          <a style={PROVIDER_BUTTON_STYLE} href={googleStartUrl}>
            <GoogleIcon />
            <span>Continue with Google</span>
          </a>
        ) : null}
      </div>
      <div style={DIVIDER_STYLE}>
        <span style={DIVIDER_LINE_STYLE} aria-hidden="true" />
        <span>or with email</span>
        <span style={DIVIDER_LINE_STYLE} aria-hidden="true" />
      </div>
    </>
  );
}

function CredentialError({
  message,
  email,
  resendStatus,
  onResend,
}: {
  message: string | null;
  email: string;
  resendStatus: "idle" | "sending" | "sent";
  onResend: () => Promise<void>;
}) {
  if (!message) return null;
  return (
    <>
      <div style={FORM_ERROR_STYLE} role="alert">
        {message}
      </div>
      <div style={UNVERIFIED_STYLE}>
        <span>Need to verify your email?</span>
        {resendStatus === "sent" ? (
          <span>A new verification email is on the way.</span>
        ) : (
          // The endpoint is enumeration-safe, so this remains available after every generic credential failure.
          // eslint-disable-next-line no-restricted-syntax -- inline recovery action belongs next to its prompt.
          <button
            type="button"
            style={RESEND_BUTTON_STYLE}
            onClick={() => void onResend()}
            disabled={resendStatus === "sending" || !email.trim()}
          >
            {resendStatus === "sending" ? "Sending…" : "Resend verification email"}
          </button>
        )}
      </div>
    </>
  );
}

/**
 * Single-purpose sign-in dialog. Offers OAuth (GitHub, Google) above an
 * email/password form, with a footer link to the marketing site for new
 * accounts.
 *
 * The server collapses every sign-in failure mode (unknown email, wrong
 * password, OAuth-only account, unconfirmed mailbox, account lockout) to a
 * single generic 401 to avoid acting as an email-enumeration oracle, so we
 * can't selectively show an "email not confirmed" affordance based on the
 * response. Instead, after any failed credential attempt we surface a
 * "Resend verification email" link alongside the generic error — the
 * legitimate user who happens to be unconfirmed sees it; an enumerator
 * gains no extra signal because the link is shown unconditionally on error.
 */
export function SignInDialog({ open, account, onClose, onSignedIn }: SignInDialogProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent">("idle");
  const capabilities = useAuthCapabilities(open);
  // Second-step state. "password" is the credentials form; "totp" and "recovery" are reached
  // after the password step returns RequiresTwoFactor.
  const [step, setStep] = useState<"password" | "totp" | "recovery">(() =>
    hasPendingTwoFactorChallenge() ? "totp" : "password",
  );
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [rememberClient, setRememberClient] = useState(false);
  // "Lost your authenticator and recovery codes" fallback. The server always returns 204, so
  // the hook optimistically flips to "sent" on success.
  const recoveryRequest = useTwoFactorRecoveryRequest();
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect: reset form on close
      setEmail("");
      setPassword("");
      setFormError(null);
      setFieldErrors({});
      setResendStatus("idle");
      setSubmitting(false);
      setStep("password");
      setTwoFactorCode("");
      setRememberClient(false);
      recoveryRequest.reset();
    }
  }, [open, recoveryRequest]);
  const googleStartUrl = `${getVirituraAuthBaseUrl()}/auth/external/google/start?returnTo=${encodeURIComponent(currentLocation())}`;
  const canSubmit =
    step === "password" ? email.trim().length > 0 && password.length > 0 : twoFactorCode.trim().length > 0;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});
    setResendStatus("idle");
    try {
      if (step === "password") {
        const result = await account.signIn({ email: email.trim(), password, rememberMe: true });
        if (result.status === "requiresTwoFactor") {
          setStep("totp");
          return; // stay open for the second factor
        }
        onSignedIn?.();
        onClose();
        return;
      }
      if (step === "totp") {
        await account.signInTwoFactor({ code: twoFactorCode.trim(), rememberClient });
        clearPendingTwoFactorChallenge();
        onSignedIn?.();
        onClose();
        return;
      }
      await account.signInRecovery({ code: twoFactorCode.trim() });
      clearPendingTwoFactorChallenge();
      onSignedIn?.();
      onClose();
    } catch (err) {
      if (err instanceof AuthApiError) {
        const next: Record<string, string> = {};
        if (err.fieldErrors) {
          for (const [field, messages] of Object.entries(err.fieldErrors)) {
            const first = messages[0];
            if (first) next[field.toLowerCase()] = first;
          }
        }
        setFieldErrors(next);
        setFormError(err.message);
      } else {
        setFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async (): Promise<void> => {
    const trimmed = email.trim();
    if (!trimmed || resendStatus === "sending") return;
    setResendStatus("sending");
    try {
      await resendVirituraVerification(trimmed);
      setResendStatus("sent");
    } catch {
      // Endpoint is enumeration-safe and shouldn't fail; fall back to idle.
      setResendStatus("idle");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} size="compact">
      <form onSubmit={handleSubmit}>
        <DialogTitle>{step === "password" ? "Sign in to Viritura" : "Two-factor authentication"}</DialogTitle>
        <DialogBody className={styles.body}>
          {step === "password" ? (
            <>
              <ProviderOptions capabilities={capabilities} googleStartUrl={googleStartUrl} submitting={submitting} />
              <CredentialError message={formError} email={email} resendStatus={resendStatus} onResend={handleResend} />
              <FormField label="Email" error={fieldErrors.email}>
                <FormInput
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setFormError(null);
                    setFieldErrors((current) => ({ ...current, email: "" }));
                  }}
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoFocus
                  required
                  disabled={submitting}
                />
              </FormField>
              <FormField
                label="Password"
                error={fieldErrors.password}
                action={
                  <a className={styles.fieldAction} href={FORGOT_PASSWORD_URL} target="_blank" rel="noreferrer">
                    Forgot password?
                  </a>
                }
              >
                <FormInput
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setFormError(null);
                    setFieldErrors((current) => ({ ...current, password: "" }));
                  }}
                  placeholder="Your password"
                  autoComplete="current-password"
                  required
                  disabled={submitting}
                />
              </FormField>
            </>
          ) : (
            <TwoFactorStep
              step={step}
              code={twoFactorCode}
              setCode={setTwoFactorCode}
              rememberClient={rememberClient}
              setRememberClient={setRememberClient}
              formError={formError}
              fieldError={fieldErrors.code}
              onToggleStep={() => {
                setStep(step === "totp" ? "recovery" : "totp");
                setTwoFactorCode("");
                setFormError(null);
                setFieldErrors({});
              }}
              recoveryEmailStatus={recoveryRequest.status}
              recoveryEmailError={recoveryRequest.error}
              onRequestRecoveryEmail={recoveryRequest.request}
            />
          )}
        </DialogBody>
        <DialogActions>
          {step === "password" && <SignUpAvailability mode={capabilities?.emailRegistrationMode} />}
          <DialogCancelButton>Cancel</DialogCancelButton>
          <DialogPrimaryButton disabled={submitting || !canSubmit}>
            {submitting ? "Please wait…" : step === "password" ? "Sign in" : "Verify"}
          </DialogPrimaryButton>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function SignUpAvailability({ mode }: { readonly mode: EmailRegistrationMode | undefined }) {
  if (mode === "Disabled") {
    return <span className={styles.footerPrompt}>Registration is closed</span>;
  }

  return (
    <span className={styles.footerPrompt}>
      <span>{mode === "AllowList" ? "Have an invitation?" : "New here?"}</span>
      <a className={styles.accountLink} href={SIGN_UP_URL} target="_blank" rel="noreferrer">
        Create account
      </a>
    </span>
  );
}

/**
 * Second-step view: TOTP or recovery code entry. Lives in the same file because it's a private
 * sub-step of the sign-in flow, but extracted to keep <c>SignInDialog</c> below the max-function
 * lines threshold and to isolate the alternate-flow toggle.
 */
function TwoFactorStep({
  step,
  code,
  setCode,
  rememberClient,
  setRememberClient,
  formError,
  fieldError,
  onToggleStep,
  recoveryEmailStatus,
  recoveryEmailError,
  onRequestRecoveryEmail,
}: {
  readonly step: "totp" | "recovery";
  readonly code: string;
  readonly setCode: (value: string) => void;
  readonly rememberClient: boolean;
  readonly setRememberClient: (value: boolean) => void;
  readonly formError: string | null;
  readonly fieldError: string | undefined;
  readonly onToggleStep: () => void;
  readonly recoveryEmailStatus: "idle" | "sending" | "sent" | "error";
  readonly recoveryEmailError: string | null;
  readonly onRequestRecoveryEmail: () => Promise<void>;
}) {
  const isTotp = step === "totp";
  return (
    <>
      <p style={DESCRIPTION_STYLE}>
        {isTotp
          ? "Enter the 6-digit code from your authenticator app."
          : "Enter one of your single-use recovery codes."}
      </p>
      {formError && (
        <div style={FORM_ERROR_STYLE} role="alert">
          {formError}
        </div>
      )}
      <FormField label={isTotp ? "Authenticator code" : "Recovery code"} error={fieldError}>
        <FormInput
          type="text"
          inputMode={isTotp ? "numeric" : "text"}
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={isTotp ? "123 456" : "xxxx-xxxx"}
          autoFocus
          required
        />
      </FormField>
      {isTotp && (
        <div style={REMEMBER_ROW_STYLE}>
          <Checkbox
            checked={rememberClient}
            onChange={(e) => setRememberClient(e.target.checked)}
            label="Trust this browser for 30 days"
          />
        </div>
      )}
      <div style={FOOTER_STYLE}>
        {/* eslint-disable-next-line no-restricted-syntax -- inline link-style toggle to swap between TOTP and recovery flows; Button chrome doesn't match. */}
        <button type="button" style={RESEND_BUTTON_STYLE} onClick={onToggleStep}>
          {isTotp ? "Use a recovery code instead" : "Use authenticator code instead"}
        </button>
      </div>
      {recoveryEmailStatus === "sent" ? (
        <p style={RECOVERY_HINT_STYLE}>
          We sent a recovery link to the email on file. Click it to turn off two-factor authentication and sign in.
        </p>
      ) : (
        <div style={RECOVERY_FOOTER_STYLE}>
          {/* eslint-disable-next-line no-restricted-syntax -- link-style action button; Button chrome doesn't match this inline footer affordance. */}
          <button
            type="button"
            style={RESEND_BUTTON_STYLE}
            onClick={() => {
              void onRequestRecoveryEmail();
            }}
            disabled={recoveryEmailStatus === "sending"}
          >
            {recoveryEmailStatus === "sending" ? "Sending…" : "Lost your authenticator and recovery codes?"}
          </button>
        </div>
      )}
      {recoveryEmailStatus === "error" && recoveryEmailError ? (
        <p style={RECOVERY_ERROR_STYLE}>{recoveryEmailError}</p>
      ) : null}
    </>
  );
}

function currentLocation(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.568 2.684-3.874 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.583-5.036-3.71H.957v2.332A8.997 8.997 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.708A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.708V4.96H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.04l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.892 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.96L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
      />
    </svg>
  );
}
