import type { CSSProperties } from "react";
import { ListRow } from "@viritura/ui";

const HISTORY_CONTENT_STYLE: CSSProperties = { display: "flex", flexDirection: "column", flex: 1, gap: 2, minWidth: 0 };
const HISTORY_TITLE_ROW_STYLE: CSSProperties = { display: "flex", alignItems: "center", gap: 6 };
const HISTORY_META_ROW_STYLE: CSSProperties = { display: "flex", alignItems: "center", gap: 6, minWidth: 0 };
const HISTORY_SHA_STYLE: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  fontFamily: "monospace",
  color: "var(--text-muted)",
  flexShrink: 0,
};
const HISTORY_SUBLABEL_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "var(--type-eyebrow-size)",
  color: "var(--text-muted)",
};
function historyRowStyle(checked: boolean): CSSProperties {
  return {
    alignItems: "flex-start",
    padding: "8px 12px",
    border: "none",
    borderRadius: 0,
    borderBottom: "1px solid color-mix(in srgb, var(--border) 50%, transparent)",
    borderLeft: checked ? "2px solid var(--accent)" : "2px solid transparent",
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
    background: isFrom ? "#c62828" : "#2e7d32",
    marginLeft: "auto",
    flexShrink: 0,
  };
}

export function HistoryRow({
  label,
  sublabel,
  sha,
  checked,
  side,
  accent,
  onToggle,
}: {
  label: string;
  sublabel: string;
  sha?: string;
  checked: boolean;
  side: "from" | "to" | null;
  accent?: boolean;
  onToggle: () => void;
}) {
  return (
    <ListRow
      onClick={onToggle}
      style={historyRowStyle(checked === true)}
      selected={checked}
      aria-label={`${label}${side ? `, ${side === "from" ? "before" : "after"} revision` : ""}`}
    >
      <span style={HISTORY_CONTENT_STYLE}>
        <span style={HISTORY_TITLE_ROW_STYLE}>
          <span style={historyLabelStyle(accent === true)}>{label}</span>
          {side && <SideBadge side={side} />}
        </span>
        <span style={HISTORY_META_ROW_STYLE}>
          <span style={HISTORY_SUBLABEL_STYLE}>{sublabel}</span>
          {sha && <span style={HISTORY_SHA_STYLE}>{sha}</span>}
        </span>
      </span>
    </ListRow>
  );
}

function SideBadge({ side }: { side: "from" | "to" }) {
  const isFrom = side === "from";
  return <span style={sideBadgeStyle(isFrom)}>{isFrom ? "Before" : "After"}</span>;
}
