import type { CSSProperties } from "react";

export const toolbarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 16px",
  height: "100%",
};

// Two-tier panel layout: a flex-column outer shell that lets PanelHeader
// sit pinned at the top while the body scrolls underneath.
export const panelOuterStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
};

export const inspectorBodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  width: "100%",
  boxSizing: "border-box",
  background: "transparent",
  padding: "12px 14px 14px",
  overflowY: "auto",
  overflowX: "hidden",
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
  color: "var(--text)",
};

export const inspectorSectionStyle: CSSProperties = {
  margin: 0,
  padding: "0.6rem",
  border: "1px solid rgba(20, 20, 28, 0.08)",
  borderRadius: 12,
  background: "rgba(255, 255, 255, 0.35)",
  boxShadow: "0 1px 2px rgba(20, 20, 28, 0.04)",
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
};

export const inspectorLegendStyle: CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--text-muted)",
  fontWeight: 600,
  padding: 0,
  float: "left",
  width: "100%",
};

export const inspectorLabelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  fontSize: "0.75rem",
  color: "var(--text)",
};

export const inspectorInputStyle: CSSProperties = {
  border: "1px solid rgba(20, 20, 28, 0.10)",
  borderRadius: 8,
  padding: "0.4rem 0.6rem",
  fontSize: "0.8rem",
  background: "rgba(255, 255, 255, 0.65)",
  boxShadow: "inset 0 1px 2px rgba(20, 20, 28, 0.05)",
  color: "var(--text)",
  outline: "none",
  appearance: "none",
};
