import { useCallback, useRef, type CSSProperties } from "react";
import { Dialog, DialogTitle, DialogCancelButton, DialogPrimaryButton } from "@viritura/ui";
import { X, Check } from "lucide-react";
import { DiffEditor, type editor } from "@viritura/monaco-react";
import diffStyles from "./DiffPreviewModal.module.css";

const ICON_INLINE_STYLE: CSSProperties = { verticalAlign: "middle" };
const DIFF_EDITOR_WRAPPER_STYLE: CSSProperties = { flex: 1, overflow: "hidden" };

interface DiffPreviewModalProps {
  originalMnx: string;
  proposedMnx: string;
  onAccept: () => void;
  onReject: () => void;
}

export function DiffPreviewModal({ originalMnx, proposedMnx, onAccept, onReject }: DiffPreviewModalProps) {
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null);

  const handleMount = useCallback((ed: editor.IStandaloneDiffEditor) => {
    diffEditorRef.current = ed;
  }, []);

  return (
    <Dialog open={true} onClose={onReject} size="full">
      <div data-testid="diff-preview-modal">
        {/* Header */}
        <div className={diffStyles.header}>
          <DialogTitle className={diffStyles.headerTitle}>Preview AI Changes</DialogTitle>
          <div className={diffStyles.headerActions}>
            <DialogCancelButton testId="diff-reject-btn">
              <X size={14} style={ICON_INLINE_STYLE} /> Reject
            </DialogCancelButton>
            <DialogPrimaryButton onClick={onAccept} testId="diff-accept-btn">
              <Check size={14} style={ICON_INLINE_STYLE} /> Accept
            </DialogPrimaryButton>
          </div>
        </div>

        {/* Labels */}
        <div className={diffStyles.labelRow}>
          <div className={diffStyles.labelCurrent}>Current</div>
          <div className={diffStyles.labelProposed}>AI Proposed</div>
        </div>

        {/* Diff Editor */}
        <div style={DIFF_EDITOR_WRAPPER_STYLE}>
          <DiffEditor
            original={originalMnx}
            modified={proposedMnx}
            language="json"
            theme="vs-light"
            onMount={handleMount}
            options={{
              readOnly: true,
              renderSideBySide: true,
              minimap: { enabled: false },
              // Monaco option requires a numeric font size; not part of the --type-* chrome scale.
              fontSize: 13,
              lineNumbers: "on",
              wordWrap: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              renderIndicators: true,
              renderMarginRevertIcon: false,
              originalEditable: false,
            }}
          />
        </div>

        {/* Stats */}
        <div className={diffStyles.stats}>
          <span>Current: {originalMnx.split("\n").length} lines</span>
          <span>Proposed: {proposedMnx.split("\n").length} lines</span>
        </div>
      </div>
    </Dialog>
  );
}
