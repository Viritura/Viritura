import React, { type CSSProperties } from "react";
import { ExternalLink, FolderPlus, GitCompareArrows, History } from "lucide-react";
import { Button, PanelHeader, PanelActionButton, SectionLabel, Tooltip } from "@viritura/ui";
import { UploadCloud } from "lucide-react";
import { DiffTreeView } from "../../DiffTreeView";
import { useProjectStore, WORKING_TREE_SHA } from "../../../store/projectStore";
import type { useGitHubAccount } from "../../../github/useGitHubAccount";
import { HistoryRow } from "./HistoryRow";
import { GitHubMark } from "../../../brand/GitHubMark";

const STANDALONE_BODY_STYLE: CSSProperties = { padding: "4px 14px 14px" };
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
}

function RepoCard({ githubRepository, status, fetching, onFetch }: RepoCardProps) {
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
          <Button
            size="sm"
            variant="ghost"
            onClick={onFetch}
            disabled={fetching}
            tooltip="Check GitHub for new versions (fetch)"
            label={fetching ? "Checking…" : "Check"}
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
  handleFetchRemote: () => void;
  log: ProjectLog;
  multiSelect: boolean;
  isSelected: (sha: string) => boolean;
  sideOf: (sha: string) => "from" | "to" | null;
  handleRowClick: (sha: string, e: React.MouseEvent) => void;
  handleSetupProject: () => void;
  setupCard: React.ReactNode;
}

function HistorySection(props: HistorySectionProps) {
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
        />
      )}
      <HistoryRow
        label="Working tree"
        sublabel="Uncommitted changes"
        checked={props.isSelected(WORKING_TREE_SHA)}
        side={props.sideOf(WORKING_TREE_SHA)}
        showCheckbox={props.multiSelect}
        onToggle={(e) => props.handleRowClick(WORKING_TREE_SHA, e)}
        accent
      />
      {props.log.length === 0 ? (
        <div style={emptyHintStyle}>No saved versions yet</div>
      ) : (
        props.log.map((c) => (
          <HistoryRow
            key={c.sha}
            label={c.subject}
            sublabel={`${c.author.name} · ${formatTimestamp(c.timestamp)}`}
            sha={c.sha.slice(0, 7)}
            checked={props.isSelected(c.sha)}
            side={props.sideOf(c.sha)}
            showCheckbox={props.multiSelect}
            onToggle={(e) => props.handleRowClick(c.sha, e)}
          />
        ))
      )}
      {props.setupCard}
    </div>
  );
}

export interface HistorySidebarProps extends HistorySectionProps {
  pushing: boolean;
  handlePushChanges: () => void;
  totalChanges: number;
  changeCounts: { added: number; removed: number; modified: number };
  diffTree: unknown;
  handleNodeSelect: (...args: unknown[]) => void;
  focusedMeasure: number | null;
  githubSetupCardProps: GitHubSetupCardProps;
}

export function HistorySidebar(props: HistorySidebarProps) {
  const setupCard = <GitHubSetupCard {...props.githubSetupCardProps} />;
  const sectionProps: HistorySectionProps = { ...props, setupCard };
  return (
    <div style={panelOuterStyle}>
      <PanelHeader
        title="Review"
        subtitle="Compare versions and inspect changes."
        actions={
          props.isVersioned ? (
            <>
              {props.status?.remoteUrl && (props.status.aheadCount ?? 0) > 0 && (
                <PanelActionButton
                  onClick={props.handlePushChanges}
                  disabled={props.pushing}
                  tooltip={`Push ${props.status.aheadCount} unpushed ${props.status.aheadCount === 1 ? "commit" : "commits"}`}
                >
                  <UploadCloud size={11} />
                  {props.pushing
                    ? "Pushing…"
                    : `Push ${props.status.aheadCount} ${(props.status.aheadCount ?? 0) === 1 ? "change" : "changes"}`}
                </PanelActionButton>
              )}
            </>
          ) : undefined
        }
      />
      <div className="viritura-scroll" style={panelBodyStyle}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

        <SectionLabel
          icon={<GitCompareArrows size={11} />}
          label="Changes"
          badge={props.totalChanges > 0 ? props.totalChanges : undefined}
        />
        {props.diffTree ? (
          <DiffTreeView
            diffTree={props.diffTree as Parameters<typeof DiffTreeView>[0]["diffTree"]}
            onNodeSelect={props.handleNodeSelect as Parameters<typeof DiffTreeView>[0]["onNodeSelect"]}
            focusedMeasureIndex={props.focusedMeasure}
          />
        ) : (
          <p style={emptyHintStyle}>No changes detected</p>
        )}

        {props.totalChanges > 0 && (
          <div style={changePillRowStyle}>
            {props.changeCounts.added > 0 && <span style={addedPillStyle()}>+{props.changeCounts.added} added</span>}
            {props.changeCounts.removed > 0 && (
              <span style={removedPillStyle()}>−{props.changeCounts.removed} removed</span>
            )}
            {props.changeCounts.modified > 0 && (
              <span style={modifiedPillStyle()}>~{props.changeCounts.modified} modified</span>
            )}
          </div>
        )}

        <SectionLabel icon={<History size={11} />} label="History" />
        <HistorySection {...sectionProps} />
      </div>
    </div>
  );
}
