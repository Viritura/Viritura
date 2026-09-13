import { useMemo, useState } from "react";
import type { Score } from "@viritura/core";
import {
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogCancelButton,
  DialogPrimaryButton,
  DialogTitle,
  FormField,
  FormTextarea,
} from "@viritura/ui";
import { buildLyricDistributionPlan, canCommitLyricPlan, type LyricDistributionPlan } from "../../../lyrics";
import type { SelectionState } from "../../../store/selectionStore";
import { buildLyricPreviewRows } from "./previewRows";
import styles from "./LyricDistributionDialog.module.css";

interface LyricDistributionDialogProps {
  readonly open: boolean;
  readonly score: Score;
  readonly selection: SelectionState;
  readonly lineId: string;
  readonly lineLabel: string;
  readonly language?: string;
  readonly initialText?: string;
  readonly sourceId?: string;
  readonly mode: "paste" | "reflow";
  readonly onClose: () => void;
  readonly onApply: (plan: LyricDistributionPlan, syllabificationConfirmed: boolean, sourceId?: string) => void;
}

export function LyricDistributionDialog({
  open,
  score,
  selection,
  lineId,
  lineLabel,
  language,
  initialText = "",
  sourceId,
  mode,
  onClose,
  onApply,
}: LyricDistributionDialogProps) {
  const [text, setText] = useState(initialText);
  const [replaceExisting, setReplaceExisting] = useState(mode === "reflow");
  const [languageAware, setLanguageAware] = useState(false);
  const [syllabificationConfirmed, setSyllabificationConfirmed] = useState(false);
  const plan = useMemo(
    () =>
      buildLyricDistributionPlan(score, selection, lineId, text, {
        replaceExisting,
        languageAware,
        ...(language && { language }),
      }),
    [language, languageAware, lineId, replaceExisting, score, selection, text],
  );
  const errors = plan.issues.filter((issue) => issue.severity === "error");
  const warnings = plan.issues.filter((issue) => issue.severity === "warning");
  const previewRows = buildLyricPreviewRows(plan);
  const canCommit = canCommitLyricPlan(plan, syllabificationConfirmed);

  return (
    <Dialog open={open} onClose={onClose} size="wide">
      <DialogTitle>{mode === "reflow" ? "Reflow Lyrics" : "Paste Verse"}</DialogTitle>
      <DialogBody>
        <p className={styles.intro}>
          Map text onto the selected events in one voice for <strong>{lineLabel}</strong>. Spaces end words, hyphens
          divide authored syllables, and underscores skip events.
        </p>
        <FormField
          label="Verse text"
          message={
            languageAware
              ? `Generated syllables use ${language ?? "the line language"} and require confirmation.`
              : "Your original text is retained for later reflow."
          }
        >
          <FormTextarea
            large
            autoFocus
            value={text}
            onChange={(event) => {
              setText(event.currentTarget.value);
              setSyllabificationConfirmed(false);
            }}
            placeholder="Hal-le-lu-jah _ sing"
          />
        </FormField>
        <div className={styles.options}>
          <Checkbox
            label="Replace existing lyrics in mapped destinations"
            checked={replaceExisting}
            onChange={(event) => setReplaceExisting(event.currentTarget.checked)}
          />
          <Checkbox
            label={`Suggest syllables from ${language ?? "the active line language"}`}
            checked={languageAware}
            disabled={!language}
            onChange={(event) => {
              setLanguageAware(event.currentTarget.checked);
              setSyllabificationConfirmed(false);
            }}
          />
        </div>

        <section className={styles.preview} aria-label="Token assignment preview">
          <h3>Preview</h3>
          <p aria-live="polite">
            {plan.tokens.length} token{plan.tokens.length === 1 ? "" : "s"} over {plan.destinations.length} selected
            event{plan.destinations.length === 1 ? "" : "s"}.
          </p>
          <ol className={styles.assignmentList}>
            {previewRows.map((row) => (
              <li key={row.index} className={styles.assignment} data-invalid={row.invalid || undefined}>
                <span className={styles.position}>{row.index + 1}</span>
                <strong>{row.tokenLabel}</strong>
                <span>{row.destinationLabel}</span>
              </li>
            ))}
          </ol>
        </section>

        {(errors.length > 0 || warnings.length > 0) && (
          <section className={styles.diagnostics} aria-label="Mapping diagnostics" aria-live="polite">
            <h3>Review before applying</h3>
            <ul>
              {[...errors, ...warnings].map((issue, index) => (
                <li key={`${issue.code}-${index}`} data-severity={issue.severity}>
                  <strong>{issue.severity === "error" ? "Error" : "Warning"}:</strong> {issue.message}
                </li>
              ))}
            </ul>
          </section>
        )}

        {plan.requiresSyllabificationConfirmation && (
          <Checkbox
            className={styles.confirmation}
            label="I reviewed the generated syllable boundaries"
            checked={syllabificationConfirmed}
            onChange={(event) => setSyllabificationConfirmed(event.currentTarget.checked)}
          />
        )}
      </DialogBody>
      <DialogActions>
        <DialogCancelButton />
        <DialogPrimaryButton
          disabled={!canCommit}
          onClick={() => {
            onApply(plan, syllabificationConfirmed, sourceId);
            onClose();
          }}
        >
          {mode === "reflow" ? "Apply Reflow" : "Distribute Verse"}
        </DialogPrimaryButton>
      </DialogActions>
    </Dialog>
  );
}
