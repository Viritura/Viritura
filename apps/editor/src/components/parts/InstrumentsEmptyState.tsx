/**
 * InstrumentsEmptyState — what the roster shows before any instrument exists.
 *
 * In Setup mode this is the score's front door, so it offers the ensemble
 * templates (string quartet, concert band, …) that used to be step 1 of the New
 * Score wizard. Elsewhere it degrades to a plain hint, because adding a whole
 * ensemble only makes sense where `onAddEnsemble` is wired.
 */
import type { CSSProperties } from "react";
import { EnsemblePicker } from "../modes/setup/EnsemblePicker";

const EMPTY_STYLE: CSSProperties = {
  padding: "12px 8px",
  fontSize: "var(--type-small-size)",
  color: "var(--text-muted)",
  fontStyle: "italic",
  textAlign: "center",
};
const ENSEMBLE_WRAP_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: "4px 10px 12px",
};
const ENSEMBLE_LABEL_STYLE: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  fontWeight: "var(--type-heading-weight)",
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

export interface InstrumentsEmptyStateProps {
  readonly onAddEnsemble?: ((templateId: string) => void) | undefined;
}

export function InstrumentsEmptyState({ onAddEnsemble }: InstrumentsEmptyStateProps) {
  return (
    <>
      <div style={EMPTY_STYLE}>No instruments yet. Add one below.</div>
      {onAddEnsemble && (
        <div style={ENSEMBLE_WRAP_STYLE}>
          <span style={ENSEMBLE_LABEL_STYLE}>Start from an ensemble</span>
          <EnsemblePicker onSelect={onAddEnsemble} />
        </div>
      )}
    </>
  );
}
