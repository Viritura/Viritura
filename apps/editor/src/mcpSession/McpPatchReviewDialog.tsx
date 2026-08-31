import { Check, X } from "lucide-react";
import { Dialog, DialogCancelButton, DialogPrimaryButton, DialogTitle } from "@viritura/ui";
import type { McpProposal } from "./sessionStore";
import styles from "./McpPatchReviewDialog.module.css";

interface McpPatchReviewDialogProps {
  readonly proposal: McpProposal;
  readonly onAccept: () => void;
  readonly onReject: () => void;
}

/** Bounded review surface for scores too large for a whole-document Monaco diff. */
export function McpPatchReviewDialog({ proposal, onAccept, onReject }: McpPatchReviewDialogProps) {
  return (
    <Dialog open onClose={onReject} size="wide">
      <div className={styles.root} data-testid="mcp-patch-review">
        <header className={styles.header}>
          <div>
            <DialogTitle>Review MCP score changes</DialogTitle>
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
          This score is too large for a responsive whole-document diff. Review the exact typed patches below. Nothing
          changes until Accept is selected.
        </p>
        <pre className={styles.patches}>{JSON.stringify(proposal.patches, null, 2)}</pre>
        <footer className={styles.footer}>
          {proposal.patches.length} typed score patch{proposal.patches.length === 1 ? "" : "es"}
        </footer>
      </div>
    </Dialog>
  );
}
