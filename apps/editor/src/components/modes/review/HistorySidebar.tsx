import React, { useMemo, useState, type CSSProperties } from "react";
import { ExternalLink, FolderPlus } from "lucide-react";
import { Button, Collapsible, Tabs, Tooltip } from "@viritura/ui";
import { DiffTreeView } from "../../DiffTreeView";
import { useProjectStore, WORKING_TREE_SHA } from "../../../store/projectStore";
import type { useGitHubAccount } from "../../../github/useGitHubAccount";
import { HistoryRow } from "./HistoryRow";
import { GitHubMark } from "../../../brand/GitHubMark";
import { formatSessionRange, groupHistorySessions, type HistorySession } from "./historySessions";

const STANDALONE_BODY_STYLE: CSSProperties = { padding: "4px 14px 14px" };
const HISTORY_PAGE_SIZE = 50;
type ReviewSidebarTab = "changes" | "versions";
function addedPillStyle(): CSSProperties {
  return { ...changePillStyle, background: "var(--diff-added-bg, rgba(46,125,50,0.12))", color: "#2e7d32" };
}
function removedPillStyle(): CSSProperties {
  return { ...changePillStyle, background: "var(--diff-removed-bg, rgba(198,40,40,0.12))", color: "#c62828" };
}
function modifiedPillStyle(): CSSProperties {
  return { ...changePillStyle, background: "var(--diff-modified-bg, rgba(21,101,192,0.12))", color: "#1565c0" };
}
import { formatTimestamp } from "./formatTimestamp";
import { summarizeGitHubSync } from "./summarizeGitHubSync";
import {
  panelOuterStyle,
  panelBodyStyle,
  changePillRowStyle,
  changePillStyle,
  emptyHintStyle,
  setupCardOuterStyle,
  setupTitleStyle,
  setupHintStyle,
  setupLinkButtonStyle,
  repoCardOuterStyle,
  repoCardStyle,
  repoTextStyle,
  repoTitleStyle,
  repoNameStyle,
  repoStatusStyle,
  repoActionsStyle,
  repoOpenLinkStyle,
  comparisonCardStyle,
  comparisonRowStyle,
  comparisonRowHeaderStyle,
  comparisonTextStyle,
  comparisonTitleStyle,
  comparisonMetaStyle,
  comparisonBeforeBadgeStyle,
  comparisonAfterBadgeStyle,
  tabPaneStyle,
  changeSummaryCardStyle,
  changeSummaryTitleStyle,
  loadMoreStyle,
  historyHintStyle,
  historyDateStyle,
} from "./styles";

type ProjectStatus = ReturnType<typeof useProjectStore.getState>["status"];
type ProjectLog = ReturnType<typeof useProjectStore.getState>["log"];
type GitHubAccount = ReturnType<typeof useGitHubAccount>;

interface GitHubSetupCardProps {
  show: boolean;
  githubViewer: { login: string } | null;
  githubAccount: GitHubAccount;
  canCreateGitHubRepository: boolean;
  githubInstallUrl: string | null;
  setGitHubSetupOpen: (open: boolean) => void;
}

function GitHubSetupCard(props: GitHubSetupCardProps) {
  if (!props.show) return null;
  // Tier-1 glass panel context: no inner GlassCard wrapper (would
  // double-blur the workspace beneath — see MaterialTiers § Wrapping
  // controls). Padded inline block instead.
  return (
    <div style={setupCardOuterStyle}>
      <p style={setupTitleStyle}>GitHub is not set up for this project</p>
      <p style={setupHintStyle}>Create a GitHub repository for this local project and set it as the remote origin.</p>
      {!props.githubViewer ? (
        <Button onClick={() => props.githubAccount.signIn("activity")}>
          <GitHubMark size={14} />
          Sign in with GitHub
        </Button>
      ) : props.canCreateGitHubRepository ? (
        <Button onClick={() => props.setGitHubSetupOpen(true)}>
          <GitHubMark size={14} />
          Set up GitHub…
        </Button>
      ) : props.githubInstallUrl ? (
        <a href={props.githubInstallUrl} target="_blank" rel="noreferrer" style={setupLinkButtonStyle}>
          <GitHubMark size={14} />
          Install GitHub App…
        </a>
      ) : (
        <p style={setupHintStyle}>GitHub is not configured for this environment.</p>
      )}
    </div>
  );
}

interface RepoCardProps {
  githubRepository: { fullName: string; htmlUrl: string };
  status: ProjectStatus;
  fetching: boolean;
  onFetch: () => void;
  pushing: boolean;
  onPush: () => void;
}

function RepoCard({ githubRepository, status, fetching, onFetch, pushing, onPush }: RepoCardProps) {
  return (
    <div style={repoCardOuterStyle}>
      <div style={repoCardStyle}>
        <GitHubMark size={16} aria-hidden="true" />
        <div style={repoTextStyle}>
          <p style={repoTitleStyle}>GitHub</p>
          <a href={githubRepository.htmlUrl} target="_blank" rel="noreferrer" style={repoNameStyle}>
            {githubRepository.fullName}
          </a>
          <span style={repoStatusStyle}>{summarizeGitHubSync(status)}</span>
        </div>
        <div style={repoActionsStyle}>
          {(status?.aheadCount ?? 0) > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onPush}
              disabled={pushing}
              tooltip={`Push ${status?.aheadCount} unpushed ${status?.aheadCount === 1 ? "commit" : "commits"}`}
              label={pushing ? "Pushing…" : `Push ${status?.aheadCount}`}
            />
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={onFetch}
            disabled={fetching}
            tooltip="Check GitHub for new versions (fetch)"
            label={fetching ? "Checking" : "Check"}
          />
          <Tooltip content={`Open ${githubRepository.fullName} on GitHub`}>
            <a href={githubRepository.htmlUrl} target="_blank" rel="noreferrer" style={repoOpenLinkStyle}>
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

interface HistorySectionProps {
  isVersioned: boolean;
  githubRepository: { fullName: string; htmlUrl: string } | null;
  status: ProjectStatus;
  fetching: boolean;
  pushing: boolean;
  handleFetchRemote: () => void;
  handlePushChanges: () => void;
  log: ProjectLog;
  selection: ReturnType<typeof useProjectStore.getState>["selection"];
  isSelected: (sha: string) => boolean;
  sideOf: (sha: string) => "from" | "to" | null;
  handleRowClick: (sha: string) => void;
  handleRevisionChange: (side: "from" | "to", sha: string) => void;
  handleSetupProject: () => void;
  setupCard: React.ReactNode;
}

function HistorySection(props: HistorySectionProps) {
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE);
  const visibleLog = useMemo(() => {
    const selected = new Set([props.selection.from, props.selection.to]);
    return props.log.filter((commit, index) => index < visibleCount || selected.has(commit.sha));
  }, [props.log, props.selection.from, props.selection.to, visibleCount]);
  const sessions = useMemo(() => groupHistorySessions(visibleLog), [visibleLog]);
  if (!props.isVersioned) {
    return (
      <div style={STANDALONE_BODY_STYLE}>
        <p style={emptyHintStyle}>Standalone files don&apos;t track version history.</p>
        <Button onClick={props.handleSetupProject}>
          <FolderPlus size={14} />
          Set up version history…
        </Button>
        <p style={setupHintStyle}>Pick a folder. Viritura will save your score there with version history.</p>
      </div>
    );
  }

  return (
    <div>
      {props.githubRepository && (
        <RepoCard
          githubRepository={props.githubRepository}
          status={props.status}
          fetching={props.fetching}
          onFetch={props.handleFetchRemote}
          pushing={props.pushing}
          onPush={props.handlePushChanges}
        />
      )}
      <HistoryRow
        label="Working tree"
        sublabel="Uncommitted changes"
        checked={props.isSelected(WORKING_TREE_SHA)}
        side={props.sideOf(WORKING_TREE_SHA)}
        onToggle={() => props.handleRowClick(WORKING_TREE_SHA)}
        accent
      />
      {props.log.length === 0 ? (
        <div style={emptyHintStyle}>No saved versions yet</div>
      ) : (
        sessions.map((session, index) => (
          <React.Fragment key={session.id}>
            {(index === 0 || sessions[index - 1]?.dateKey !== session.dateKey) && (
              <div style={historyDateStyle}>{session.dateLabel}</div>
            )}
            <HistorySessionRows
              session={session}
              recent={index === 0}
              selection={props.selection}
              isSelected={props.isSelected}
              sideOf={props.sideOf}
              onSelect={props.handleRowClick}
            />
          </React.Fragment>
        ))
      )}
      {props.log.length > visibleCount && (
        <div style={loadMoreStyle}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setVisibleCount((count) => Math.min(props.log.length, count + HISTORY_PAGE_SIZE))}
            label={`Show ${Math.min(HISTORY_PAGE_SIZE, props.log.length - visibleCount)} older versions`}
          />
        </div>
      )}
      {props.setupCard}
    </div>
  );
}

function HistorySessionRows({
  session,
  recent,
  selection,
  isSelected,
  sideOf,
  onSelect,
}: {
  session: HistorySession;
  recent: boolean;
  selection: HistorySectionProps["selection"];
  isSelected: HistorySectionProps["isSelected"];
  sideOf: HistorySectionProps["sideOf"];
  onSelect: HistorySectionProps["handleRowClick"];
}) {
  const containsEndpoint = session.commits.some(
    (commit) => commit.sha === selection.from || commit.sha === selection.to,
  );
  const [open, setOpen] = useState(recent || containsEndpoint || session.commits.length <= 3);
  const displayedOpen = containsEndpoint || open;
  const versionLabel = `${session.commits.length} ${session.commits.length === 1 ? "version" : "versions"}`;
  return (
    <Collapsible title={`${formatSessionRange(session)} · ${versionLabel}`} open={displayedOpen} onOpenChange={setOpen}>
      {session.commits.map((commit) => (
        <HistoryRow
          key={commit.sha}
          label={commit.subject}
          sublabel={`${commit.author.name} · ${formatTimestamp(commit.timestamp)}`}
          sha={commit.sha.slice(0, 7)}
          checked={isSelected(commit.sha)}
          side={sideOf(commit.sha)}
          onToggle={() => onSelect(commit.sha)}
        />
      ))}
    </Collapsible>
  );
}

interface RevisionSummary {
  title: string;
  meta: string;
  sha: string | null;
}

function revisionSummary(sha: string | null, log: ProjectLog): RevisionSummary {
  if (sha === WORKING_TREE_SHA) {
    return { title: "Working tree", meta: "Uncommitted changes", sha: null };
  }
  if (sha === null) {
    return { title: "No revision selected", meta: "Choose a version to compare", sha: null };
  }
  const commit = log.find((entry) => entry.sha === sha);
  if (!commit) {
    return { title: "Unavailable revision", meta: "This commit is not in the loaded history", sha: sha.slice(0, 7) };
  }
  return {
    title: commit.subject,
    meta: `${commit.author.name} · ${formatTimestamp(commit.timestamp)}`,
    sha: commit.shortSha,
  };
}

function ComparisonContext({
  selection,
  log,
  pickingSide,
  onPick,
}: Pick<HistorySectionProps, "selection" | "log"> & {
  pickingSide: "from" | "to" | null;
  onPick: (side: "from" | "to") => void;
}) {
  const before = revisionSummary(selection.from, log);
  const after = revisionSummary(selection.to, log);
  return (
    <div style={comparisonCardStyle} aria-label="Compared revisions">
      <RevisionRow side="before" revision={before} picking={pickingSide === "from"} onPick={() => onPick("from")} />
      <RevisionRow side="after" revision={after} picking={pickingSide === "to"} onPick={() => onPick("to")} />
    </div>
  );
}

function RevisionRow({
  side,
  revision,
  picking,
  onPick,
}: {
  side: "before" | "after";
  revision: RevisionSummary;
  picking: boolean;
  onPick: () => void;
}) {
  return (
    <div style={comparisonRowStyle}>
      <div style={comparisonRowHeaderStyle}>
        <span style={side === "before" ? comparisonBeforeBadgeStyle : comparisonAfterBadgeStyle}>{side}</span>
        <Button
          size="sm"
          variant="ghost"
          active={picking}
          onClick={onPick}
          label={picking ? "Cancel" : "Change"}
          ariaLabel={`${picking ? "Cancel choosing" : "Choose"} ${side} revision`}
        />
      </div>
      <span style={comparisonTextStyle}>
        <span style={comparisonTitleStyle}>{revision.title}</span>
        <span style={comparisonMetaStyle}>
          {revision.meta}
          {revision.sha ? ` · ${revision.sha}` : ""}
        </span>
      </span>
    </div>
  );
}

export interface HistorySidebarProps extends HistorySectionProps {
  totalChanges: number;
  changeCounts: { added: number; removed: number; modified: number };
  changeSummary: string;
  diffTree: unknown;
  handleNodeSelect: (...args: unknown[]) => void;
  focusedMeasure: number | null;
  githubSetupCardProps: GitHubSetupCardProps;
}

export function HistorySidebar(props: HistorySidebarProps) {
  const [activeTab, setActiveTab] = useState<ReviewSidebarTab>("changes");
  const [pickingSide, setPickingSide] = useState<"from" | "to" | null>(null);
  const setupCard = <GitHubSetupCard {...props.githubSetupCardProps} />;
  const handleHistoryRowClick = (sha: string) => {
    if (pickingSide) {
      props.handleRevisionChange(pickingSide, sha);
      setPickingSide(null);
      return;
    }
    props.handleRowClick(sha);
  };
  const sectionProps: HistorySectionProps = { ...props, setupCard, handleRowClick: handleHistoryRowClick };
  const typedDiffTree = props.diffTree as Parameters<typeof DiffTreeView>[0]["diffTree"] | null;
  return (
    <div style={panelOuterStyle}>
      {props.isVersioned ? (
        <div style={panelBodyStyle}>
          <Tabs
            tabs={[
              { id: "changes", label: props.totalChanges > 0 ? `Changes · ${props.totalChanges}` : "Changes" },
              { id: "versions", label: `Versions · ${props.log.length + 1}` },
            ]}
            activeTab={activeTab}
            onTabChange={(id) => {
              setActiveTab(id as ReviewSidebarTab);
              if (id !== "versions") setPickingSide(null);
            }}
          >
            {activeTab === "changes" ? (
              <div className="viritura-scroll" style={tabPaneStyle}>
                {props.totalChanges > 0 && (
                  <div style={changeSummaryCardStyle}>
                    <div style={changeSummaryTitleStyle}>{props.changeSummary}</div>
                    <div style={changePillRowStyle}>
                      {props.changeCounts.added > 0 && (
                        <span style={addedPillStyle()}>{props.changeCounts.added} added</span>
                      )}
                      {props.changeCounts.removed > 0 && (
                        <span style={removedPillStyle()}>{props.changeCounts.removed} removed</span>
                      )}
                      {props.changeCounts.modified > 0 && (
                        <span style={modifiedPillStyle()}>{props.changeCounts.modified} modified</span>
                      )}
                    </div>
                  </div>
                )}
                {typedDiffTree ? (
                  <DiffTreeView
                    diffTree={typedDiffTree}
                    onNodeSelect={props.handleNodeSelect as Parameters<typeof DiffTreeView>[0]["onNodeSelect"]}
                    focusedMeasureIndex={props.focusedMeasure}
                  />
                ) : (
                  <div style={emptyHintStyle}>No changes detected</div>
                )}
              </div>
            ) : (
              <div className="viritura-scroll" style={tabPaneStyle}>
                <ComparisonContext
                  selection={props.selection}
                  log={props.log}
                  pickingSide={pickingSide}
                  onPick={(side) => setPickingSide((current) => (current === side ? null : side))}
                />
                <div style={historyHintStyle}>
                  {pickingSide
                    ? `Choose the ${pickingSide === "from" ? "Before" : "After"} revision from the history below.`
                    : "Select a version to compare it with its parent, or change an endpoint above."}
                </div>
                <HistorySection {...sectionProps} />
              </div>
            )}
          </Tabs>
        </div>
      ) : (
        <div className="viritura-scroll" style={tabPaneStyle}>
          <HistorySection {...sectionProps} />
        </div>
      )}
    </div>
  );
}
