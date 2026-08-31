import type { CSSProperties } from "react";

// ── Panel-level styles ──
// Palette lives inside a .workspace-panel glass card. Anything we set
// here should layer on top of that glass without re-introducing the old
// opaque neumorphic surface (which would defeat the backdrop blur and
// make the panel look heavy + dated next to PublishView's chrome).

export const panelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  background: "transparent",
  color: "var(--text)",
  fontSize: "12px",
};

const searchContainerStyle: CSSProperties = {
  padding: "8px 10px",
  flexShrink: 0,
  position: "relative",
};

export const panelScrollStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  overflowX: "hidden",
};

export const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(48px, 1fr))",
  gap: "7px",
};

export const wideGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(48px, 1fr))",
  gap: "7px",
};

export const ATONAL_LABEL_STYLE: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  fontStyle: "italic",
};
export const CUSTOM_TIME_SIGNATURE_STYLE: CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 16,
};
export const TEMPO_LABEL_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "baseline",
  gap: 4,
  fontSize: 16,
  whiteSpace: "nowrap",
};
export const TEMPO_GLYPH_STYLE: CSSProperties = { fontFamily: "Bravura", fontSize: 24, lineHeight: 1 };
export const EXPRESSION_LABEL_STYLE: CSSProperties = { fontStyle: "italic", fontSize: 14 };
export const REHEARSAL_BOX_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 22,
  height: 22,
  padding: "0 4px",
  border: "1.5px solid currentColor",
  borderRadius: 2,
  fontWeight: 600,
  fontSize: 14,
  lineHeight: 1,
};
export const SEARCH_ROW_STYLE: CSSProperties = {
  ...searchContainerStyle,
  display: "flex",
  alignItems: "center",
  gap: 6,
};
export const SEARCH_INPUT_WRAP_STYLE: CSSProperties = { position: "relative", flex: 1 };
export const SEARCH_INPUT_STYLE: CSSProperties = {
  width: "100%",
  height: 28,
  fontSize: "var(--type-eyebrow-size)",
  padding: "0 28px 0 10px",
};

// ── Button-level styles ──
// The PaletteButton primitive itself lives in @viritura/ui — its paper
// substrate, hover lift, and active-tint recipe are encapsulated there.
