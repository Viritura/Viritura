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
  display: "flex",
  flexDirection: "column",
};

export const changePillRowStyle: CSSProperties = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
  marginTop: 8,
};

export const emptyHintStyle: CSSProperties = {
  margin: "10px 12px",
  padding: "12px",
  fontSize: "0.75rem",
  color: "var(--text-muted)",
  textAlign: "center",
  lineHeight: 1.45,
  border: "1px solid color-mix(in srgb, var(--border) 65%, transparent)",
  borderRadius: 8,
  background: "color-mix(in srgb, var(--surface-raised) 70%, transparent)",
};

export const changePillStyle: CSSProperties = {
  fontSize: "0.65rem",
  fontWeight: 600,
  padding: "2px 8px",
  borderRadius: 10,
};

export const comparisonCardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 12,
  borderBottom: "1px solid color-mix(in srgb, var(--border) 65%, transparent)",
};

export const comparisonRowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 4,
  minWidth: 0,
};

export const comparisonRowHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

export const comparisonTextStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 1,
  minWidth: 0,
};

export const comparisonMetaStyle: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--type-eyebrow-size)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export const comparisonTitleStyle: CSSProperties = {
  color: "var(--text)",
  fontSize: "var(--type-small-size)",
  fontWeight: 600,
  lineHeight: 1.35,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const comparisonBadgeStyle: CSSProperties = {
  alignSelf: "flex-start",
  fontSize: "0.6rem",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

export const comparisonBeforeBadgeStyle: CSSProperties = {
  ...comparisonBadgeStyle,
  color: "#c62828",
};

export const comparisonAfterBadgeStyle: CSSProperties = {
  ...comparisonBadgeStyle,
  color: "#2e7d32",
};

export const tabPaneStyle: CSSProperties = {
  display: "flex",
  flex: 1,
  minHeight: 0,
  flexDirection: "column",
  overflowY: "auto",
  overflowX: "hidden",
};

export const changeSummaryCardStyle: CSSProperties = {
  margin: "10px 12px 6px",
  padding: "10px",
  border: "1px solid color-mix(in srgb, var(--border) 65%, transparent)",
  borderRadius: 8,
  background: "color-mix(in srgb, var(--surface-raised) 70%, transparent)",
};

export const changeSummaryTitleStyle: CSSProperties = {
  color: "var(--text)",
  fontSize: "var(--type-small-size)",
  fontWeight: 600,
};

export const loadMoreStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  padding: "10px 12px 14px",
};

export const historyHintStyle: CSSProperties = {
  padding: "8px 12px",
  color: "var(--text-muted)",
  fontSize: "var(--type-eyebrow-size)",
  lineHeight: 1.4,
  borderBottom: "1px solid color-mix(in srgb, var(--border) 50%, transparent)",
};

export const historyDateStyle: CSSProperties = {
  padding: "12px 12px 4px",
  color: "var(--text-muted)",
  fontSize: "0.62rem",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
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
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 8,
  textAlign: "center",
};

export const repoCardOuterStyle: CSSProperties = {
  minWidth: 0,
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
  margin: 0,
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
