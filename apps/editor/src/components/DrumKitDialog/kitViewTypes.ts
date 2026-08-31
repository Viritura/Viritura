import type { KitComponentEdit } from "./types";

/**
 * Shared props for the drum-kit workbench and its sub-components (staff, pad
 * grid, inspector). The dialog shell owns the editable rows + selection and
 * passes the same handler set down, so every surface stays in sync.
 */
export interface KitViewProps {
  /** Components in staff order (top of staff first). */
  readonly rows: readonly KitComponentEdit[];
  readonly selectedId: string | null;
  /** Select a component (and audition it). */
  readonly onSelect: (id: string) => void;
  /** Add a component at the given MNX staff position. */
  readonly onAdd: (staffPosition: number) => void;
  /** Move a component to a new staff position. */
  readonly onMove: (id: string, staffPosition: number) => void;
  /** Remove a component. */
  readonly onRemove: (id: string) => void;
  /** Patch a component's fields. */
  readonly onUpdate: (id: string, patch: Partial<KitComponentEdit>) => void;
  /** Audition a sound without changing selection. */
  readonly onPreview: (midiKey: number, drumKit: number | undefined) => void;
}

/** Broad percussion family for a component, inferred from its GM key + name.
 *  Drives pad colors and grouping; coarse on purpose. */
export type DrumFamily = "kick" | "snare" | "hihat" | "tom" | "cymbal" | "aux" | "world";

const FAMILY_BY_KEY: ReadonlyArray<{ test: (k: number) => boolean; family: DrumFamily }> = [
  { test: (k) => k === 35 || k === 36, family: "kick" },
  { test: (k) => k === 37 || k === 38 || k === 40, family: "snare" },
  { test: (k) => k === 42 || k === 44 || k === 46, family: "hihat" },
  { test: (k) => k === 41 || k === 43 || k === 45 || k === 47 || k === 48 || k === 50, family: "tom" },
  { test: (k) => k === 49 || k === 51 || k === 52 || k === 53 || k === 55 || k === 57 || k === 59, family: "cymbal" },
];

/** Classify a component into a drum family for coloring/grouping. */
export function drumFamily(edit: KitComponentEdit): DrumFamily {
  const name = edit.name.toLowerCase();
  if (
    /gong|tam-?tam|conga|bongo|timbale|agogo|cuica|surdo|tabla|guiro|cabasa|maraca|claves|wood ?block|whistle|shaker|castanet|triangle|tambourine|cowbell|vibraslap/.test(
      name,
    )
  ) {
    return "world";
  }
  for (const rule of FAMILY_BY_KEY) {
    if (rule.test(edit.midiKey)) return rule.family;
  }
  return "aux";
}

/** CSS custom-property color token per family (resolved in the views' CSS). */
export const FAMILY_COLOR_VAR: Record<DrumFamily, string> = {
  kick: "var(--vi-fam-kick, #6366f1)",
  snare: "var(--vi-fam-snare, #ef4444)",
  hihat: "var(--vi-fam-hihat, #f59e0b)",
  tom: "var(--vi-fam-tom, #10b981)",
  cymbal: "var(--vi-fam-cymbal, #eab308)",
  aux: "var(--vi-fam-aux, #8b5cf6)",
  world: "var(--vi-fam-world, #ec4899)",
};
