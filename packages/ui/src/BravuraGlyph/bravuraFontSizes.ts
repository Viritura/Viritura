/** Font sizes per button size variant (must stay in sync with `.bravura`
 *  rules in Button.module.css). Kept in a sibling file so the
 *  `BravuraGlyph` component module exports only components — which is
 *  what `react-refresh/only-export-components` requires. */
export const BRAVURA_FONT_SIZES: Record<string, string> = {
  xs: "0.7rem",
  sm: "0.95rem",
  md: "1.2rem",
  lg: "1.5rem",
};
