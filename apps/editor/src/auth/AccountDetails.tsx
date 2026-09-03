import { useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { AlertCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button, FormField, FormInput } from "@viritura/ui";
import { beginGitHubLogin } from "../github/api";
import type { GitHubAccountState } from "../github/useGitHubAccount";
import {
  changeVirituraPassword,
  getRecentAuthStatus,
  getVirituraAuthBaseUrl,
  removeVirituraPassword,
  setVirituraPassword,
} from "./api";
import type { VirituraUser } from "./api";
import type { VirituraAccountState } from "./useVirituraAccount";
import { TwoFactorRow } from "./TwoFactorSection";
import { getInitials, isPlaceholderEmail, pickAvatarUrl } from "./accountIdentity";
import { PASSWORD_FORM_STYLE, unpackAuthError } from "./accountFormShared";
import { PasswordFormActions } from "./PasswordFormActions";
import { RecentAuthPanel } from "./RecentAuthPanel";
import { DeleteAccountRow, DisplayNameRow, EmailRow } from "./accountManagementRows";
import { GitHubAdvancedUnlink, GoogleAdvancedUnlink } from "./accountUnlinkPanels";
import { useAuthCapabilities } from "./useAuthCapabilities";
import { AccountSettingsRow } from "./AccountSettingsRow";
import styles from "./AccountButton.module.css";

export interface AccountDetailsProps {
  readonly account: VirituraAccountState;
  readonly github: GitHubAccountState;
  readonly user: VirituraUser;
}

/**
 * Signed-in account settings surface.
 *
 * Renders: persona header (avatar + name + email), optional error notice,
 * configured provider rows, security controls, and sign-out actions.
 */
export function AccountDetails({ account, github, user }: AccountDetailsProps) {
  const displayLabel = user.displayName?.trim() || user.email;
  const avatarUrl = pickAvatarUrl(user, github);
  const initials = getInitials(user);
  const capabilities = useAuthCapabilities(true);
  const hasGitHubLogin = user.externalLogins.some((login) => login.provider === "GitHub");
  const hasGoogleLogin = user.externalLogins.some((login) => login.provider === "Google");
  const showGitHub = capabilities?.gitHubLoginEnabled === true || hasGitHubLogin;
  const showGoogle = capabilities?.googleLoginEnabled === true || hasGoogleLogin;

  return (
    <>
      <header className={styles.identity}>
        <AvatarBubble avatarUrl={avatarUrl} initials={initials} size={36} />
        <div className={styles.identityText}>
          <div className={styles.identityName}>{displayLabel}</div>
          {!isPlaceholderEmail(user.email) && <div className={styles.identityEmail}>{user.email}</div>}
        </div>
      </header>

      {account.status === "error" && (
        <div className={styles.notice}>
          <AlertCircle size={14} aria-hidden="true" />
          <span>{account.error ?? "Account status is unavailable."}</span>
        </div>
      )}

      {(showGitHub || showGoogle) && (
        <section className={styles.providers} aria-label="Connected accounts">
          <div className={styles.providersLabel}>Connected accounts</div>
          {showGitHub && <GitHubRow github={github} user={user} />}
          {showGoogle && <GoogleRow user={user} account={account} />}
        </section>
      )}

      <section className={styles.providers} aria-label="Sign-in security">
        <div className={styles.providersLabel}>Sign-in security</div>
        <PasswordRow account={account} user={user} />
        <TwoFactorRow user={user} />
      </section>

      <section className={styles.providers} aria-label="Account">
        <div className={styles.providersLabel}>Account</div>
        <DisplayNameRow account={account} user={user} />
        <EmailRow user={user} />
      </section>

      <section className={styles.providers} aria-label="Sessions">
        <div className={styles.providersLabel}>Sessions</div>
        <AccountSettingsRow
          label="Current session"
          description="Sign out on this browser."
          action={
            <Button
              onClick={() => {
                void account
                  .signOut()
                  .then(() => toast.success("Signed out"))
                  .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Sign-out failed"));
              }}
            >
              Sign out
            </Button>
          }
        />
        <SignOutEverywhereRow account={account} />
      </section>

      <section className={styles.providers} aria-label="Danger zone">
        <div className={styles.providersLabel}>Danger zone</div>
        <DeleteAccountRow account={account} user={user} />
      </section>
    </>
  );
}

function SignOutEverywhereRow({ account }: { readonly account: VirituraAccountState }) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);

  if (!confirming) {
    return (
      <AccountSettingsRow
        label="Other sessions"
        description="Sign out browsers and devices when their session is next checked, within 30 minutes."
        action={<Button onClick={() => setConfirming(true)}>Sign out everywhere…</Button>}
      />
    );
  }

  const handle = () => {
    setWorking(true);
    void account
      .signOutEverywhere()
      .then(() => toast.success("Signed out everywhere"))
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Sign-out failed"))
      .finally(() => setWorking(false));
  };

  return (
    <AccountSettingsRow
      label="Other sessions"
      description="This will invalidate every other signed-in browser and device."
      action={
        <Button size="sm" variant="ghost" disabled={working} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      }
      details={
        <div className={styles.confirmActions}>
          <Button size="sm" variant="danger" disabled={working} onClick={handle}>
            {working ? "Signing out…" : "Confirm sign out everywhere"}
          </Button>
        </div>
      }
    />
  );
}

interface ProviderRowProps {
  readonly providerName: string;
  readonly description: string;
  readonly action: ReactNode;
  readonly details?: ReactNode;
}

function ProviderRow({ providerName, description, action, details }: ProviderRowProps) {
  return <AccountSettingsRow label={providerName} description={description} action={action} details={details} />;
}

function getGitHubConnectionDescription(connected: boolean, viewerLogin: string | null): string {
  if (!connected) return "Not connected.";
  if (viewerLogin) return `Connected as @${viewerLogin}`;
  return "Connected to this account.";
}

function GitHubRow({ github, user }: { readonly github: GitHubAccountState; readonly user: VirituraUser }) {
  const githubConnected = github.session?.connected === true && Boolean(github.session.viewer);
  const linkedViaIdentity = user.externalLogins.some((l) => l.provider === "GitHub");
  const connected = githubConnected || linkedViaIdentity;
  const installation = github.session?.installation ?? null;
  const installUrl = installation?.htmlUrl ?? github.app?.installUrl ?? null;
  const configured = github.app?.configured !== false;
  const loading = github.status === "loading";
  const viewerLogin = github.session?.viewer?.login ?? null;
  const [reauthOpen, setReauthOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <ProviderRow
      providerName="GitHub"
      description={getGitHubConnectionDescription(connected, viewerLogin)}
      action={
        connected ? (
          <Button onClick={() => setManageOpen((open) => !open)} aria-expanded={manageOpen}>
            Manage…
          </Button>
        ) : (
          <Button
            disabled={!configured || loading}
            onClick={() => {
              void getRecentAuthStatus("LinkLogin").then((satisfied) => {
                if (satisfied) beginGitHubLogin(undefined, "activity");
                else setReauthOpen(true);
              });
            }}
          >
            {loading ? "Checking…" : configured ? "Connect" : "Unavailable"}
          </Button>
        )
      }
      details={
        connected && manageOpen ? (
          <div className={styles.accountManagementActions}>
            {installUrl && (
              <a className={styles.linkAction} href={installUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={12} aria-hidden="true" />
                <span>{installation?.installed ? "Manage app" : "Install app"}</span>
              </a>
            )}
            <GitHubAdvancedUnlink github={github} viewerLogin={viewerLogin} user={user} />
          </div>
        ) : reauthOpen ? (
          <RecentAuthPanel
            user={user}
            action="LinkLogin"
            onCancel={() => setReauthOpen(false)}
            onVerified={() => beginGitHubLogin(undefined, "activity")}
          />
        ) : undefined
      }
    />
  );
}

function GoogleRow({ user, account }: { readonly user: VirituraUser; readonly account: VirituraAccountState }) {
  const link = user.externalLogins.find((l) => l.provider === "Google");
  const connected = Boolean(link);
  const startUrl = `${getVirituraAuthBaseUrl()}/auth/external/google/start?returnTo=${encodeURIComponent(getCurrentLocation())}`;
  const [reauthOpen, setReauthOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <ProviderRow
      providerName="Google"
      description={connected ? (link?.displayName ?? "Connected to this account.") : "Not connected."}
      action={
        connected ? (
          <Button onClick={() => setManageOpen((open) => !open)} aria-expanded={manageOpen}>
            Manage…
          </Button>
        ) : (
          <Button
            onClick={() => {
              void getRecentAuthStatus("LinkLogin").then((satisfied) => {
                if (satisfied) window.location.assign(startUrl);
                else setReauthOpen(true);
              });
            }}
          >
            Connect
          </Button>
        )
      }
      details={
        connected && link && manageOpen ? (
          <GoogleAdvancedUnlink
            account={account}
            providerKey={link.providerKey}
            displayName={link.displayName}
            user={user}
          />
        ) : reauthOpen ? (
          <RecentAuthPanel
            user={user}
            action="LinkLogin"
            onCancel={() => setReauthOpen(false)}
            onVerified={() => window.location.assign(startUrl)}
          />
        ) : undefined
      }
    />
  );
}

/**
 * Password management row. Mirrors the provider-row pattern but for the
 * account's local password credential. Three operations are exposed under an
 * "Advanced" disclosure so the inline form doesn't crowd the popover by
 * default:
 *
 * - Change (when a password is set): re-auth gate + new password.
 * - Set (when OAuth-only): just new password — the live cookie session is the
 *   gate. Common path for users who started via GitHub/Google and now want a
 *   password fallback.
 * - Remove (when a password AND ≥1 external login exist): symmetric to unlink.
 *   Re-auth gated and behind a confirm step.
 */
function PasswordRow({ account, user }: { readonly account: VirituraAccountState; readonly user: VirituraUser }) {
  const hasPassword = user.hasPassword;
  const canRemove = hasPassword && user.externalLogins.length > 0;

  return <PasswordAdvanced account={account} user={user} hasPassword={hasPassword} canRemove={canRemove} />;
}

type PasswordMode = "menu" | "change" | "set-auth" | "set" | "remove";

function PasswordAdvanced({
  account,
  user,
  hasPassword,
  canRemove,
}: {
  readonly account: VirituraAccountState;
  readonly user: VirituraUser;
  readonly hasPassword: boolean;
  readonly canRemove: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PasswordMode>("menu");

  const toggleLabel = hasPassword ? "Manage password" : "Set password";

  return (
    <AccountSettingsRow
      label="Password"
      description={hasPassword ? "A password is configured for this account." : "No password is configured."}
      action={
        <Button
          aria-expanded={open}
          onClick={() => {
            setOpen((prev) => !prev);
            setMode("menu");
          }}
        >
          {toggleLabel}…
        </Button>
      }
      details={
        open ? (
          <>
            {mode === "menu" && (
              <PasswordMenu
                hasPassword={hasPassword}
                canRemove={canRemove}
                onChoose={(next) => {
                  if (next !== "set") {
                    setMode(next);
                    return;
                  }
                  void getRecentAuthStatus("SetPassword").then((satisfied) => setMode(satisfied ? "set" : "set-auth"));
                }}
              />
            )}
            {mode === "set-auth" && (
              <RecentAuthPanel
                user={user}
                action="SetPassword"
                onCancel={() => setMode("menu")}
                onVerified={() => setMode("set")}
              />
            )}
            {mode === "change" && (
              <ChangePasswordForm
                onCancel={() => setMode("menu")}
                onDone={() => {
                  setMode("menu");
                  setOpen(false);
                  void account.refresh();
                }}
              />
            )}
            {mode === "set" && (
              <SetPasswordForm
                onCancel={() => setMode("menu")}
                onDone={() => {
                  setMode("menu");
                  setOpen(false);
                  void account.refresh();
                }}
              />
            )}
            {mode === "remove" && (
              <RemovePasswordForm
                onCancel={() => setMode("menu")}
                onDone={() => {
                  setMode("menu");
                  setOpen(false);
                  void account.refresh();
                }}
              />
            )}
          </>
        ) : undefined
      }
    />
  );
}

function PasswordMenu({
  hasPassword,
  canRemove,
  onChoose,
}: {
  readonly hasPassword: boolean;
  readonly canRemove: boolean;
  readonly onChoose: (mode: PasswordMode) => void;
}) {
  return (
    <div className={styles.confirmActions}>
      {hasPassword ? (
        <>
          {/* eslint-disable-next-line no-restricted-syntax -- inline text-link action inside disclosure; @viritura/ui Button chrome would dominate. */}
          <button type="button" className={styles.linkAction} onClick={() => onChoose("change")}>
            <span>Change password</span>
          </button>
          {canRemove && (
            /* eslint-disable-next-line no-restricted-syntax -- destructive inline text-link inside disclosure. */
            <button type="button" className={styles.linkActionDanger} onClick={() => onChoose("remove")}>
              <span>Remove password</span>
            </button>
          )}
        </>
      ) : (
        /* eslint-disable-next-line no-restricted-syntax -- primary inline text-link inside disclosure. */
        <button type="button" className={styles.linkActionPrimary} onClick={() => onChoose("set")}>
          <span>Set a password</span>
        </button>
      )}
    </div>
  );
}

function ChangePasswordForm({ onCancel, onDone }: { readonly onCancel: () => void; readonly onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ current?: string; next?: string }>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});
    changeVirituraPassword({ currentPassword: current, newPassword: next })
      .then(() => {
        toast.success("Password updated");
        onDone();
      })
      .catch((err: unknown) => {
        const { fieldErrors, message } = unpackAuthError(err);
        setErrors({
          current: fieldErrors.currentPassword?.[0],
          next: fieldErrors.newPassword?.[0],
        });
        if (!fieldErrors.currentPassword && !fieldErrors.newPassword) {
          toast.error(message);
        }
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <form onSubmit={submit} style={PASSWORD_FORM_STYLE}>
      <FormField label="Current password" error={errors.current}>
        <FormInput
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          disabled={submitting}
        />
      </FormField>
      <FormField label="New password (at least 12 characters)" error={errors.next}>
        <FormInput
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          minLength={12}
          required
          disabled={submitting}
        />
      </FormField>
      <PasswordFormActions onCancel={onCancel} submitting={submitting} submitLabel="Update password" />
    </form>
  );
}

function SetPasswordForm({ onCancel, onDone }: { readonly onCancel: () => void; readonly onDone: () => void }) {
  const [next, setNext] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(undefined);
    setVirituraPassword({ newPassword: next })
      .then(() => {
        toast.success("Password set");
        onDone();
      })
      .catch((err: unknown) => {
        const { fieldErrors, message } = unpackAuthError(err);
        const fieldError = fieldErrors.newPassword?.[0];
        if (fieldError) {
          setError(fieldError);
        } else {
          toast.error(message);
        }
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <form onSubmit={submit} style={PASSWORD_FORM_STYLE}>
      <FormField label="New password (at least 12 characters)" error={error}>
        <FormInput
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          minLength={12}
          required
          disabled={submitting}
        />
      </FormField>
      <PasswordFormActions onCancel={onCancel} submitting={submitting} submitLabel="Set password" />
    </form>
  );
}

function RemovePasswordForm({ onCancel, onDone }: { readonly onCancel: () => void; readonly onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(undefined);
    removeVirituraPassword({ currentPassword: current })
      .then(() => {
        toast.success("Password removed");
        onDone();
      })
      .catch((err: unknown) => {
        const { fieldErrors, message } = unpackAuthError(err);
        const fieldError = fieldErrors.currentPassword?.[0];
        if (fieldError) {
          setError(fieldError);
        } else {
          toast.error(message);
        }
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <form onSubmit={submit} style={PASSWORD_FORM_STYLE}>
      <span className={styles.confirmPrompt}>
        Removing the password means you’ll need to sign in via a linked provider. You can set a new password anytime.
      </span>
      <FormField label="Confirm current password" error={error}>
        <FormInput
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          disabled={submitting}
        />
      </FormField>
      <PasswordFormActions onCancel={onCancel} submitting={submitting} submitLabel="Remove password" danger />
    </form>
  );
}

export function AvatarBubble({
  avatarUrl,
  initials,
  size,
}: {
  readonly avatarUrl: string | null;
  readonly initials: string;
  readonly size: number;
}) {
  // Dynamic per-call size — must be inline style (CSS modules can't parameterize length values per render).
  // Bound to a named variable so it isn't an object literal at the JSX site.
  const avatarStyle = useMemo<CSSProperties>(
    () => ({ width: size, height: size, fontSize: Math.round(size * 0.42) }),
    [size],
  );
  return (
    <span className={styles.avatar} style={avatarStyle}>
      {avatarUrl ? (
        // crossOrigin + referrerPolicy let cross-origin avatars (Google's
        // lh3.googleusercontent.com in particular) pass the editor's
        // Cross-Origin-Embedder-Policy: require-corp gate. Google serves
        // Access-Control-Allow-Origin: * but does NOT send a CORP header, so
        // without crossOrigin the browser blocks the response under COEP.
        <img src={avatarUrl} alt="" draggable={false} crossOrigin="anonymous" referrerPolicy="no-referrer" />
      ) : (
        <span>{initials}</span>
      )}
    </span>
  );
}

function getCurrentLocation(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`;
}
