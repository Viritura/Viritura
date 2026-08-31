import type React from "react";
import type { InstrumentFamily } from "../../score/InstrumentCatalog";

// ─── Constants ──────────────────────────────────────────────────

export const FAMILY_COLORS: Record<InstrumentFamily, string> = {
  woodwinds: "#10b981",
  brass: "#e8b339",
  percussion: "#8b5cf6",
  keyboards: "#ec4899",
  voices: "#06b6d4",
  plucked: "#d97a4a",
  strings: "#4a90d9",
};

export const SYMBOL_OPTIONS = [
  { value: "bracket", label: "Bracket" },
  { value: "brace", label: "Brace" },
  { value: "line", label: "Line" },
  { value: "none", label: "None" },
];

export const BAR_COL_WIDTH = 7;

// ─── Styles ─────────────────────────────────────────────────────

export const panelStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  background: "transparent",
  color: "var(--text)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  userSelect: "none",
  fontSize: "0.82rem",
};

export const entryStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "4px 8px",
  border: "none",
  background: "transparent",
  color: "var(--text)",
  textAlign: "left",
  cursor: "pointer",
  fontSize: "0.8rem",
  fontFamily: "system-ui, sans-serif",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  borderRadius: 5,
  transition: "background 0.1s",
};

export const activeEntryStyle: React.CSSProperties = {
  background: "rgba(var(--accent-rgb, 33, 94, 78), 0.14)",
  boxShadow: "inset 0 0 0 1px rgba(var(--accent-rgb, 33, 94, 78), 0.30)",
  color: "var(--text-bright)",
  borderRadius: 5,
};

// Score-tab row: PublishView-style uppercase tracked header with chevron.
// Sits flat over the workspace-panel glass shell (no nested card).
export const scoreHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  padding: "8px 12px",
  border: "none",
  background: "transparent",
  color: "var(--text-muted)",
  textAlign: "left",
  cursor: "pointer",
  fontSize: "0.7rem",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontFamily: "system-ui, sans-serif",
  borderRadius: 0,
  borderTop: "1px solid rgba(20, 20, 28, 0.06)",
  transition: "color 0.12s, background 0.12s",
};

export const scoreHeaderActiveStyle: React.CSSProperties = {
  color: "rgb(var(--accent-rgb, 33, 94, 78))",
  background:
    "linear-gradient(180deg, rgba(var(--accent-rgb, 33, 94, 78), 0.10), rgba(var(--accent-rgb, 33, 94, 78), 0.04))",
  boxShadow: "inset 2px 0 0 rgb(var(--accent-rgb, 33, 94, 78))",
};

export const partsSectionDividerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 12px 4px",
  marginTop: 6,
  borderTop: "1px solid rgba(20, 20, 28, 0.14)",
  color: "var(--text-muted, #8a8a93)",
  fontSize: "0.65rem",
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  fontFamily: "system-ui, sans-serif",
  pointerEvents: "none",
};

export const addScoreDropdownStyle: React.CSSProperties = {
  position: "absolute",
  left: 8,
  right: 8,
  top: "100%",
  zIndex: 100,
  background: "rgba(255, 255, 255, 0.85)",
  border: "1px solid rgba(20, 20, 28, 0.10)",
  borderRadius: 6,
  boxShadow: "0 6px 18px rgba(20, 20, 28, 0.14)",
  padding: "4px 0",
  maxHeight: 200,
  overflowY: "auto",
};

export const dropIndicatorStyle: React.CSSProperties = {
  height: 2,
  background: "var(--accent)",
  borderRadius: 1,
  margin: "1px 0",
};

export const addPanelStyle: React.CSSProperties = {
  flexShrink: 0,
  maxHeight: 220,
  display: "flex",
  flexDirection: "column",
  borderTop: "1px solid rgba(20, 20, 28, 0.08)",
  padding: "6px 8px",
  background: "rgba(255, 255, 255, 0.18)",
};

export const searchInputStyle: React.CSSProperties = {
  flex: 1,
  fontSize: "0.78rem",
  padding: "4px 8px",
  border: "1px solid rgba(20, 20, 28, 0.10)",
  borderRadius: 6,
  outline: "none",
  background: "rgba(255, 255, 255, 0.55)",
  boxShadow: "inset 0 1px 2px rgba(20, 20, 28, 0.05)",
  color: "var(--text)",
  minWidth: 0,
};
