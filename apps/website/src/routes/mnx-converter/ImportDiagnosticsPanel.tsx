import { Tooltip } from "@viritura/ui";
import type { MnxDiagnostic } from "@viritura/musicxml";

interface ImportDiagnosticsPanelProps {
  diagnostics: readonly MnxDiagnostic[];
}

const SEVERITY_LABEL: Record<MnxDiagnostic["severity"], string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
};

const SEVERITY_ICON: Record<MnxDiagnostic["severity"], string> = {
  error: "✖",
  warning: "⚠",
  info: "ℹ",
};

export function ImportDiagnosticsPanel({ diagnostics }: ImportDiagnosticsPanelProps) {
  if (diagnostics.length === 0) {
    return (
      <div className="validation-panel">
        <div className="validation-summary valid">
          ✓ No conversion warnings — all source elements were preserved or mapped to MNX.
        </div>
      </div>
    );
  }

  // Bucket by severity for clearer display.
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const infos = diagnostics.filter((d) => d.severity === "info");

  const renderList = (items: readonly MnxDiagnostic[], severity: MnxDiagnostic["severity"]) => {
    if (items.length === 0) return null;
    return (
      <ul className="diagnostics-list">
        {items.map((d, i) => (
          <li key={`${severity}-${i}`} className={`diagnostics-item severity-${severity}`}>
            <span className="diagnostics-icon" aria-hidden="true">
              {SEVERITY_ICON[severity]}
            </span>
            <div className="diagnostics-body">
              <div className="diagnostics-message">{d.message}</div>
              <div className="diagnostics-meta">
                {d.pointer && (
                  <Tooltip content="Source element">
                    <code className="diagnostics-pointer">{d.pointer}</code>
                  </Tooltip>
                )}
                {d.code && (
                  <Tooltip content="Stable diagnostic code">
                    <code className="diagnostics-code">{d.code}</code>
                  </Tooltip>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  };

  const summaryClass = errors.length > 0 ? "invalid" : "valid";
  const summaryText =
    errors.length > 0
      ? `${errors.length} error${errors.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}, ${infos.length} info`
      : `${warnings.length} warning${warnings.length === 1 ? "" : "s"}, ${infos.length} info note${infos.length === 1 ? "" : "s"}`;

  return (
    <div className="validation-panel">
      <div className={`validation-summary ${summaryClass}`}>{summaryText}</div>
      {errors.length > 0 && (
        <section className="diagnostics-section">
          <h4 className="diagnostics-section-title">{SEVERITY_LABEL.error}s</h4>
          {renderList(errors, "error")}
        </section>
      )}
      {warnings.length > 0 && (
        <section className="diagnostics-section">
          <h4 className="diagnostics-section-title">{SEVERITY_LABEL.warning}s</h4>
          {renderList(warnings, "warning")}
        </section>
      )}
      {infos.length > 0 && (
        <section className="diagnostics-section">
          <h4 className="diagnostics-section-title">Info</h4>
          {renderList(infos, "info")}
        </section>
      )}
    </div>
  );
}
