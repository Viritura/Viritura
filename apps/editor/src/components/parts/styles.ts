import type React from "react";

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
