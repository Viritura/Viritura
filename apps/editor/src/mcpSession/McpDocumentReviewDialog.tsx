import { Check, X } from "lucide-react";
import { Dialog, DialogCancelButton, DialogPrimaryButton, DialogTitle } from "@viritura/ui";
import type { McpProposal } from "./sessionStore";
import styles from "./McpDocumentReviewDialog.module.css";

interface McpDocumentReviewDialogProps {
  readonly proposal: McpProposal;
  readonly onAccept: () => void;
  readonly onReject: () => void;
}

/** Structural review surface for whole-document (`preview.propose_mnx`)
 *  proposals. A 40,000-line JSON diff is not reviewable, so a large document
 *  replace is summarised by the before/after/delta counts a musician reasons
 *  about — bars, parts, tempos, meter/key changes, events, notes, dynamics. */
export function McpDocumentReviewDialog({ proposal, onAccept, onReject }: McpDocumentReviewDialogProps) {
  const metrics = proposal.document?.diff.metrics ?? [];
  return (
    <Dialog open onClose={onReject} size="wide">
      <div className={styles.root} data-testid="mcp-document-review">
        <header className={styles.header}>
          <div>
            <DialogTitle>Review whole-document MCP change</DialogTitle>
            <p>{proposal.summary}</p>
          </div>
          <div className={styles.actions}>
            <DialogCancelButton onClick={onReject} testId="mcp-proposal-reject">
              <X size={14} /> Reject
            </DialogCancelButton>
            <DialogPrimaryButton onClick={onAccept} testId="mcp-proposal-accept">
              <Check size={14} /> Accept
            </DialogPrimaryButton>
          </div>
        </header>
        <p className={styles.explanation}>
          This proposal replaces the entire score with a validated MNX document. Review the structural summary below.
          Nothing changes until Accept is selected.
        </p>
        <table className={styles.metrics}>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Before</th>
              <th>After</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => (
              <tr key={metric.label} data-changed={metric.delta !== 0}>
                <td>{metric.label}</td>
                <td>{metric.before}</td>
                <td>{metric.after}</td>
                <td>{metric.delta === 0 ? "—" : signed(metric.delta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

function signed(value: number): string {
  return value > 0 ? `+${String(value)}` : String(value);
}
