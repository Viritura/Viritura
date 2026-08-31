import React, { type CSSProperties } from "react";
import { IconButton } from "@viritura/ui";

const HISTORY_CHECKBOX_STYLE: CSSProperties = {
  marginTop: 2,
  cursor: "pointer",
  accentColor: "var(--accent)",
  flexShrink: 0,
};
const HISTORY_CONTENT_STYLE: CSSProperties = { display: "flex", flexDirection: "column", flex: 1, gap: 2, minWidth: 0 };
const HISTORY_TITLE_ROW_STYLE: CSSProperties = { display: "flex", alignItems: "center", gap: 6 };
const HISTORY_SHA_STYLE: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  fontFamily: "monospace",
  color: "var(--text-muted)",
};
const HISTORY_SUBLABEL_STYLE: CSSProperties = { fontSize: "var(--type-eyebrow-size)", color: "var(--text-muted)" };
function historyRowStyle(checked: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "flex-start",
    width: "100%",
    gap: 8,
    padding: "8px 12px",
    background: checked ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
    borderBottom: "1px solid color-mix(in srgb, var(--border) 50%, transparent)",
    borderLeft: checked ? "2px solid var(--accent)" : "2px solid transparent",
    cursor: "pointer",
    textAlign: "left",
    color: "var(--text)",
    userSelect: "none",
  };
}
function historyLabelStyle(accent: boolean): CSSProperties {
  return {
    fontSize: "var(--type-small-size)",
    fontWeight: accent ? 600 : 500,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
}
function sideBadgeStyle(isFrom: boolean): CSSProperties {
  return {
    fontSize: "var(--type-eyebrow-size)",
    fontWeight: "var(--type-heading-weight)",
    padding: "1px 6px",
    borderRadius: 8,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "#fff",
    background: isFrom ? "var(--text-muted)" : "var(--accent)",
  };
}

export function MockButton({ icon, label, active }: { icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <IconButton aria-label={label} tooltip={label} active={active === true} disabled>
      {icon}
    </IconButton>
  );
}

export function HistoryRow({
  label,
  sublabel,
  sha,
  checked,
  side,
  showCheckbox,
  accent,
  onToggle,
}: {
  label: string;
  sublabel: string;
  sha?: string;
  checked: boolean;
  side: "from" | "to" | null;
  showCheckbox: boolean;
  accent?: boolean;
  onToggle: (e: React.MouseEvent) => void;
}) {
  return (
    <label onClick={onToggle} style={historyRowStyle(checked === true)}>
      {showCheckbox && (
        /* readOnly: label onClick drives all state changes */
        /* eslint-disable no-restricted-syntax -- nested inside outer <label onClick> that owns selection; Checkbox would nest labels (invalid HTML). */
        <input
          type="checkbox"
          checked={checked}
          readOnly
          onClick={(e) => e.stopPropagation()}
          style={HISTORY_CHECKBOX_STYLE}
        />
        /* eslint-enable no-restricted-syntax */
      )}
      <div style={HISTORY_CONTENT_STYLE}>
        <div style={HISTORY_TITLE_ROW_STYLE}>
          <span style={historyLabelStyle(accent === true)}>{label}</span>
          {side && <SideBadge side={side} />}
          {sha && <span style={HISTORY_SHA_STYLE}>{sha}</span>}
        </div>
        <span style={HISTORY_SUBLABEL_STYLE}>{sublabel}</span>
      </div>
    </label>
  );
}

function SideBadge({ side }: { side: "from" | "to" }) {
  const isFrom = side === "from";
  return <span style={sideBadgeStyle(isFrom)}>{isFrom ? "From" : "To"}</span>;
}
