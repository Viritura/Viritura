import type { CSSProperties } from "react";

export const toolbarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "0 16px",
  height: "100%",
  width: "100%",
};

export const dividerStyle: CSSProperties = {
  width: 1,
  height: 28,
  background: "var(--border)",
  flexShrink: 0,
};

export const panelOuterStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
};

export const panelBodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
  display: "flex",
  flexDirection: "column",
};

export const changePillRowStyle: CSSProperties = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
  padding: "4px 14px 12px",
};

export const emptyHintStyle: CSSProperties = {
  padding: "16px 12px",
  fontSize: "0.75rem",
  color: "var(--text-muted)",
  textAlign: "center",
};

export const changePillStyle: CSSProperties = {
  fontSize: "0.65rem",
  fontWeight: 600,
  padding: "2px 8px",
  borderRadius: 10,
};

export const splitterStyle: CSSProperties = {
  height: 4,
  background: "var(--surface)",
  cursor: "row-resize",
  flexShrink: 0,
  transition: "background 0.15s",
};

export const canvasPlaceholderStyle: CSSProperties = {
  padding: "1rem",
  color: "var(--text-muted)",
  fontSize: "0.8rem",
};

export const canvasLabelStyle: CSSProperties = {
  position: "absolute",
  top: 8,
  left: 10,
  fontSize: "0.62rem",
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  padding: "2px 9px",
  borderRadius: 999,
  border: "1px solid transparent",
  pointerEvents: "none",
};

export const setupHintStyle: CSSProperties = {
  margin: 0,
  fontSize: "0.7rem",
  color: "#6a6a74",
  textAlign: "center",
  lineHeight: 1.45,
};

export const setupCardOuterStyle: CSSProperties = {
  padding: "10px 14px 14px",
};

export const repoCardOuterStyle: CSSProperties = {
  padding: "4px 14px 10px",
};

export const repoCardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  minWidth: 0,
};

export const repoTextStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  minWidth: 0,
  flex: 1,
};

export const repoTitleStyle: CSSProperties = {
  margin: 0,
  color: "var(--text-muted)",
  fontSize: "0.64rem",
  fontWeight: 650,
  textTransform: "uppercase",
};

export const repoNameStyle: CSSProperties = {
  color: "var(--text)",
  fontSize: "0.76rem",
  fontWeight: 650,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  textDecoration: "none",
};

export const repoStatusStyle: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "0.68rem",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export const repoActionsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexShrink: 0,
};

export const repoOpenLinkStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--surface-raised)",
  color: "var(--text)",
  textDecoration: "none",
  flexShrink: 0,
};

export const setupTitleStyle: CSSProperties = {
  margin: "0 0 6px",
  color: "var(--text)",
  fontSize: "0.78rem",
  fontWeight: 650,
  textAlign: "center",
};

const setupButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  width: "100%",
  padding: "7px 12px",
  border: "1px solid rgba(var(--accent-rgb, 33, 94, 78), 0.45)",
  borderRadius: 999,
  background: "rgba(var(--accent-rgb, 33, 94, 78), 0.12)",
  color: "var(--text)",
  fontFamily: "inherit",
  fontSize: "0.76rem",
  fontWeight: 600,
  cursor: "pointer",
  transition: "background-color 0.15s ease-out, border-color 0.15s ease-out",
};

export const setupLinkButtonStyle: CSSProperties = {
  ...setupButtonStyle,
  textDecoration: "none",
};
