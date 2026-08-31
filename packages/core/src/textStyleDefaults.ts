import type { FontFamily, TextAlignment } from "./model/score";
import defaults from "./textStyleDefaults.json";

/**
 * A fully-resolved text style — every field present (unlike the partial
 * `TextStyleOverride`). This is the shape of each entry in
 * [`DEFAULT_TEXT_STYLES`].
 */
export interface ResolvedTextStyle {
  size: number;
  family: FontFamily;
  bold: boolean;
  italic: boolean;
  color: string;
  align: TextAlignment;
}

/**
 * The built-in default text styles, keyed by role. This is the single shared
 * source of truth (`textStyleDefaults.json`) — the Rust layout engine embeds
 * the same file (see `layout::text_styles::TextStylesheet::default`), so the
 * editor and the engine never drift. Roles: title, subtitle, composer,
 * lyricist, arranger, staffLabel, pageNumber, tempo, pedalText, copyright.
 */
export const DEFAULT_TEXT_STYLES: Record<string, ResolvedTextStyle> = defaults as Record<string, ResolvedTextStyle>;

/**
 * The text-style role names, in canonical display order. Derived from the
 * shared defaults so the role list can never drift from the actual styles.
 */
export const TEXT_STYLE_ROLES = Object.keys(defaults) as readonly string[];
