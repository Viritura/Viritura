import { type CSSProperties, useState } from "react";
import { buildDebugReport, buildIssueUrl, copyToClipboard } from "./errorReport";

const CONTAINER_STYLE: CSSProperties = {
  padding: "1.5rem",
  margin: "1rem",
  background: "#FFF3E0",
  border: "1px solid #E65100",
  borderRadius: "6px",
  color: "#BF360C",
  fontFamily: "system-ui, sans-serif",
  maxWidth: "640px",
};
const TITLE_STYLE: CSSProperties = { margin: "0 0 0.5rem", fontSize: "var(--type-body-size)" };
const MESSAGE_STYLE: CSSProperties = {
  margin: "0 0 0.75rem",
  padding: "0.5rem 0.6rem",
  background: "rgba(0, 0, 0, 0.04)",
  borderRadius: "4px",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "var(--type-small-size)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  userSelect: "text",
};
const DETAILS_STYLE: CSSProperties = { margin: "0 0 0.75rem", fontSize: "var(--type-small-size)" };
const STACK_STYLE: CSSProperties = {
  margin: "0.4rem 0 0",
  padding: "0.5rem 0.6rem",
  maxHeight: "180px",
  overflow: "auto",
  background: "rgba(0, 0, 0, 0.04)",
  borderRadius: "4px",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "var(--type-small-size)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  userSelect: "text",
};
const ACTIONS_STYLE: CSSProperties = { display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" };
const BUTTON_STYLE: CSSProperties = {
  padding: "0.3rem 0.8rem",
  border: "1px solid #E65100",
  borderRadius: "4px",
  background: "#fff",
  color: "#E65100",
  cursor: "pointer",
  fontSize: "var(--type-small-size)",
  fontWeight: "var(--type-heading-weight)",
  textDecoration: "none",
  display: "inline-block",
};

export interface DefaultErrorFallbackProps {
  error: Error;
  componentStack?: string | null;
  reset: () => void;
  /** Repository `.../issues/new` URL. When set, a "Report on GitHub" link
   *  opens a prefilled issue containing the debug report. */
  reportUrl?: string;
}

/**
 * Default render-error UI: shows the error message, an expandable stack
 * trace, and actions to copy a paste-ready debug report (or open a prefilled
 * GitHub issue) so users can file actionable bug reports.
 */
export function DefaultErrorFallback({ error, componentStack, reset, reportUrl }: DefaultErrorFallbackProps) {
  const [copied, setCopied] = useState(false);
  const report = buildDebugReport({ error, componentStack });

  const onCopy = async () => {
    const ok = await copyToClipboard(report);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div style={CONTAINER_STYLE} role="alert">
      <h3 style={TITLE_STYLE}>Rendering Error</h3>
      <p style={MESSAGE_STYLE}>{error.message || "An unknown error occurred."}</p>
      {error.stack && (
        <details style={DETAILS_STYLE}>
          <summary style={{ cursor: "pointer" }}>Show technical details</summary>
          <pre style={STACK_STYLE}>{report}</pre>
        </details>
      )}
      <div style={ACTIONS_STYLE}>
        <button onClick={reset} style={BUTTON_STYLE}>
          Try Again
        </button>
        <button onClick={onCopy} style={BUTTON_STYLE}>
          {copied ? "Copied!" : "Copy debug info"}
        </button>
        {reportUrl && (
          <a
            href={buildIssueUrl(reportUrl, error, report)}
            target="_blank"
            rel="noopener noreferrer"
            style={BUTTON_STYLE}
          >
            Report on GitHub
          </a>
        )}
      </div>
    </div>
  );
}
