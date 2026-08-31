import { type PageSetup, DEFAULT_PAGE_SETUP, RASTRAL_SPATIUM_MM, PAGE_SIZE_PRESETS } from "@viritura/core";

// ─── Layout-type presets ───────────────────────────────────────────
//
// Starter templates that prefill the form fields. Saving custom
// presets and a real reusable-template system are post-MVP. This gives
// the spirit of templates without the machinery.

export interface LayoutPreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly setup: PageSetup;
}

const LETTER = PAGE_SIZE_PRESETS["Letter"]!;
const A4 = PAGE_SIZE_PRESETS["A4"]!;

export const LAYOUT_PRESETS: readonly LayoutPreset[] = [
  {
    id: "conductor-score",
    label: "Conductor Score",
    description: "Letter landscape, condensed staff (Rastral 3)",
    setup: {
      width: LETTER.height,
      height: LETTER.width,
      orientation: "landscape",
      margins: { top: 15, right: 15, bottom: 15, left: 15 },
      spatiumMm: RASTRAL_SPATIUM_MM[3]!,
    },
  },
  {
    id: "orchestral-part",
    label: "Orchestral Part",
    description: "A4 portrait, performance staff (Rastral 2)",
    setup: {
      width: A4.width,
      height: A4.height,
      orientation: "portrait",
      margins: { top: 15, right: 15, bottom: 15, left: 15 },
      spatiumMm: RASTRAL_SPATIUM_MM[2]!,
    },
  },
  {
    id: "lead-sheet",
    label: "Lead Sheet",
    description: "Letter portrait, large staff (Rastral 1)",
    setup: {
      width: LETTER.width,
      height: LETTER.height,
      orientation: "portrait",
      margins: { top: 18, right: 18, bottom: 18, left: 18 },
      spatiumMm: RASTRAL_SPATIUM_MM[1]!,
    },
  },
  {
    id: "choral-score",
    label: "Choral Score",
    description: "A4 portrait, vocal staff (Rastral 4)",
    setup: {
      width: A4.width,
      height: A4.height,
      orientation: "portrait",
      margins: { top: 15, right: 15, bottom: 15, left: 15 },
      spatiumMm: RASTRAL_SPATIUM_MM[4]!,
    },
  },
  {
    id: "piano-solo",
    label: "Piano Solo",
    description: "Letter portrait, large staff (Rastral 1)",
    setup: {
      width: LETTER.width,
      height: LETTER.height,
      orientation: "portrait",
      margins: { top: 15, right: 15, bottom: 15, left: 15 },
      spatiumMm: RASTRAL_SPATIUM_MM[1]!,
    },
  },
  {
    id: "worksheet",
    label: "Worksheet / Exercise",
    description: "Letter portrait, oversized staff (Rastral 0)",
    setup: {
      width: LETTER.width,
      height: LETTER.height,
      orientation: "portrait",
      margins: { top: 25, right: 25, bottom: 25, left: 25 },
      spatiumMm: RASTRAL_SPATIUM_MM[0]!,
    },
  },
  {
    id: "manuscript-draft",
    label: "Manuscript Draft",
    description: "App default — A4 portrait, Rastral 6",
    setup: DEFAULT_PAGE_SETUP,
  },
];

/** True if two PageSetups are equivalent within numeric tolerance. */
export function pageSetupsEqual(a: PageSetup, b: PageSetup): boolean {
  return (
    Math.abs(a.width - b.width) < 0.01 &&
    Math.abs(a.height - b.height) < 0.01 &&
    a.orientation === b.orientation &&
    Math.abs(a.margins.top - b.margins.top) < 0.01 &&
    Math.abs(a.margins.right - b.margins.right) < 0.01 &&
    Math.abs(a.margins.bottom - b.margins.bottom) < 0.01 &&
    Math.abs(a.margins.left - b.margins.left) < 0.01 &&
    Math.abs(a.spatiumMm - b.spatiumMm) < 0.001
  );
}

/** Find a matching preset for a PageSetup, or null if none matches. */
export function findMatchingPreset(setup: PageSetup): LayoutPreset | null {
  return LAYOUT_PRESETS.find((p) => pageSetupsEqual(p.setup, setup)) ?? null;
}

// ─── Unit conversion ───────────────────────────────────────────────

const UNIT_FACTORS: Record<string, number> = {
  mm: 1,
  cm: 10,
  in: 25.4,
};

/** Parse a string like "0.5in", "10mm", "1cm" or plain "210" → mm value. */
export function parseUnitValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const match = trimmed.match(/^([0-9]*\.?[0-9]+)\s*(mm|cm|in)?$/i);
  if (!match) return null;
  const num = parseFloat(match[1]!);
  if (isNaN(num)) return null;
  const unit = (match[2] ?? "mm").toLowerCase();
  const factor = UNIT_FACTORS[unit] ?? 1;
  return num * factor;
}

/** Format mm value for display — rounds to reasonable precision. */
export function formatMm(mm: number): string {
  // Show up to 1 decimal for display, trim trailing zeros
  return parseFloat(mm.toFixed(1)).toString();
}

// ─── Constants ─────────────────────────────────────────────────────

export const RASTRAL_LABELS: readonly string[] = [
  "0 — 8.0mm",
  "1 — 7.5mm",
  "2 — 7.0mm",
  "3 — 6.5mm",
  "4 — 6.0mm",
  "5 — 5.5mm",
  "6 — 5.0mm",
  "7 — 4.5mm",
  "8 — 3.5mm",
];

export const PAGE_SIZE_NAMES = Object.keys(PAGE_SIZE_PRESETS);

export function findPageSizeName(w: number, h: number): string {
  for (const [name, dims] of Object.entries(PAGE_SIZE_PRESETS)) {
    if (Math.abs(dims.width - w) < 0.1 && Math.abs(dims.height - h) < 0.1) return name;
    if (Math.abs(dims.width - h) < 0.1 && Math.abs(dims.height - w) < 0.1) return name;
  }
  return "Custom";
}

export function findRastralIndex(spatiumMm: number): number {
  for (let i = 0; i < RASTRAL_SPATIUM_MM.length; i++) {
    if (Math.abs((RASTRAL_SPATIUM_MM[i] ?? 0) - spatiumMm) < 0.001) return i;
  }
  return -1; // custom
}
