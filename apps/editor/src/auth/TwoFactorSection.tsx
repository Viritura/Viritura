import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { FormField, FormInput } from "@viritura/ui";
import {
  AuthApiError,
  disableTwoFactor,
  enableTwoFactor,
  getRecentAuthStatus,
  getTwoFactorStatus,
  regenerateRecoveryCodes,
  setupTwoFactor,
  type TwoFactorSetup,
  type TwoFactorStatus,
  type VirituraUser,
} from "./api";
import { RecentAuthPanel } from "./RecentAuthPanel";
import styles from "./AccountButton.module.css";

/**
 * Two-factor authentication section. Lives in a sibling file rather than inside
 * <c>AccountDetails.tsx</c> because the setup wizard, status row, disable form, and recovery-code
 * panel together push that file past the max-lines budget. The status is fetched lazily when the
 * disclosure first opens so users who never expand the section pay no extra round-trip.
 */
export function TwoFactorRow({ user }: { readonly user: VirituraUser }) {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "reauth" | "setup" | "disable" | "regenerate">("menu");

  const loadStatus = (): void => {
    setStatusError(null);
    getTwoFactorStatus()
      .then(setStatus)
      .catch((err: unknown) => {
        setStatusError(err instanceof Error ? err.message : "Could not load status.");
      });
  };

  // Load status eagerly so the row's "Set up 2FA" vs "Manage 2FA" label and the Enabled/Disabled
  // badge are correct on first render. The popover only mounts when the account button is opened,
  // so this still costs nothing for users who never open the account menu.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical fetch-on-mount: loadStatus() clears statusError (already null on first mount, so no cascading render) then resolves into setStatus from the network roundtrip.
    loadStatus();
  }, []);

  const handleToggle = (): void => {
    const nextOpen = !open;
    setOpen(nextOpen);
    setMode("menu");
    if (nextOpen && !status) loadStatus();
  };

  const onDone = (): void => {
    setMode("menu");
    loadStatus();
  };

  const enabled = status?.enabled === true;
  const statusText = status === null ? (statusError ? "Unavailable" : "…") : enabled ? "Enabled" : "Disabled";

  return (
    <div className={styles.provider} data-connected={enabled ? "true" : "false"}>
      <div className={styles.providerIcon} aria-hidden="true">
        <ShieldCheck size={16} />
      </div>
      <div className={styles.providerBody}>
        <div className={styles.providerName}>
          <span>Two-factor authentication</span>
          <span className={styles.providerStatus} data-state={enabled ? "connected" : "disconnected"}>
            {statusText}
          </span>
        </div>
        {enabled && status && (
          <div className={styles.providerMeta}>
            {status.remainingRecoveryCodes} recovery code{status.remainingRecoveryCodes === 1 ? "" : "s"} remaining
          </div>
        )}
        <div className={styles.providerActions}>
          {/* eslint-disable-next-line no-restricted-syntax -- muted disclosure toggle; matches PasswordAdvanced and GitHubAdvancedUnlink. */}
          <button
            type="button"
            className={styles.advancedToggle}
            data-open={open ? "true" : "false"}
            aria-expanded={open}
            onClick={handleToggle}
          >
            <span>{enabled ? "Manage 2FA" : "Set up 2FA"}</span>
            <ChevronDown size={11} aria-hidden="true" className={styles.advancedChevron} />
          </button>
          {open && (
            <div className={styles.advancedPanel}>
              {statusError && <span className={styles.confirmPrompt}>{statusError}</span>}
              {mode === "menu" && status && (
                <TwoFactorMenu
                  enabled={enabled}
                  onChoose={(next) => {
                    if (next !== "setup") {
                      setMode(next);
                      return;
                    }
                    void getRecentAuthStatus("ManageTwoFactor").then((satisfied) =>
                      setMode(satisfied ? "setup" : "reauth"),
                    );
                  }}
                />
              )}
              {mode === "reauth" && (
                <RecentAuthPanel
                  user={user}
                  action="ManageTwoFactor"
                  onCancel={() => setMode("menu")}
                  onVerified={() => setMode("setup")}
                />
              )}
              {mode === "setup" && <TwoFactorSetupFlow onCancel={() => setMode("menu")} onDone={onDone} />}
              {mode === "disable" && <TwoFactorDisableForm onCancel={() => setMode("menu")} onDone={onDone} />}
              {mode === "regenerate" && <TwoFactorRegenerateFlow onCancel={() => setMode("menu")} onDone={onDone} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TwoFactorMenu({
  enabled,
  onChoose,
}: {
  readonly enabled: boolean;
  readonly onChoose: (mode: "setup" | "disable" | "regenerate") => void;
}) {
  if (!enabled) {
    return (
      <div className={styles.confirmActions}>
        {/* eslint-disable-next-line no-restricted-syntax -- primary inline text-link inside disclosure. */}
        <button type="button" className={styles.linkActionPrimary} onClick={() => onChoose("setup")}>
          <span>Set up authenticator app</span>
        </button>
      </div>
    );
  }
  return (
    <div className={styles.confirmActions}>
      {/* eslint-disable-next-line no-restricted-syntax -- inline text-link action inside disclosure. */}
      <button type="button" className={styles.linkAction} onClick={() => onChoose("regenerate")}>
        <span>Regenerate recovery codes</span>
      </button>
      {/* eslint-disable-next-line no-restricted-syntax -- destructive inline text-link inside disclosure. */}
      <button type="button" className={styles.linkActionDanger} onClick={() => onChoose("disable")}>
        <span>Disable 2FA</span>
      </button>
    </div>
  );
}

function TwoFactorSetupFlow({ onCancel, onDone }: { readonly onCancel: () => void; readonly onDone: () => void }) {
  // Three-step mini-wizard: 1) fetch+display secret + QR, 2) verify code, 3) show recovery codes.
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setupTwoFactor()
      .then((res) => {
        if (!cancelled) setSetup(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSetupError(err instanceof Error ? err.message : "Could not start setup.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    setSubmitting(true);
    setCodeError(undefined);
    enableTwoFactor({ code })
      .then((res) => {
        setRecoveryCodes(res.recoveryCodes);
        toast.success("Two-factor authentication enabled");
      })
      .catch((err: unknown) => {
        const { fieldErrors, message } = unpackAuthError(err);
        const fieldError = fieldErrors.Code?.[0] ?? fieldErrors.code?.[0];
        if (fieldError) {
          setCodeError(fieldError);
        } else {
          toast.error(message);
        }
      })
      .finally(() => setSubmitting(false));
  };

  if (recoveryCodes) {
    return <RecoveryCodesPanel codes={recoveryCodes} onDone={onDone} />;
  }

  return (
    <div style={PANEL_STYLE}>
      {setupError && <span className={styles.confirmPrompt}>{setupError}</span>}
      {setup && (
        <>
          <span className={styles.confirmPrompt}>
            Scan this code in your authenticator app, or paste the secret manually.
          </span>
          <div style={QR_ROW_STYLE}>
            <div style={QR_BACKGROUND_STYLE}>
              <QRCodeSVG value={setup.otpAuthUri} size={96} />
            </div>
            <div style={SECRET_BOX_STYLE}>{setup.secret}</div>
          </div>
          <form onSubmit={submit} style={FORM_STYLE}>
            <FormField label="Enter the current 6-digit code" error={codeError}>
              <FormInput
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123 456"
                required
                disabled={submitting}
              />
            </FormField>
            <TwoFactorFormActions onCancel={onCancel} submitting={submitting} submitLabel="Enable 2FA" />
          </form>
        </>
      )}
    </div>
  );
}

function TwoFactorDisableForm({ onCancel, onDone }: { readonly onCancel: () => void; readonly onDone: () => void }) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [codeError, setCodeError] = useState<string | undefined>();

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    setSubmitting(true);
    setCodeError(undefined);
    disableTwoFactor({ code })
      .then(() => {
        toast.success("Two-factor authentication disabled");
        onDone();
      })
      .catch((err: unknown) => {
        const { fieldErrors, message } = unpackAuthError(err);
        const fieldError = fieldErrors.Code?.[0] ?? fieldErrors.code?.[0];
        if (fieldError) {
          setCodeError(fieldError);
        } else {
          toast.error(message);
        }
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <form onSubmit={submit} style={FORM_STYLE}>
      <span className={styles.confirmPrompt}>
        Disabling 2FA removes the authenticator pairing and invalidates remaining recovery codes.
      </span>
      <FormField label="Current authenticator code" error={codeError}>
        <FormInput
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123 456"
          required
          disabled={submitting}
        />
      </FormField>
      <TwoFactorFormActions onCancel={onCancel} submitting={submitting} submitLabel="Disable 2FA" danger />
    </form>
  );
}

function TwoFactorRegenerateFlow({ onCancel, onDone }: { readonly onCancel: () => void; readonly onDone: () => void }) {
  const [codes, setCodes] = useState<readonly string[] | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [codeError, setCodeError] = useState<string | undefined>();

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    setSubmitting(true);
    setCodeError(undefined);
    regenerateRecoveryCodes({ code })
      .then((res) => {
        setCodes(res.recoveryCodes);
        toast.success("New recovery codes issued");
      })
      .catch((err: unknown) => {
        const { fieldErrors, message } = unpackAuthError(err);
        const fieldError = fieldErrors.Code?.[0] ?? fieldErrors.code?.[0];
        if (fieldError) {
          setCodeError(fieldError);
        } else {
          toast.error(message);
        }
      })
      .finally(() => setSubmitting(false));
  };

  if (codes) {
    return <RecoveryCodesPanel codes={codes} onDone={onDone} />;
  }

  return (
    <form onSubmit={submit} style={FORM_STYLE}>
      <span className={styles.confirmPrompt}>
        Generating new codes invalidates any unused codes from the previous batch. Confirm with your current
        authenticator code so a hijacked session alone can&rsquo;t silently rotate them.
      </span>
      <FormField label="Current authenticator code" error={codeError}>
        <FormInput
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123 456"
          required
          disabled={submitting}
        />
      </FormField>
      <TwoFactorFormActions onCancel={onCancel} submitting={submitting} submitLabel="Regenerate codes" />
    </form>
  );
}

function RecoveryCodesPanel({ codes, onDone }: { readonly codes: readonly string[]; readonly onDone: () => void }) {
  return (
    <div style={PANEL_STYLE}>
      <span className={styles.confirmPrompt}>
        Save these single-use codes somewhere safe. They are shown only once — refresh closes this view.
      </span>
      <ul style={RECOVERY_LIST_STYLE}>
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div style={ACTIONS_STYLE}>
        {/* eslint-disable-next-line no-restricted-syntax -- inline copy-to-clipboard affordance inside disclosure. */}
        <button
          type="button"
          className={styles.linkAction}
          onClick={() => {
            void navigator.clipboard
              .writeText(codes.join("\n"))
              .then(() => toast.success("Recovery codes copied"))
              .catch(() => toast.error("Copy failed"));
          }}
        >
          <span>Copy all</span>
        </button>
        {/* eslint-disable-next-line no-restricted-syntax -- inline done affordance inside disclosure. */}
        <button type="button" className={styles.linkActionPrimary} onClick={onDone}>
          <span>I&apos;ve saved them</span>
        </button>
      </div>
    </div>
  );
}

function TwoFactorFormActions({
  onCancel,
  submitting,
  submitLabel,
  danger,
}: {
  readonly onCancel: () => void;
  readonly submitting: boolean;
  readonly submitLabel: string;
  readonly danger?: boolean;
}) {
  return (
    <div style={ACTIONS_STYLE}>
      {/* eslint-disable-next-line no-restricted-syntax -- inline cancel inside disclosure. */}
      <button type="button" className={styles.linkAction} onClick={onCancel} disabled={submitting}>
        <span>Cancel</span>
      </button>
      {/* eslint-disable-next-line no-restricted-syntax -- inline submit inside disclosure. */}
      <button
        type="submit"
        className={danger ? styles.linkActionDanger : styles.linkActionPrimary}
        disabled={submitting}
      >
        <span>{submitting ? "Saving…" : submitLabel}</span>
      </button>
    </div>
  );
}

function unpackAuthError(err: unknown): {
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
  readonly message: string;
} {
  if (err instanceof AuthApiError) {
    return { fieldErrors: err.fieldErrors ?? {}, message: err.message };
  }
  return { fieldErrors: {}, message: err instanceof Error ? err.message : "Request failed." };
}

const PANEL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  marginTop: 4,
};

const QR_ROW_STYLE: CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  padding: 8,
  borderRadius: 4,
  background: "var(--surface-2, rgba(255, 255, 255, 0.04))",
};

const QR_BACKGROUND_STYLE: CSSProperties = {
  padding: 6,
  background: "#fff",
  borderRadius: 4,
  flexShrink: 0,
};

const SECRET_BOX_STYLE: CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "var(--type-eyebrow-size)",
  wordBreak: "break-all",
  color: "var(--text-muted)",
};

const RECOVERY_LIST_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 4,
  padding: 8,
  margin: 0,
  listStyle: "none",
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "var(--type-eyebrow-size)",
  borderRadius: 4,
  background: "var(--surface-2, rgba(255, 255, 255, 0.04))",
};

const FORM_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const ACTIONS_STYLE: CSSProperties = {
  display: "flex",
  gap: 12,
  justifyContent: "flex-end",
  marginTop: 4,
};
