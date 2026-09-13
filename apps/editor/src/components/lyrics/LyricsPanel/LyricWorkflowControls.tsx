import { useCallback, useMemo, useState } from "react";
import type { Score } from "@viritura/core";
import { Button } from "@viritura/ui";
import {
  applyLyricDistributionPlan,
  inspectLyricWorkflow,
  repairLyricSource,
  sourceTextFromSelection,
  type LyricDistributionPlan,
  type LyricRepairAction,
} from "../../../lyrics";
import type { SelectionState } from "../../../store/selectionStore";
import { LyricDistributionDialog } from "../LyricDistributionDialog";
import styles from "./LyricsPanel.module.css";

interface LyricWorkflowControlsProps {
  readonly score: Score;
  readonly selection: SelectionState;
  readonly lineId: string;
  readonly lineLabel: string;
  readonly language?: string;
  readonly updateScore: (score: Score) => void;
  readonly setStatus: (message: string) => void;
}

interface DistributionDialogState {
  readonly mode: "paste" | "reflow";
  readonly sourceId?: string;
  readonly initialText?: string;
}

export function LyricWorkflowControls({
  score,
  selection,
  lineId,
  lineLabel,
  language,
  updateScore,
  setStatus,
}: LyricWorkflowControlsProps) {
  const [dialog, setDialog] = useState<DistributionDialogState | null>(null);
  const sources = useMemo(
    () => Object.values(score.lyricWorkflow?.sources ?? {}).filter((source) => source.lineId === lineId),
    [lineId, score],
  );
  const repairIssues = useMemo(() => {
    const sourceIds = new Set(sources.map((source) => source.id));
    return inspectLyricWorkflow(score).filter((issue) => sourceIds.has(issue.sourceId));
  }, [score, sources]);
  const latestSource = sources.at(-1);
  const reconstructedSource = useMemo(
    () => sourceTextFromSelection(score, selection, lineId),
    [lineId, score, selection],
  );

  const applyDistribution = useCallback(
    (plan: LyricDistributionPlan, confirmed: boolean, sourceId?: string) => {
      updateScore(applyLyricDistributionPlan(score, plan, confirmed, sourceId));
      setStatus(
        `${dialog?.mode === "reflow" ? "Reflowed" : "Distributed"} ${plan.assignments.length} token${
          plan.assignments.length === 1 ? "" : "s"
        } in one edit.`,
      );
    },
    [dialog?.mode, score, setStatus, updateScore],
  );

  const repairAffectedSources = useCallback(
    (action: LyricRepairAction) => {
      let next = score;
      const sourceIds = [...new Set(repairIssues.map((issue) => issue.sourceId))];
      for (const sourceId of sourceIds) {
        const tokenIds = new Set(
          repairIssues.filter((issue) => issue.sourceId === sourceId).map((issue) => issue.tokenId),
        );
        next = repairLyricSource(next, sourceId, action, tokenIds);
      }
      updateScore(next);
      setStatus(
        action === "follow-event"
          ? "Accepted current event anchors and restored stored lyric text."
          : action === "detach"
            ? "Detached affected lyric tokens for review."
            : "Deleted affected distributed lyrics.",
      );
    },
    [repairIssues, score, setStatus, updateScore],
  );

  return (
    <>
      <div className={styles.workflowActions}>
        <Button onClick={() => setDialog({ mode: "paste" })}>Paste verse</Button>
        <Button
          variant="ghost"
          disabled={!latestSource && !reconstructedSource}
          onClick={() =>
            setDialog({
              mode: "reflow",
              ...(latestSource?.id && { sourceId: latestSource.id }),
              initialText: latestSource?.text ?? reconstructedSource,
            })
          }
        >
          Reflow
        </Button>
      </div>

      {repairIssues.length > 0 && (
        <section className={styles.repairs} aria-label="Lyric repair">
          <strong>
            {repairIssues.length} lyric issue{repairIssues.length === 1 ? "" : "s"} need review
          </strong>
          <ul>
            {repairIssues.slice(0, 3).map((issue) => (
              <li key={`${issue.sourceId}-${issue.tokenId}-${issue.kind}`}>{issue.message}</li>
            ))}
          </ul>
          <div className={styles.repairActions}>
            <Button size="sm" onClick={() => repairAffectedSources("follow-event")}>
              Follow events
            </Button>
            <Button size="sm" variant="ghost" onClick={() => repairAffectedSources("detach")}>
              Detach for review
            </Button>
            <Button size="sm" variant="ghost" onClick={() => repairAffectedSources("delete")}>
              Delete affected
            </Button>
          </div>
        </section>
      )}

      {dialog && (
        <LyricDistributionDialog
          open
          score={score}
          selection={selection}
          lineId={lineId}
          lineLabel={lineLabel}
          mode={dialog.mode}
          {...(language && { language })}
          {...(dialog.initialText !== undefined && { initialText: dialog.initialText })}
          {...(dialog.sourceId && { sourceId: dialog.sourceId })}
          onClose={() => setDialog(null)}
          onApply={applyDistribution}
        />
      )}
    </>
  );
}
