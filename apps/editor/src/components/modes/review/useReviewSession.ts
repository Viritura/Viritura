import React, { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useProjectStore, WORKING_TREE_SHA, bootProjectFromHandle } from "../../../store/projectStore";
import { useGitHubAccount } from "../../../github/useGitHubAccount";
import { getGitHubGitProxyUrl } from "../../../github/api";
import { getGitHubRepositoryLink } from "./getGitHubRepositoryLink";
import { prettyJson } from "./prettyJson";

interface BackgroundFetchArgs {
  isVersioned: boolean;
  remoteUrl: string | null | undefined;
  githubViewer: { login: string } | null;
  fetchRemote: (opts: { corsProxy: string }) => Promise<unknown>;
}

/** Background-fetch GitHub refs every 60s while signed in. */
function useBackgroundGitHubFetch(args: BackgroundFetchArgs) {
  const { isVersioned, remoteUrl, githubViewer, fetchRemote } = args;
  useEffect(() => {
    if (!isVersioned || !remoteUrl || !githubViewer) return;
    let cancelled = false;
    let inFlight = false;
    const sync = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        await fetchRemote({ corsProxy: getGitHubGitProxyUrl() });
      } catch (err) {
        console.warn("Background GitHub fetch failed:", err);
      } finally {
        inFlight = false;
      }
    };
    void sync();
    const id = window.setInterval(() => void sync(), 60000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isVersioned, remoteUrl, fetchRemote, githubViewer]);
}

/** All the cross-cutting state ReviewView needs: project store fields,
 *  GitHub account/installation, multi-select state + row click handler,
 *  fetch/push/setup handlers, and the resolved diff text pair. */
export function useReviewSession(modifiedJson: string | undefined, originalJson: string | undefined) {
  const adapter = useProjectStore((s) => s.adapter);
  const status = useProjectStore((s) => s.status);
  const log = useProjectStore((s) => s.log);
  const selection = useProjectStore((s) => s.selection);
  const toggleSelection = useProjectStore((s) => s.toggleSelection);
  const refresh = useProjectStore((s) => s.refresh);
  const fetchRemote = useProjectStore((s) => s.fetchRemote);
  const setSelection = useProjectStore((s) => s.setSelection);
  const selectCommitForDiff = useProjectStore((s) => s.selectCommitForDiff);

  const currentJson = modifiedJson ?? "";
  const githubAccount = useGitHubAccount();
  const [githubSetupOpen, setGitHubSetupOpen] = useState(false);

  const isVersioned = !!adapter && adapter.isVersioned();
  const needsGitHubRemote = isVersioned && status?.remoteUrl == null;
  const githubViewer = githubAccount.session?.connected === true ? githubAccount.session.viewer : null;
  const githubInstallation = githubAccount.session?.installation ?? null;
  const githubInstallUrl = githubInstallation?.htmlUrl ?? githubAccount.app?.installUrl ?? null;
  const canCreateGitHubRepository = githubInstallation?.canCreateRepositories === true;
  const githubRepository = useMemo(() => getGitHubRepositoryLink(status?.remoteUrl ?? null), [status?.remoteUrl]);

  // Ordered list of all SHA-like keys, newest first (working tree is index 0).
  const allShas = useMemo<string[]>(() => [WORKING_TREE_SHA, ...log.map((c) => c.sha)], [log]);
  const [lastIndex, setLastIndex] = useState<number | null>(null);
  // `useTransition` replaces the hand-rolled `pushing` / `fetching` boolean
  // flags around the GitHub round-trips. React tracks the pending status for
  // free; the button-disable wiring downstream stays unchanged.
  const [pushing, startPushTransition] = useTransition();
  const [fetching, startFetchTransition] = useTransition();
  const [multiSelect, setMultiSelect] = useState(false);

  // Rescan local history occasionally so it picks up commits made outside Viritura.
  useEffect(() => {
    if (!isVersioned) return;
    void refresh();
    const id = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(id);
  }, [isVersioned, refresh]);

  useBackgroundGitHubFetch({
    isVersioned,
    remoteUrl: status?.remoteUrl,
    githubViewer,
    fetchRemote,
  });

  // Resolve from/to text for the diff in project mode.
  const [resolvedFrom, setResolvedFrom] = useState<string>("");
  const [resolvedTo, setResolvedTo] = useState<string>("");
  useEffect(() => {
    if (!isVersioned || !adapter) {
      setResolvedFrom("");
      setResolvedTo("");
      return;
    }
    let cancelled = false;
    const resolve = async (sha: string | null): Promise<string> => {
      if (sha === null) return "";
      if (sha === WORKING_TREE_SHA) return currentJson ?? "";
      try {
        return (await adapter.readScoreAtCommit(sha)) ?? "";
      } catch {
        return "";
      }
    };
    Promise.all([resolve(selection.from), resolve(selection.to)]).then(([f, t]) => {
      if (cancelled) return;
      setResolvedFrom(f);
      setResolvedTo(t);
    });
    return () => {
      cancelled = true;
    };
  }, [isVersioned, adapter, selection.from, selection.to, currentJson]);

  const effectiveOriginal = isVersioned ? prettyJson(resolvedFrom) : (originalJson ?? "");
  const effectiveModified = isVersioned ? prettyJson(resolvedTo) : (modifiedJson ?? "");

  const isSelected = (sha: string): boolean =>
    multiSelect ? selection.from === sha || selection.to === sha : selection.to === sha;
  const sideOf = (_sha: string): "from" | "to" | null => null;

  const handleSetupProject = async () => {
    const picker = (
      window as unknown as {
        showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker;
    if (!picker) {
      toast.error("Project folders require a Chromium-based browser.");
      return;
    }
    if (!currentJson) {
      toast.error("Open a score first.");
      return;
    }
    try {
      const handle = await picker({ mode: "readwrite" });
      await bootProjectFromHandle({
        rootHandle: handle,
        scorePath: "score.mnx",
        init: { initialJson: currentJson, initialMessage: "Initial draft" },
      });
      toast.success(`Version history enabled in ${handle.name}`);
      if (canCreateGitHubRepository) {
        setGitHubSetupOpen(true);
      }
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      console.error("Project setup failed:", err);
      toast.error("Failed to set up version history");
    }
  };

  const handleFetchRemote = () => {
    if (!adapter?.isVersioned() || !status?.remoteUrl) return;
    startFetchTransition(async () => {
      try {
        await fetchRemote({ corsProxy: getGitHubGitProxyUrl() });
        toast.success("Fetched latest GitHub refs");
      } catch (err) {
        console.error("Fetch failed:", err);
        toast.error(err instanceof Error ? err.message : "Failed to fetch from GitHub");
      }
    });
  };

  const handlePushChanges = () => {
    if (!adapter?.isVersioned()) return;
    startPushTransition(async () => {
      try {
        await adapter.push({ corsProxy: getGitHubGitProxyUrl() });
        await refresh();
        toast.success("Pushed changes to GitHub");
      } catch (err) {
        console.error("Push failed:", err);
        toast.error(err instanceof Error ? err.message : "Failed to push changes");
      }
    });
  };

  const handleRowClick = (sha: string, e: React.MouseEvent) => {
    const { shiftKey, ctrlKey, metaKey } = e;
    const isModified = shiftKey || ctrlKey || metaKey;

    if (!multiSelect && !isModified) {
      // Simple mode: select commit + auto-parent.
      if (sha === WORKING_TREE_SHA) {
        const headSha = log[0]?.sha ?? null;
        setSelection({ from: headSha, to: WORKING_TREE_SHA });
      } else {
        selectCommitForDiff(sha);
      }
      setLastIndex(allShas.indexOf(sha));
      return;
    }

    // Enter / stay in multi-select mode.
    if (!multiSelect) setMultiSelect(true);

    const idx = allShas.indexOf(sha);
    if (shiftKey && lastIndex !== null && lastIndex !== idx) {
      const lo = Math.min(idx, lastIndex);
      const hi = Math.max(idx, lastIndex);
      const fromSha = allShas[hi]!; // higher index = older
      const toSha = allShas[lo]!; // lower index = newer
      setSelection({ from: fromSha, to: toSha });
    } else if (ctrlKey || metaKey) {
      toggleSelection(sha);
    } else {
      // plain click while already in multi-select → exit back to simple select
      setMultiSelect(false);
      if (sha === WORKING_TREE_SHA) {
        const headSha = log[0]?.sha ?? null;
        setSelection({ from: headSha, to: WORKING_TREE_SHA });
      } else {
        selectCommitForDiff(sha);
      }
    }
    setLastIndex(idx);
  };

  return {
    adapter,
    status,
    log,
    selection,
    refresh,
    currentJson,
    githubAccount,
    githubSetupOpen,
    setGitHubSetupOpen,
    isVersioned,
    needsGitHubRemote,
    githubViewer,
    githubInstallation,
    githubInstallUrl,
    canCreateGitHubRepository,
    githubRepository,
    pushing,
    fetching,
    multiSelect,
    effectiveOriginal,
    effectiveModified,
    isSelected,
    sideOf,
    handleSetupProject,
    handleFetchRemote,
    handlePushChanges,
    handleRowClick,
  };
}
