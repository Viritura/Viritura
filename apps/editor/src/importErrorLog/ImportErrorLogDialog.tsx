import type { CSSProperties } from "react";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogCancelButton,
  DialogHeader,
  DialogSecondaryButton,
} from "@viritura/ui";
import {
  buildImportIssueUrl,
  formatImportErrorLog,
  importErrorLogFilename,
  summarizeImportErrorLog,
  type ImportErrorLog,
} from "./importErrorLog";
import { dismissImportErrorLog, useImportErrorLogStore } from "./importErrorLogStore";

const LOG_STYLE: CSSProperties = {
  maxHeight: "18rem",
  overflow: "auto",
  margin: 0,
  padding: "0.5rem",
  background: "var(--surface-sunken)",
  color: "var(--text)",
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "0.75rem",
  lineHeight: 1.4,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  userSelect: "text",
};

interface ImportErrorLogDialogProps {
  log: ImportErrorLog | null;
  onClose: () => void;
}

function downloadLog(log: ImportErrorLog, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = importErrorLogFilename(log);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** Explains an import that failed or opened with emptied sequences, with the full log. */
export function ImportErrorLogDialog({ log, onClose }: ImportErrorLogDialogProps) {
  if (!log) return null;
  const text = formatImportErrorLog(log);
  const recovered = log.status === "recovered";
  return (
    <Dialog open onClose={onClose} size="wide">
      <DialogHeader title={recovered ? "Imported with errors" : "Import failed"} onClose={onClose} />
      <DialogBody>
        <p>{summarizeImportErrorLog(log)}</p>
        {recovered ? (
          <p>
            Each emptied voice is marked at the start of its measure with a text item such as &ldquo;Import error{" "}
            {log.recovered[0]?.logId}&rdquo; that matches an entry below. The rest of the score loaded normally. The
            original file was not changed; saving asks for a new location.
          </p>
        ) : (
          <p>The file has errors that could not be limited to individual voices, so it could not be opened.</p>
        )}
        <p>Please report this so the import can be fixed. Attach the log and, if you can share it, the file.</p>
        <pre style={LOG_STYLE} data-testid="import-error-log">
          {text}
        </pre>
      </DialogBody>
      <DialogActions>
        <DialogSecondaryButton onClick={() => downloadLog(log, text)}>Download log</DialogSecondaryButton>
        <DialogSecondaryButton
          onClick={() => window.open(buildImportIssueUrl(log, text), "_blank", "noopener,noreferrer")}
        >
          Report issue on GitHub
        </DialogSecondaryButton>
        <DialogCancelButton onClick={onClose}>Close</DialogCancelButton>
      </DialogActions>
    </Dialog>
  );
}

/** Mounts {@link ImportErrorLogDialog} against the shared import error log store. */
export function ImportErrorLogDialogHost() {
  const log = useImportErrorLogStore((state) => state.log);
  return <ImportErrorLogDialog log={log} onClose={dismissImportErrorLog} />;
}
