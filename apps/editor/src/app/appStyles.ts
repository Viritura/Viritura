import type React from "react";

// ─── Styles ─────────────────────────────────────

export const dragOverlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(108, 180, 240, 0.06)",
  border: "3px dashed var(--accent)",
  borderRadius: "14px",
  zIndex: 100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  pointerEvents: "none",
};

export const errorBannerStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  background: "var(--surface-raised)",
  boxShadow: "var(--inset-soft), inset 0 0 0 1.5px var(--error)",
  borderRadius: "0",
  color: "var(--warning)",
  fontSize: "0.85rem",
  flexShrink: 0,
};

export const printWarningBannerStyle: React.CSSProperties = {
  ...errorBannerStyle,
  borderRadius: "12px 0 0 0",
  boxShadow: "var(--inset-soft), inset 0 0 0 1.5px var(--warning)",
};

export const trackBannerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  padding: "0.5rem 1rem",
  background: "var(--surface-raised)",
  boxShadow: "var(--inset-soft)",
  borderTop: "1px solid var(--separator-v)",
  borderBottom: "1px solid var(--separator-v)",
  color: "var(--text)",
  fontSize: "0.85rem",
  flexShrink: 0,
};
