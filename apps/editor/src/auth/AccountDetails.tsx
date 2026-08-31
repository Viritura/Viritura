import { useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { AlertCircle, ChevronDown, ExternalLink, KeyRound, LogOut } from "lucide-react";
import { toast } from "sonner";
import { FormField, FormInput } from "@viritura/ui";
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
import styles from "./AccountButton.module.css";
import { GitHubMark } from "../brand/GitHubMark";

export interface AccountDetailsProps {
  readonly account: VirituraAccountState;
  readonly github: GitHubAccountState;
  readonly user: VirituraUser;
}

/**
 * Body of the signed-in account popover/disclosure. Shared between the
 * activity-bar `AccountButton` and the StartCenter signed-in panel so the
 * sign-out + provider-management surface stays consistent across the app.
 *
 * Renders: persona header (avatar + name + email), optional error notice,
 * per-provider rows (GitHub + Google), and a sign-out button.
 */
export function AccountDetails({ account, github, user }: AccountDetailsProps) {
  const displayLabel = user.displayName?.trim() || user.email;
  const avatarUrl = pickAvatarUrl(user, github);
  const initials = getInitials(user);
  const capabilities = useAuthCapabilities(true);

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

      <section className={styles.providers} aria-label="Connected accounts">
        <div className={styles.providersLabel}>Connected accounts</div>
        <GitHubRow github={github} user={user} />
        <GoogleRow user={user} account={account} configured={capabilities?.googleLoginEnabled === true} />
      </section>

      <section className={styles.providers} aria-label="Sign-in security">
        <div className={styles.providersLabel}>Sign-in security</div>
        <PasswordRow account={account} user={user} />
        <TwoFactorRow user={user} />
      </section>

      <section className={styles.providers} aria-label="Account">
        <div className={styles.providersLabel}>Account</div>
        <DisplayNameRow account={account} user={user} />
        <EmailRow user={user} />
        <DeleteAccountRow account={account} user={user} />
      </section>

      <div className={styles.divider} role="separator" />

      {/* eslint-disable-next-line no-restricted-syntax -- bespoke icon+label popover footer action with custom hover treatment; @viritura/ui Button doesn't model this row pattern. */}
      <button
        type="button"
        className={styles.signOut}
        onClick={() => {
          void account
            .signOut()
            .then(() => toast.success("Signed out"))
            .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Sign-out failed"));
        }}
      >
        <LogOut size={15} aria-hidden="true" />
        <span>Sign out</span>
      </button>
      <SignOutEverywhereLink account={account} />
    </>
  );
}

function SignOutEverywhereLink({ account }: { readonly account: VirituraAccountState }) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);

  if (!confirming) {
    return (
      /* eslint-disable-next-line no-restricted-syntax -- secondary text-link under the primary sign-out button. */
      <button type="button" className={styles.signOutEverywhere} onClick={() => setConfirming(true)}>
        Sign out of all devices
      </button>
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
    <div className={styles.signOutEverywhereConfirm}>
      <span className={styles.confirmPrompt}>
        Other sessions get kicked the next time their cookie is re-checked (usually within 30 minutes).
      </span>
      <div className={styles.confirmActions}>
        {/* eslint-disable-next-line no-restricted-syntax -- inline cancel matches the unlink disclosure pattern. */}
        <button type="button" className={styles.linkAction} disabled={working} onClick={() => setConfirming(false)}>
          <span>Cancel</span>
        </button>
        {/* eslint-disable-next-line no-restricted-syntax -- destructive inline confirm matches the unlink disclosure pattern. */}
        <button type="button" className={styles.linkActionDanger} disabled={working} onClick={handle}>
          <span>{working ? "Signing out…" : "Sign out everywhere"}</span>
        </button>
      </div>
    </div>
  );
}

interface ProviderRowProps {
  readonly icon: ReactNode;
  readonly providerName: string;
  readonly accountLabel: string;
  readonly statusText: string;
  readonly connected: boolean;
  readonly children: ReactNode;
}

function ProviderRow({ icon, providerName, accountLabel, statusText, connected, children }: ProviderRowProps) {
  return (
    <div className={styles.provider} data-connected={connected ? "true" : "false"}>
      <div className={styles.providerIcon} aria-hidden="true">
        {icon}
      </div>
      <div className={styles.providerBody}>
        <div className={styles.providerName}>
          <span>{providerName}</span>
          <span className={styles.providerStatus} data-state={connected ? "connected" : "disconnected"}>
            {statusText}
          </span>
        </div>
        {connected && <div className={styles.providerMeta}>{accountLabel}</div>}
        <div className={styles.providerActions}>{children}</div>
      </div>
    </div>
  );
}

function getGitHubStatusText(opts: {
  configured: boolean;
  loading: boolean;
  connected: boolean;
  canCreateRepositories: boolean;
}): string {
  if (!opts.configured) return "Not configured";
  if (opts.loading) return "Checking…";
  if (!opts.connected) return "Not connected";
  return opts.canCreateRepositories ? "Installed" : "Connected";
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

  const statusText = getGitHubStatusText({
    configured,
    loading,
    connected,
    canCreateRepositories: installation?.canCreateRepositories === true,
  });

  return (
    <ProviderRow
      icon={<GitHubMark size={16} />}
      providerName="GitHub"
      accountLabel={viewerLogin ? `@${viewerLogin}` : "Linked"}
      statusText={statusText}
      connected={connected}
    >
      {connected ? (
        <>
          {installUrl && (
            <a className={styles.linkAction} href={installUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={12} aria-hidden="true" />
              <span>{installation?.installed ? "Manage app" : "Install app"}</span>
            </a>
          )}
          <GitHubAdvancedUnlink github={github} viewerLogin={viewerLogin} user={user} />
        </>
      ) : (
        <>
          {/* eslint-disable-next-line no-restricted-syntax -- inline provider-link CTA. */}
          <button
            type="button"
            className={styles.linkActionPrimary}
            disabled={!configured || loading}
            onClick={() => {
              void getRecentAuthStatus("LinkLogin").then((satisfied) => {
                if (satisfied) beginGitHubLogin(undefined, "activity");
                else setReauthOpen(true);
              });
            }}
          >
            <span>{configured ? "Connect GitHub" : "Unavailable"}</span>
          </button>
          {reauthOpen && (
            <RecentAuthPanel
              user={user}
              action="LinkLogin"
              onCancel={() => setReauthOpen(false)}
              onVerified={() => beginGitHubLogin(undefined, "activity")}
            />
          )}
        </>
      )}
    </ProviderRow>
  );
}

function GoogleRow({
  user,
  account,
  configured,
}: {
  readonly user: VirituraUser;
  readonly account: VirituraAccountState;
  readonly configured: boolean;
}) {
  const link = user.externalLogins.find((l) => l.provider === "Google");
  const connected = Boolean(link);
  const startUrl = `${getVirituraAuthBaseUrl()}/auth/external/google/start?returnTo=${encodeURIComponent(getCurrentLocation())}`;
  const [reauthOpen, setReauthOpen] = useState(false);

  return (
    <ProviderRow
      icon={<GoogleIcon />}
      providerName="Google"
      accountLabel={link?.displayName ?? "Linked"}
      statusText={!configured ? "Not configured" : connected ? "Connected" : "Not connected"}
      connected={connected}
    >
      {connected && link ? (
        <GoogleAdvancedUnlink
          account={account}
          providerKey={link.providerKey}
          displayName={link.displayName}
          user={user}
        />
      ) : configured ? (
        <>
          {/* eslint-disable-next-line no-restricted-syntax -- inline provider-link CTA. */}
          <button
            type="button"
            className={styles.linkActionPrimary}
            onClick={() => {
              void getRecentAuthStatus("LinkLogin").then((satisfied) => {
                if (satisfied) window.location.assign(startUrl);
                else setReauthOpen(true);
              });
            }}
          >
            <span>Connect Google</span>
          </button>
          {reauthOpen && (
            <RecentAuthPanel
              user={user}
              action="LinkLogin"
              onCancel={() => setReauthOpen(false)}
              onVerified={() => window.location.assign(startUrl)}
            />
          )}
        </>
      ) : (
        <span className={styles.linkActionPrimary} aria-disabled="true">
          Unavailable
        </span>
      )}
    </ProviderRow>
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

  return (
    <div className={styles.provider} data-connected={hasPassword ? "true" : "false"}>
      <div className={styles.providerIcon} aria-hidden="true">
        <KeyRound size={16} />
      </div>
      <div className={styles.providerBody}>
        <div className={styles.providerName}>
          <span>Password</span>
          <span className={styles.providerStatus} data-state={hasPassword ? "connected" : "disconnected"}>
            {hasPassword ? "Set" : "Not set"}
          </span>
        </div>
        <div className={styles.providerActions}>
          <PasswordAdvanced account={account} user={user} hasPassword={hasPassword} canRemove={canRemove} />
        </div>
      </div>
    </div>
  );
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

  const toggleLabel = hasPassword ? "Manage password" : "Advanced";

  return (
    <>
      {/* eslint-disable-next-line no-restricted-syntax -- muted disclosure toggle; matches GitHubAdvancedUnlink's text-link affordance. */}
      <button
        type="button"
        className={styles.advancedToggle}
        data-open={open ? "true" : "false"}
        aria-expanded={open}
        onClick={() => {
          setOpen((prev) => !prev);
          setMode("menu");
        }}
      >
        <span>{toggleLabel}</span>
        <ChevronDown size={11} aria-hidden="true" className={styles.advancedChevron} />
      </button>
      {open && (
        <div className={styles.advancedPanel}>
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
        </div>
      )}
    </>
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

function GoogleIcon() {
  // Inline brand glyph (4-color G) — Google's brand guidelines allow this rendering for sign-in UI.
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

function getCurrentLocation(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`;
}
