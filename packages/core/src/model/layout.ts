/**
 * Layout configuration and computed layout data.
 * These are NOT stored in MNX — they're computed or stored in .viritura.
 */

/**
 * Page dimensions.
 */
export interface PageDimensions {
  /** Width in mm */
  width: number;
  /** Height in mm */
  height: number;
}

/**
 * Page setup configuration — lives on each ScoreDefinition.
 * Only written to MNX _x.viritura when values differ from defaults.
 */
export interface PageSetup {
  /** Page width in mm (default 210 = A4) */
  width: number;
  /** Page height in mm (default 297 = A4) */
  height: number;
  /** Page orientation */
  orientation: "portrait" | "landscape";
  /** Page margins in mm */
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  /** Spatium in mm — controls staff size. */
  spatiumMm: number;
  /** Optional auto page-turn settings. When `enabled`, the engine balances
   * page density against page-turn comfort when choosing page breaks. Absent
   * or `enabled: false` leaves the default greedy pagination untouched. */
  pageTurns?: PageTurnSettings;
}

/** Editor-facing auto page-turn settings, mirrored into the engine's
 * `PageTurnConfig` (snake_case) when serialized for layout. */
export interface PageTurnWeightSettings {
  density?: number;
  turn?: number;
  sparse?: number;
  titlePage?: number;
  blankPage?: number;
  timeMarking?: number;
}

export interface PageTurnSettings {
  /** Master switch. Default off. */
  enabled: boolean;
  /** Convenience preset. `"relaxed"` allows partial/blank pages for easy
   * turns; `"professional"` keeps pages densely justified. */
  preset?: "relaxed" | "professional";
  comfortableSecs?: number;
  vsSecs?: number;
  minAcceptableSecs?: number;
  targetFillFraction?: number;
  minFillFraction?: number;
  verticalJustifyThreshold?: number;
  allowPartialPages?: boolean;
  allowIntentionalBlanks?: boolean;
  titlePage?: "auto" | "always" | "never";
  /** `undefined` uses standard recto-first binding. */
  firstPageRecto?: boolean;
  emitVsMarks?: boolean;
  /** Default tempo (quarter-note BPM) when no tempo mark is present. */
  defaultBpm?: number;
  weights?: PageTurnWeightSettings;
}

export interface ResolvedPageTurnSettings {
  enabled: boolean;
  comfortableSecs: number;
  vsSecs: number;
  minAcceptableSecs: number;
  targetFillFraction: number;
  minFillFraction: number;
  verticalJustifyThreshold: number;
  allowPartialPages: boolean;
  allowIntentionalBlanks: boolean;
  titlePage: "auto" | "always" | "never";
  firstPageRecto: boolean | undefined;
  emitVsMarks: boolean;
  defaultBpm: number;
  weights: Required<PageTurnWeightSettings>;
}

export const DEFAULT_PAGE_TURN_SETTINGS: ResolvedPageTurnSettings = {
  enabled: false,
  comfortableSecs: 5,
  vsSecs: 3,
  minAcceptableSecs: 3,
  targetFillFraction: 0.9,
  minFillFraction: 0.75,
  verticalJustifyThreshold: 0.65,
  allowPartialPages: true,
  allowIntentionalBlanks: true,
  titlePage: "auto",
  firstPageRecto: undefined,
  emitVsMarks: true,
  defaultBpm: 90,
  weights: {
    density: 1,
    turn: 1,
    sparse: 6,
    titlePage: 0,
    blankPage: 0.8,
    timeMarking: 1,
  },
};

/** Resolve legacy presets and partial stored settings into every engine knob. */
export function resolvePageTurnSettings(settings?: PageTurnSettings): ResolvedPageTurnSettings {
  const preset =
    settings?.preset === "professional"
      ? {
          targetFillFraction: 0.95,
          minFillFraction: 0.85,
          verticalJustifyThreshold: 0.85,
          allowPartialPages: false,
          allowIntentionalBlanks: false,
        }
      : {
          targetFillFraction: 0.9,
          minFillFraction: 0.75,
          verticalJustifyThreshold: 0.65,
          allowPartialPages: true,
          allowIntentionalBlanks: true,
        };
  return {
    ...DEFAULT_PAGE_TURN_SETTINGS,
    ...preset,
    ...settings,
    weights: {
      ...DEFAULT_PAGE_TURN_SETTINGS.weights,
      ...settings?.weights,
    },
    enabled: settings?.enabled ?? DEFAULT_PAGE_TURN_SETTINGS.enabled,
  };
}

/** Serialize the complete editor model into Rust `PageTurnConfig` field names. */
export function pageTurnConfigForLayout(settings?: PageTurnSettings): Record<string, unknown> {
  const resolved = resolvePageTurnSettings(settings);
  return {
    enabled: resolved.enabled,
    comfortable_secs: resolved.comfortableSecs,
    vs_secs: resolved.vsSecs,
    min_acceptable_secs: resolved.minAcceptableSecs,
    target_fill_fraction: resolved.targetFillFraction,
    min_fill_fraction: resolved.minFillFraction,
    vertical_justify_threshold: resolved.verticalJustifyThreshold,
    allow_partial_pages: resolved.allowPartialPages,
    allow_intentional_blanks: resolved.allowIntentionalBlanks,
    title_page: resolved.titlePage,
    first_page_recto: resolved.firstPageRecto ?? null,
    emit_vs_marks: resolved.emitVsMarks,
    default_bpm: resolved.defaultBpm,
    weights: {
      density: resolved.weights.density,
      turn: resolved.weights.turn,
      sparse: resolved.weights.sparse,
      title_page: resolved.weights.titlePage,
      blank_page: resolved.weights.blankPage,
      time_marking: resolved.weights.timeMarking,
    },
  };
}

export const DEFAULT_PAGE_SETUP: PageSetup = {
  width: 210,
  height: 297,
  orientation: "portrait",
  margins: { top: 15, right: 15, bottom: 15, left: 15 },
  spatiumMm: 1.25,
};

/** Default page setup for individual parts (Rastral 3, 6.5mm staff). */
export const DEFAULT_PART_PAGE_SETUP: PageSetup = {
  width: 210,
  height: 297,
  orientation: "portrait",
  margins: { top: 15, right: 15, bottom: 15, left: 15 },
  spatiumMm: 1.625,
  // Parts are read by a performer who has to physically turn pages, so
  // page-turn-aware pagination is on by default. Full scores (read by a
  // conductor, rarely turned mid-performance) keep the greedy default.
  pageTurns: { enabled: true, preset: "relaxed" },
};

/**
 * Collect the unique part IDs referenced by a layout definition's content tree.
 */
function collectLayoutParts(content: LayoutContent[]): Set<string> {
  const parts = new Set<string>();
  for (const node of content) {
    if (node.type === "staff") {
      for (const src of node.sources) parts.add(src.part);
    } else {
      for (const p of collectLayoutParts(node.content)) parts.add(p);
    }
  }
  return parts;
}

/**
 * Determine whether a score definition represents a full score or a part
 * score by comparing how many parts its layout references vs the total
 * parts in the document. This handles instrument doublings correctly —
 * a player's part score referencing 2 parts (e.g. Flute + Piccolo) out
 * of 20 total is still a part score.
 *
 * - Layout shows all parts → full score defaults (smaller staff, Rastral 6)
 * - Layout shows a subset  → part defaults (larger staff, Rastral 3)
 * - No layout info available → full score defaults (conservative)
 */
export function defaultPageSetupForScore(
  scores: ScoreDefinition[] | undefined,
  scoreIndex: number,
  layouts?: LayoutDefinition[],
  totalPartCount?: number,
): PageSetup {
  const scoreDef = scores?.[scoreIndex];
  if (!scoreDef || !layouts || layouts.length === 0) return DEFAULT_PAGE_SETUP;

  const layoutId = scoreDef.layout;
  if (!layoutId) return DEFAULT_PAGE_SETUP;

  const layout = layouts.find((l) => l.id === layoutId);
  if (!layout) return DEFAULT_PAGE_SETUP;

  const layoutPartCount = collectLayoutParts(layout.content).size;
  const total = totalPartCount ?? layoutPartCount;

  // A layout showing fewer parts than the document total is a part score
  return layoutPartCount < total ? DEFAULT_PART_PAGE_SETUP : DEFAULT_PAGE_SETUP;
}

/** Rastral size table: index 0–8 → spatium in mm. */
export const RASTRAL_SPATIUM_MM: readonly number[] = [
  2.0, // 0: Oversized scores (8.0mm staff)
  1.875, // 1: Large full scores (7.5mm staff)
  1.75, // 2: Standard full scores (7.0mm staff)
  1.625, // 3: Condensed full scores (6.5mm staff)
  1.5, // 4: Vocal scores (6.0mm staff)
  1.375, // 5: Solo parts — default (5.5mm staff)
  1.25, // 6: Small parts, cue staves (5.0mm staff)
  1.125, // 7: Pocket scores (4.5mm staff)
  0.875, // 8: Miniature study scores (3.5mm staff)
];

/** Common page size presets in mm. */
export const PAGE_SIZE_PRESETS: Record<string, PageDimensions> = {
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
  A3: { width: 297, height: 420 },
  Tabloid: { width: 279.4, height: 431.8 },
  Legal: { width: 215.9, height: 355.6 },
  B4: { width: 250, height: 353 },
  "9×12 Arch": { width: 228.6, height: 304.8 },
};

/** Native unit a page-size preset is canonically defined in. */
export type PageSizeUnit = "mm" | "in";

interface PageSizePresetMeta {
  /** Display label e.g. "A4" or "Letter". */
  label: string;
  /** Native unit the size is defined in. */
  unit: PageSizeUnit;
  /** Width in the native unit. */
  nativeWidth: number;
  /** Height in the native unit. */
  nativeHeight: number;
}

/**
 * Metadata for the canonical page-size presets. Used by UIs that want
 * to display a paper size in its native unit (Letter/Legal/Tabloid/Arch
 * are imperial; A/B series are metric).
 */
export const PAGE_SIZE_PRESET_META: Record<string, PageSizePresetMeta> = {
  A4: { label: "A4", unit: "mm", nativeWidth: 210, nativeHeight: 297 },
  Letter: { label: "Letter", unit: "in", nativeWidth: 8.5, nativeHeight: 11 },
  A3: { label: "A3", unit: "mm", nativeWidth: 297, nativeHeight: 420 },
  Tabloid: { label: "Tabloid", unit: "in", nativeWidth: 11, nativeHeight: 17 },
  Legal: { label: "Legal", unit: "in", nativeWidth: 8.5, nativeHeight: 14 },
  B4: { label: "B4", unit: "mm", nativeWidth: 250, nativeHeight: 353 },
  "9×12 Arch": { label: "9×12 Arch", unit: "in", nativeWidth: 9, nativeHeight: 12 },
};

/**
 * Find a matching page-size preset for the given mm dimensions, allowing
 * a small (~0.5mm) tolerance and matching either orientation. Returns
 * the preset id (key into `PAGE_SIZE_PRESET_META`) or null if no match.
 */
export function findPageSizePreset(widthMm: number, heightMm: number, toleranceMm = 0.5): string | null {
  for (const [id, preset] of Object.entries(PAGE_SIZE_PRESETS)) {
    const matchesPortrait =
      Math.abs(widthMm - preset.width) <= toleranceMm && Math.abs(heightMm - preset.height) <= toleranceMm;
    const matchesLandscape =
      Math.abs(widthMm - preset.height) <= toleranceMm && Math.abs(heightMm - preset.width) <= toleranceMm;
    if (matchesPortrait || matchesLandscape) return id;
  }
  return null;
}

/**
 * Render a page size as a short human-readable label. When the size
 * matches a known preset, returns e.g. "A4 (210 × 297 mm)" or
 * "Letter (8.5 × 11 in)" using the preset's native unit. Falls back to
 * "W × H mm" for custom sizes. Orientation is detected so a landscape
 * A4 reads "A4 (297 × 210 mm)".
 */
export function formatPageSizeLabel(widthMm: number, heightMm: number): string {
  const presetId = findPageSizePreset(widthMm, heightMm);
  if (!presetId) {
    return `${Math.round(widthMm)} × ${Math.round(heightMm)} mm`;
  }
  const meta = PAGE_SIZE_PRESET_META[presetId]!;
  const isLandscape = widthMm > heightMm;
  const w = isLandscape ? meta.nativeHeight : meta.nativeWidth;
  const h = isLandscape ? meta.nativeWidth : meta.nativeHeight;
  const fmt = (n: number) => (Number.isInteger(n) ? n.toString() : n.toFixed(1));
  return `${meta.label} (${fmt(w)} × ${fmt(h)} ${meta.unit})`;
}

/**
 * Render a staff size from a spatium value in mm. Music notation
 * convention: a 5-line staff has 4 spaces, so staff height = 4 × spatium.
 * Returns e.g. "7 mm staff" or "7.5 mm staff".
 */
export function formatStaffSizeLabel(spatiumMm: number): string {
  const staffMm = spatiumMm * 4;
  const rounded = Math.round(staffMm * 100) / 100;
  const display = Number.isInteger(rounded)
    ? rounded.toString()
    : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${display} mm staff`;
}

/**
 * Compute spatium in pixels for a given page setup and canvas width.
 * This is the core mm→px conversion: the page width in mm maps to the
 * canvas width in pixels, and spatiumMm scales proportionally.
 */
export function computeSpatiumPx(pageSetup: PageSetup, canvasPageWidthPx: number): number {
  return canvasPageWidthPx * (pageSetup.spatiumMm / pageSetup.width);
}

/**
 * Layout settings used by the renderer.
 */
export interface LayoutSettings {
  /** Pixels per spatium (staff space) — controls zoom level */
  spatiumPx: number;
  /** Page margins in spatium */
  margins: { top: number; right: number; bottom: number; left: number };
  /** Distance between staves in spatium */
  staffDistance: number;
  /** Distance between systems in spatium */
  systemDistance: number;
}

/**
 * Default layout settings for screen rendering.
 */
export const DEFAULT_LAYOUT: LayoutSettings = {
  spatiumPx: 10,
  margins: { top: 4, right: 4, bottom: 4, left: 4 },
  staffDistance: 8,
  systemDistance: 12,
};

// ═══════════════════════════════════════════
// MNX Layout types
// ═══════════════════════════════════════════

/** Viritura vendor extensions on `LayoutDefinition`. */
export interface LayoutVirituraExt {
  /**
   * Marks a layout as auto-derived (e.g. by Engrave-mode hide-staff). The
   * `pruneUnusedDerivedLayouts` GC only drops layouts carrying this flag,
   * so user-authored layouts are preserved even when unreferenced.
   */
  derived?: boolean;
}

/** MNX layout definition — describes how parts are arranged into staves and groups. */
export interface LayoutDefinition {
  id: string;
  content: LayoutContent[];
  /** Viritura vendor extensions (serialised under `_x.viritura`). */
  _x?: { viritura?: LayoutVirituraExt };
}

/** A node in the layout content tree: either a group or a staff. */
export type LayoutContent = LayoutGroup | LayoutStaff;

/** A group node in the layout tree. */
export interface LayoutGroup {
  type: "group";
  content: LayoutContent[];
  symbol?: string;
  label?: string;
  barlineStyle?: string;
}

/** A staff node in the layout tree. */
export interface LayoutStaff {
  type: "staff";
  sources: LayoutSource[];
  label?: string;
  labelref?: string;
}

/** A source mapping a part (and optionally a staff/voice within it) to a layout staff. */
export interface LayoutSource {
  part: string;
  staff?: number;
  stem?: string;
  voice?: string;
  labelref?: string;
}

/** A multimeasure rest range within a score definition. */
export interface MultimeasureRestRange {
  start: string;
  duration: number;
}

/** MNX score definition — describes page/system structure for one score view. */
export interface ScoreDefinition {
  name?: string;
  layout?: string;
  multimeasureRests?: MultimeasureRestRange[];
  /** Whether this score displays transposed (written) pitches. */
  useWritten?: boolean;
  pages?: PageDefinition[];
  /** Per-score page setup (page size, margins, staff size). */
  pageSetup?: PageSetup;
}

/** A page within a score definition. */
export interface PageDefinition {
  systems: SystemDefinition[];
}

/** A system within a page definition. */
export interface SystemDefinition {
  layout?: string;
  measure: string;
  layoutChanges?: LayoutChange[];
}

/** A layout change within a system. */
export interface LayoutChange {
  layout: string;
  location: LayoutChangeLocation;
}

/** Location of a layout change. */
export interface LayoutChangeLocation {
  measure: string;
  position?: LayoutChangePosition;
}

/** Position within a measure for a layout change. */
export interface LayoutChangePosition {
  fraction: [number, number];
}
