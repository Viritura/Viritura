/**
 * StartCenter — launch screen shown on app boot.
 *
 * Mirrors the "Hub" / "Start Center" pattern of Sibelius and Dorico:
 *  • Lists recent scores (folder-backed and standalone) from a single
 *    unified `RecentScore[]` source (see `store/recentScores.ts`).
 *  • Provides primary project actions plus secondary standalone MNX opening.
 *  • Lets the user "Start blank" or suppress the dialog on future boots.
 *
 * Project creation and opening are primary because a project folder owns the
 * score, history, media, and future exports. Standalone MNX opening remains an
 * explicit interoperability path.
 *
 * Selecting a recent item triggers the FSA permission re-prompt via the
 * caller (which invokes `ensureScorePermission()`).
 *
 * The dialog is render-only — all side effects (load, permission grant,
 * forget) are delegated through callbacks supplied by the parent.
 */
import { useMemo, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  Clock3,
  Download,
  File,
  FilePlus2,
  FileUp,
  FolderGit2,
  FolderOpen,
  Loader2,
  LogIn,
  Music,
  UserRound,
  X,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogActions,
  ActionTile,
  Checkbox,
  FormField,
  FolderPickerInput,
  FormInput,
  IconButton,
  ListRow,
  VirituraLogo,
} from "@viritura/ui";
import * as RadixDialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import styles from "./StartCenter.module.css";
import type { RecentScore } from "../store/recentScores";
import { useGitHubAccount, type GitHubAccountState } from "../github/useGitHubAccount";
import { AccountMenu, type VirituraAccountState } from "../auth";
import accountPopoverStyles from "../auth/AccountButton.module.css";
import { SCORE_SAMPLES, type ScoreSample } from "../scoreSamples";
import { getProjectFolderNameError } from "../app/projectFolder";
import type { StartCenterView } from "../store/onboardingStore";

export interface StartCenterProps {
  open: boolean;
  /** View to show when the dialog is opened by an external command. */
  initialView?: StartCenterView;
  /** Recent scores (folder + file, sorted newest first by the parent). */
  recentScores: RecentScore[];
  /** GitHub account state used to enrich the launch screen when available. */
  githubAccount?: GitHubAccountState;
  /** Viritura account state. When present, drives the consolidated sign-in panel. */
  account?: VirituraAccountState;
  /** Whether `showDirectoryPicker` is supported in this browser. */
  projectsSupported: boolean;
  /** Whether the "Don't show on launch" preference is currently checked. */
  suppressOnLaunch: boolean;
  onSuppressOnLaunchChange: (value: boolean) => void;
  onChooseProjectLocation: () => Promise<FileSystemDirectoryHandle | null>;
  onSignIn: () => void;
  onOpenAccountSettings: () => void;
  onNewScore: (projectName: string, parentHandle: FileSystemDirectoryHandle) => Promise<boolean>;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  /**
   * Import a score from another format. Wired to the `@viritura/musicxml`
   * converter (`convertMxlToMnx` / `convertMusicXmlToMnx`): the picked file is
   * converted to MNX and loaded into the editor. If omitted, the tile is
   * disabled.
   */
  onImport?: () => void;
  onSelectRecent: (entry: RecentScore) => void;
  onForgetRecent: (id: string) => void;
  /** Load one of the bundled sample scores. */
  onSelectSample: (sample: ScoreSample) => void;
  /** Called when the dialog is dismissed (Esc / overlay click). */
  onClose: () => void;
}

interface Group {
  label: string;
  items: RecentScore[];
}

export function StartCenter(props: StartCenterProps) {
  const {
    open,
    initialView = "home",
    recentScores,
    githubAccount,
    account,
    projectsSupported,
    suppressOnLaunch,
    onSuppressOnLaunchChange,
    onChooseProjectLocation,
    onSignIn,
    onOpenAccountSettings,
    onNewScore,
    onOpenFile,
    onOpenFolder,
    onImport,
    onSelectRecent,
    onForgetRecent,
    onSelectSample,
    onClose,
  } = props;
  const [view, setView] = useState<StartCenterView>(initialView);

  const handleClose = () => {
    setView("home");
    onClose();
  };

  /**
   * Bucket recents into time groups (Today / Yesterday / Last 7 days /
   * Older) for visual scanability — the same pattern Finder/Explorer use
   * for downloads. Empty groups are omitted.
   */
  const groups = useMemo<Group[]>(() => {
    const items = [...recentScores].sort((a, b) => b.lastOpened - a.lastOpened);
    // eslint-disable-next-line react-hooks/purity -- seeds timestamp on mount only; subsequent renders read stable state
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const today: RecentScore[] = [];
    const yesterday: RecentScore[] = [];
    const week: RecentScore[] = [];
    const older: RecentScore[] = [];
    for (const item of items) {
      const age = now - item.lastOpened;
      if (age < dayMs && sameCalendarDay(item.lastOpened, now)) today.push(item);
      else if (age < 2 * dayMs && sameCalendarDay(item.lastOpened, now - dayMs)) yesterday.push(item);
      else if (age < 7 * dayMs) week.push(item);
      else older.push(item);
    }
    return [
      { label: "Today", items: today },
      { label: "Yesterday", items: yesterday },
      { label: "Earlier this week", items: week },
      { label: "Older", items: older },
    ].filter((g) => g.items.length > 0);
  }, [recentScores]);

  const totalCount = recentScores.length;

  return (
    <Dialog open={open} onClose={handleClose} size="xwide">
      <div className={styles.content ?? ""}>
        {/* Hide title visually but expose it for screen readers. */}
        <RadixDialog.Title style={srOnly}>Welcome to Viritura</RadixDialog.Title>

        <aside className={styles.sidebar}>
          <div className={styles.brand}>
            <VirituraLogo className={styles.logo} markSize={30} wordmarkWidth={126} />
          </div>

          <div className={styles.actions}>
            <ActionTile
              active={view === "home"}
              icon={<Clock3 size={18} />}
              title="Recent Projects"
              hint={totalCount > 0 ? "Continue where you left off" : "Start here"}
              onClick={() => setView("home")}
            />
            <ActionTile
              active={view === "newProject"}
              icon={<FilePlus2 size={18} />}
              title="New Project…"
              hint={projectsSupported ? "Create with version history" : "Unavailable in this browser"}
              onClick={() => setView("newProject")}
              disabled={!projectsSupported}
              tooltip={projectsSupported ? undefined : "Use Chrome, Edge, or the forthcoming desktop app"}
            />
            <ActionTile
              icon={<FolderOpen size={18} />}
              title="Open Project Folder…"
              hint={projectsSupported ? "Continue an existing project" : "Unavailable in this browser"}
              onClick={onOpenFolder}
              disabled={!projectsSupported}
              tooltip={projectsSupported ? undefined : "Use Chrome, Edge, or the forthcoming desktop app"}
            />
            <ActionTile
              icon={<Download size={18} />}
              title="Import…"
              hint={onImport ? "Convert MusicXML or MXL" : "Coming soon"}
              onClick={onImport}
              disabled={!onImport}
            />
          </div>

          {!projectsSupported && (
            <div className={styles.projectCapabilityNotice} role="status">
              <AlertCircle size={16} />
              <span>
                Project folders need the File System Access API. Open this app in Chrome or Edge, or use the Viritura
                desktop app when it becomes available.
              </span>
            </div>
          )}

          <div className={styles.sidebarFooter}>
            <StartCenterAccountControl
              account={account}
              github={githubAccount}
              onSignIn={onSignIn}
              onOpenAccountSettings={onOpenAccountSettings}
            />
            <Button variant="link-row" size="sm" bleedInline onClick={onOpenFile}>
              <FileUp className={styles.utilityIcon} size={14} />
              <span>Open MNX file</span>
            </Button>
            <Checkbox
              className={styles.launchPreference}
              label="Show on launch"
              checked={!suppressOnLaunch}
              onChange={(e) => onSuppressOnLaunchChange(!e.target.checked)}
            />
          </div>
        </aside>

        <main className={`${styles.main} ${view === "home" && totalCount === 0 ? styles.mainEmpty : ""}`}>
          <header className={styles.mainHeader}>
            <div className={styles.mainHeading}>
              {view === "newProject" && <h2 className={styles.mainTitle}>New Project</h2>}
              {view === "home" && totalCount > 0 && <h2 className={styles.mainTitle}>Recent projects</h2>}
            </div>
            <div className={styles.mainHeaderRight}>
              <IconButton className={styles.closeButton} tooltip="Close" onClick={handleClose} size="sm">
                <X size={16} />
              </IconButton>
            </div>
          </header>

          <div className={styles.mainContent}>
            {view === "newProject" ? (
              <NewProjectForm
                onChooseLocation={onChooseProjectLocation}
                onCreate={onNewScore}
                onCreated={() => setView("home")}
              />
            ) : (
              <>
                {totalCount === 0 ? (
                  <EmptyRecentState canCreate={projectsSupported} onCreate={() => setView("newProject")} />
                ) : (
                  <div className={styles.list} role="list">
                    {groups.map((group) => (
                      <div key={group.label}>
                        <div className={styles.groupLabel}>{group.label}</div>
                        {group.items.map((entry) => (
                          <ScoreRow key={entry.id} entry={entry} onSelect={onSelectRecent} onForget={onForgetRecent} />
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                <section className={styles.samples} aria-labelledby="start-center-samples">
                  <div id="start-center-samples" className={styles.groupLabel}>
                    Samples
                  </div>
                  <div className={styles.list}>
                    {SCORE_SAMPLES.map((sample) => (
                      <SampleRow key={sample.id} sample={sample} onSelect={onSelectSample} />
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        </main>
      </div>
    </Dialog>
  );
}

function NewProjectForm({
  onChooseLocation,
  onCreate,
  onCreated,
}: {
  onChooseLocation: () => Promise<FileSystemDirectoryHandle | null>;
  onCreate: (projectName: string, parentHandle: FileSystemDirectoryHandle) => Promise<boolean>;
  onCreated: () => void;
}) {
  const [projectName, setProjectName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [blurred, setBlurred] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [parentHandle, setParentHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [choosingLocation, setChoosingLocation] = useState(false);
  const [working, setWorking] = useState(false);
  const error = getProjectFolderNameError(projectName);
  const showError = Boolean(error) && (submitAttempted || (dirty && blurred));

  const create = async () => {
    setSubmitAttempted(true);
    if (error || !parentHandle || working) return;
    setWorking(true);
    try {
      if (await onCreate(projectName.trim(), parentHandle)) onCreated();
    } finally {
      setWorking(false);
    }
  };

  const chooseLocation = async () => {
    if (choosingLocation) return;
    setChoosingLocation(true);
    try {
      const selected = await onChooseLocation();
      if (selected) setParentHandle(selected);
    } finally {
      setChoosingLocation(false);
    }
  };

  const submit = () => {
    setSubmitAttempted(true);
    if (error) return;
    void (parentHandle ? create() : chooseLocation());
  };

  return (
    <form
      className={styles.projectFormShell}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <section className={styles.projectForm}>
        <p className={styles.projectFormIntro}>
          Create a project folder for your score and version history. Instruments and layouts come next.
        </p>
        <FormField
          label="Project name"
          error={showError ? (error ?? undefined) : undefined}
          className={styles.projectNameField}
        >
          <FormInput
            large
            autoFocus
            required
            value={projectName}
            placeholder="My Project"
            onInvalid={(event) => {
              event.preventDefault();
              setSubmitAttempted(true);
            }}
            onBlur={() => setBlurred(true)}
            onChange={(event) => {
              if (!dirty) setBlurred(false);
              setDirty(true);
              setProjectName(event.target.value);
            }}
          />
        </FormField>
        <FormField
          label="Project location"
          message={
            showError
              ? undefined
              : parentHandle
                ? `New folder: ${parentHandle.name} / ${projectName.trim() || "Project name"}`
                : "Choose the folder that should contain your new project."
          }
        >
          <FolderPickerInput
            large
            required
            value={parentHandle?.name}
            placeholder={choosingLocation ? "Choosing folder…" : "Choose a folder…"}
            disabled={working || choosingLocation}
            onClick={() => void chooseLocation()}
          />
        </FormField>
      </section>
      <DialogActions className={styles.projectDialogActions}>
        <Button
          type="submit"
          variant="primary"
          disabled={Boolean(error) || !parentHandle || working || choosingLocation}
        >
          {working && <Loader2 className={styles.accountSpin} size={16} />}
          {working ? "Creating project…" : "Create project"}
        </Button>
      </DialogActions>
    </form>
  );
}

function EmptyRecentState({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) {
  return (
    <section className={styles.emptyState}>
      <div className={styles.emptyStateBody}>
        <h3>Start a new project</h3>
        <p>Create a blank score, or open a sample below.</p>
        <Button variant="cta" onClick={onCreate} disabled={!canCreate}>
          Create project
        </Button>
      </div>
      <div className={styles.emptyStateFolio} aria-hidden="true">
        <span className={styles.emptyStateFolioBack} />
        <span className={styles.emptyStateFolioPage}>
          <img src="/reference-images/grand-staff.png" alt="" draggable={false} />
        </span>
      </div>
    </section>
  );
}

function SampleRow({ sample, onSelect }: { sample: ScoreSample; onSelect: (sample: ScoreSample) => void }) {
  return (
    <ListRow
      className={styles.item}
      onClick={() => onSelect(sample)}
      leading={
        <span className={styles.itemIconWrap}>
          <Music className={styles.itemIcon} aria-hidden="true" />
        </span>
      }
    >
      <span className={styles.itemBody}>
        <span className={styles.itemName}>{sample.title}</span>
        <span className={styles.itemMeta}>{sample.description}</span>
      </span>
    </ListRow>
  );
}

function StartCenterAccountControl({
  account,
  github,
  onSignIn,
  onOpenAccountSettings,
}: {
  readonly account?: VirituraAccountState;
  readonly github?: GitHubAccountState;
  readonly onSignIn: () => void;
  readonly onOpenAccountSettings: () => void;
}) {
  if (!account) return null;
  if (github) {
    return (
      <ConnectedStartCenterAccountControl
        account={account}
        github={github}
        onSignIn={onSignIn}
        onOpenAccountSettings={onOpenAccountSettings}
      />
    );
  }
  return (
    <StartCenterAccountWithGitHubHook
      account={account}
      onSignIn={onSignIn}
      onOpenAccountSettings={onOpenAccountSettings}
    />
  );
}

function StartCenterAccountWithGitHubHook({
  account,
  onSignIn,
  onOpenAccountSettings,
}: {
  readonly account: VirituraAccountState;
  readonly onSignIn: () => void;
  readonly onOpenAccountSettings: () => void;
}) {
  const github = useGitHubAccount();
  return (
    <ConnectedStartCenterAccountControl
      account={account}
      github={github}
      onSignIn={onSignIn}
      onOpenAccountSettings={onOpenAccountSettings}
    />
  );
}

function ConnectedStartCenterAccountControl({
  account,
  github,
  onSignIn,
  onOpenAccountSettings,
}: {
  readonly account: VirituraAccountState;
  readonly github: GitHubAccountState;
  readonly onSignIn: () => void;
  readonly onOpenAccountSettings: () => void;
}) {
  const user = account.user;
  const loading = account.status === "loading";

  if (!user) {
    return (
      <Button variant="utility-row" size="sm" bleedInline onClick={onSignIn} disabled={loading}>
        {loading ? (
          <Loader2 className={`${styles.utilityIcon} ${styles.accountSpin}`} size={14} />
        ) : (
          <LogIn className={styles.utilityIcon} size={14} />
        )}
        <span>Sign in</span>
      </Button>
    );
  }

  const displayName = user.displayName?.trim() || user.email;
  const avatarUrl = user.avatarUrl ?? github.session?.viewer?.avatarUrl ?? null;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="utility-row" size="sm" bleedInline ariaLabel={`Manage ${displayName} account`}>
          <span className={styles.utilityAvatar}>
            {avatarUrl ? (
              <img src={avatarUrl} alt="" draggable={false} crossOrigin="anonymous" referrerPolicy="no-referrer" />
            ) : (
              <UserRound size={14} aria-hidden="true" />
            )}
          </span>
          <span className={styles.utilityLabel}>{displayName}</span>
          <ChevronDown size={14} aria-hidden="true" className={styles.utilityChevron} />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={accountPopoverStyles.popover} side="bottom" align="end" sideOffset={8}>
          <AccountMenu account={account} github={github} user={user} onOpenSettings={onOpenAccountSettings} />
          <Popover.Arrow className={accountPopoverStyles.arrow} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── Row component ───────────────────────────────────

function ScoreRow({
  entry,
  onSelect,
  onForget,
}: {
  entry: RecentScore;
  onSelect: (e: RecentScore) => void;
  onForget: (id: string) => void;
}) {
  const isVcs = Boolean(entry.vcs);
  const title = isVcs ? entry.vcs!.rootName : entry.scoreName;
  return (
    <div
      role="listitem"
      className={styles.item}
      onClick={() => onSelect(entry)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(entry);
        }
      }}
      tabIndex={0}
    >
      <div className={styles.itemIconWrap}>
        {isVcs ? (
          <FolderGit2 className={styles.itemIcon} aria-hidden="true" />
        ) : (
          <File className={styles.itemIcon} aria-hidden="true" />
        )}
      </div>
      <div className={styles.itemBody}>
        <div className={styles.itemName}>{title}</div>
        <div className={styles.itemMeta}>
          <span className={isVcs ? styles.itemBadgeProject : styles.itemBadge}>{isVcs ? "Project" : "File"}</span>
          {isVcs && <span>{entry.vcs!.scoreRelPath}</span>}
          {isVcs && <span>·</span>}
          <span>{formatRelative(entry.lastOpened)}</span>
        </div>
      </div>
      <IconButton
        tooltip={`Remove ${title} from recents`}
        onClick={(e) => {
          e.stopPropagation();
          onForget(entry.id);
        }}
        size="sm"
      >
        <X size={14} />
      </IconButton>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────

const srOnly = {
  position: "absolute" as const,
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap" as const,
  border: 0,
};

function sameCalendarDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

/** Format a timestamp as a relative time ("2 minutes ago", "3 days ago"). */
function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return "just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const yr = Math.floor(day / 365);
  return `${yr} year${yr === 1 ? "" : "s"} ago`;
}
