import type { CSSProperties } from "react";
import {
  DEFAULT_TEXT_STYLES,
  TEXT_STYLE_ROLES,
  type ResolvedTextStyle,
  type TextStyleOverride,
  type TextStyles,
} from "@viritura/core";

export type StyleField = keyof ResolvedTextStyle;

/** Roles in canonical display order, with the label shown in the UI. */
const TEXT_STYLE_ROLE_LABELS: Readonly<Record<string, string>> = {
  title: "Title",
  subtitle: "Subtitle",
  composer: "Composer",
  lyricist: "Lyricist",
  arranger: "Arranger",
  staffLabel: "Staff label",
  pageNumber: "Page number",
  tempo: "Tempo",
  pedalText: "Pedal text",
  copyright: "Copyright",
};

export function roleLabel(role: string): string {
  return TEXT_STYLE_ROLE_LABELS[role] ?? role;
}

export const ROLE_ORDER: readonly string[] = TEXT_STYLE_ROLES;

/**
 * Fallback for a role that isn't in the defaults table. `ROLE_ORDER` is
 * derived from that same table, so this only guards a caller inventing a role
 * — but it keeps every lookup below total instead of asserting non-null.
 */
const FALLBACK_STYLE: ResolvedTextStyle = {
  size: 2,
  family: "serif",
  bold: false,
  italic: false,
  color: "#000000",
  align: "left",
};

function defaultStyle(role: string): ResolvedTextStyle {
  return DEFAULT_TEXT_STYLES[role] ?? FALLBACK_STYLE;
}

/** The style the engine will actually use: defaults with the override applied. */
export function effectiveStyle(role: string, styles: TextStyles | undefined): ResolvedTextStyle {
  return { ...defaultStyle(role), ...(styles?.[role] ?? {}) };
}

/** True when the role differs from the engine default in at least one field. */
export function isOverridden(role: string, styles: TextStyles | undefined): boolean {
  const override = styles?.[role];
  if (!override) return false;
  const base = defaultStyle(role);
  return Object.entries(override).some(([field, value]) => value !== base[field as StyleField]);
}

/** The fields of a role that differ from the default, for the "what changed" hint. */
export function changedFields(role: string, styles: TextStyles | undefined): StyleField[] {
  const override = styles?.[role];
  if (!override) return [];
  const base = defaultStyle(role);
  return Object.entries(override)
    .filter(([field, value]) => value !== base[field as StyleField])
    .map(([field]) => field as StyleField);
}

/**
 * Sets one field on one role.
 *
 * A field set back to its engine default is *removed* from the override rather
 * than written out, and a role whose override becomes empty is dropped
 * entirely. Without that the document would accumulate a full copy of the
 * default stylesheet the first time anyone opened this panel, which then
 * silently pins those values even if the engine's defaults later change.
 */
export function setStyleField<F extends StyleField>(
  styles: TextStyles | undefined,
  role: string,
  field: F,
  value: ResolvedTextStyle[F],
): TextStyles {
  const next: TextStyles = { ...(styles ?? {}) };
  const base = defaultStyle(role);
  const override: TextStyleOverride = { ...(next[role] ?? {}) };

  if (value === base[field]) {
    delete override[field];
  } else {
    override[field] = value;
  }

  if (Object.keys(override).length === 0) {
    delete next[role];
  } else {
    next[role] = override;
  }
  return next;
}

/** Drops every override for one role, returning it to the engine defaults. */
export function resetRole(styles: TextStyles | undefined, role: string): TextStyles {
  const next: TextStyles = { ...(styles ?? {}) };
  delete next[role];
  return next;
}

const FAMILY_LABELS: Readonly<Record<string, string>> = {
  serif: "Serif",
  "sans-serif": "Sans-serif",
  monospace: "Monospace",
};

const ALIGN_LABELS: Readonly<Record<string, string>> = {
  left: "Left",
  center: "Center",
  right: "Right",
};

/** One-line summary shown under the preview, e.g. "Serif · 5 sp · Bold · Center". */
export function summarize(style: ResolvedTextStyle): string {
  const parts = [FAMILY_LABELS[style.family] ?? style.family, `${formatSize(style.size)} sp`];
  if (style.bold) parts.push("Bold");
  if (style.italic) parts.push("Italic");
  parts.push(ALIGN_LABELS[style.align] ?? style.align);
  return parts.join(" · ");
}

/** Trims the trailing ".0" so 5 reads as "5" but 2.5 stays "2.5". */
function formatSize(size: number): string {
  return Number.isInteger(size) ? String(size) : String(Number(size.toFixed(2)));
}

/**
 * Preview font size in px for a size given in staff spaces.
 *
 * Clamped rather than scaled linearly: at a faithful ratio the title would
 * tower over the row and the copyright line would be too small to judge. The
 * clamp keeps their relative order legible while every row stays a usable
 * height — the exact value is in the summary line beside it.
 */
function previewFontSizePx(sizeInStaffSpaces: number): number {
  return Math.max(12, Math.min(30, sizeInStaffSpaces * 6));
}

/** Inline style for the row specimen. Every value here is data-driven, which
 *  is why it can't live in the stylesheet. */
export function previewStyleFor(style: ResolvedTextStyle): CSSProperties {
  return {
    fontFamily: style.family,
    fontSize: `${previewFontSizePx(style.size)}px`,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    color: style.color,
  };
}

/** Inline style for a colour chip — the swatch's own colour is its content. */
export function swatchStyleFor(color: string): CSSProperties {
  return { background: color };
}

export const FONT_FAMILY_OPTIONS = [
  { value: "serif", label: "Serif" },
  { value: "sans-serif", label: "Sans-serif" },
  { value: "monospace", label: "Monospace" },
] as const;

/** Swatches offered beside the hex field. Mirrors the notation inspector's set. */
export const TEXT_COLOR_SWATCHES: readonly string[] = [
  "#000000",
  "#3e3e46",
  "#8a8a93",
  "#c0392b",
  "#215e4e",
  "#1f6feb",
  "#8000ff",
];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}

/** Smallest and largest size we let the stepper reach, in staff spaces. */
export const MIN_SIZE = 0.5;
export const MAX_SIZE = 20;
