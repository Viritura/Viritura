/**
 * Storybook story for the Start Center launch screen.
 *
 * The Start Center appears on app boot when the user has not suppressed it.
 * It surfaces recent scores (folder-backed and standalone) so they can be
 * reopened in one click — addressing the fact that the File System Access
 * API requires re-prompting for permission on every page reload.
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { StartCenter } from "../../components/StartCenter";
import type { GitHubAccountState } from "../../github/useGitHubAccount";
import type { VirituraAccountState } from "../../auth";
import type { RecentScore } from "../../store/recentScores";

const PAGE_STYLE: CSSProperties = { minHeight: "100vh", background: "var(--bg)" };
const REOPEN_BUTTON_STYLE: CSSProperties = {
  position: "fixed",
  top: 16,
  left: 16,
  padding: "8px 14px",
  borderRadius: 8,
  border: "none",
  background: "var(--surface-raised)",
  boxShadow: "var(--elevation-1)",
  color: "var(--text)",
  cursor: "pointer",
};

// Build a fake handle just typed enough to satisfy the prop signature.
// The Start Center never invokes handle methods directly — it only forwards
// the entry to its callbacks, so a stub object is safe in Storybook.
const fakeDirHandle = { name: "" } as unknown as FileSystemDirectoryHandle;
const fakeFileHandle = { name: "" } as unknown as FileSystemFileHandle;

function makeProject(rootName: string, scoreRelPath: string, ageMs: number): RecentScore {
  return {
    id: `proj-${rootName}`,
    scoreName: scoreRelPath.split("/").pop() ?? scoreRelPath,
    fileHandle: fakeFileHandle,
    lastOpened: Date.now() - ageMs,
    vcs: { rootHandle: fakeDirHandle, rootName, scoreRelPath },
  };
}

function makeFile(name: string, ageMs: number): RecentScore {
  return {
    id: `file-${name}`,
    scoreName: name,
    fileHandle: fakeFileHandle,
    lastOpened: Date.now() - ageMs,
  };
}

const SAMPLE_RECENTS: RecentScore[] = [
  makeFile("scratch.mnx", 30 * 1000),
  makeProject("Symphony No. 5", "score.mnx", 3 * 60 * 1000),
  makeFile("etude-no-3.mnx", 4 * 60 * 60 * 1000),
  makeProject("String Quartet in D", "scores/quartet.mnx", 2 * 24 * 60 * 60 * 1000),
  makeProject("Piano Sonata", "sonata.mnx", 14 * 24 * 60 * 60 * 1000),
  makeFile("brass-arrangement.mnx", 90 * 24 * 60 * 60 * 1000),
];

const MOCK_GITHUB_ACCOUNT: GitHubAccountState = {
  status: "ready",
  app: {
    configured: true,
    appSlug: "viritura-dev",
    clientId: "client-id",
    installUrl: "https://github.com/apps/viritura-dev/installations/new",
  },
  session: {
    connected: true,
    viewer: { id: 1, login: "viritura-user", name: "Viritura User", avatarUrl: null },
    accessTokenExpiresAtUtc: null,
    installation: {
      installed: true,
      canCreateRepositories: true,
      installationId: 99,
      accountLogin: "viritura-user",
      accountType: "User",
      repositorySelection: "all",
      htmlUrl: "https://github.com/settings/installations/99",
      administrationWrite: true,
      suspended: false,
    },
  },
  error: null,
  refresh: async () => undefined,
  signIn: () => console.log("[StartCenter] Sign in with GitHub"),
  unlink: async () => undefined,
  createRepository: async () => {
    throw new Error("Not implemented in Storybook");
  },
};

const MOCK_VIRITURA_ACCOUNT: VirituraAccountState = {
  status: "ready",
  user: null,
  error: null,
  refresh: async () => undefined,
  signIn: async () => {
    throw new Error("Not implemented in Storybook");
  },
  signInTwoFactor: async () => {
    throw new Error("Not implemented in Storybook");
  },
  signInRecovery: async () => {
    throw new Error("Not implemented in Storybook");
  },
  register: async () => {
    throw new Error("Not implemented in Storybook");
  },
  signOut: async () => undefined,
  signOutEverywhere: async () => undefined,
};

interface PlaygroundProps {
  withRecents: boolean;
  projectsSupported: boolean;
}

function Playground({ withRecents, projectsSupported }: PlaygroundProps) {
  const [open, setOpen] = useState(true);
  const [suppress, setSuppress] = useState(false);
  const [recents, setRecents] = useState<RecentScore[]>(withRecents ? SAMPLE_RECENTS : []);

  return (
    <div style={PAGE_STYLE}>
      {!open && (
        <button onClick={() => setOpen(true)} style={REOPEN_BUTTON_STYLE}>
          Reopen Start Center
        </button>
      )}
      <StartCenter
        open={open}
        recentScores={recents}
        githubAccount={MOCK_GITHUB_ACCOUNT}
        account={MOCK_VIRITURA_ACCOUNT}
        projectsSupported={projectsSupported}
        suppressOnLaunch={suppress}
        onSuppressOnLaunchChange={setSuppress}
        onSignIn={() => console.log("[StartCenter] Sign in")}
        onOpenAccountSettings={() => console.log("[StartCenter] Account settings")}
        onChooseProjectLocation={async () => ({ name: "Scores" }) as FileSystemDirectoryHandle}
        onNewScore={async (projectName) => {
          console.log("[StartCenter] New Project");
          console.log("[StartCenter] Project name", projectName);
          setOpen(false);
          return true;
        }}
        onOpenFile={() => {
          console.log("[StartCenter] Open MNX Score");
          setOpen(false);
        }}
        onOpenFolder={() => {
          console.log("[StartCenter] Open Project Folder");
          setOpen(false);
        }}
        onImport={() => {
          console.log("[StartCenter] Import");
          setOpen(false);
        }}
        onSelectRecent={(e) => {
          console.log("[StartCenter] Select", e);
          setOpen(false);
        }}
        onForgetRecent={(id) => setRecents((prev) => prev.filter((e) => e.id !== id))}
        onSelectSample={(sample) => {
          console.log("[StartCenter] Sample", sample);
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

const meta: Meta<typeof Playground> = {
  title: "App/Start Center",
  component: Playground,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof Playground>;

/** Default: a populated recents list, projects supported. */
export const WithRecents: Story = {
  args: { withRecents: true, projectsSupported: true },
};

/** Empty state — first launch, nothing to reopen yet. */
export const EmptyRecents: Story = {
  args: { withRecents: false, projectsSupported: true },
};

/** Runtime without `showDirectoryPicker`. */
export const NoProjectSupport: Story = {
  args: { withRecents: true, projectsSupported: false },
};
