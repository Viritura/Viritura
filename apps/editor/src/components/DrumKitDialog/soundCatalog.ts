/**
 * A browsable, categorized catalog of percussion sounds derived from the
 * active SoundFont's capability manifest. Powers the Sound Browser, which lets
 * a user find "Tam-tam" or "Snare" by name/category and audition it — instead
 * of knowing it's key 45 in the Ethnic kit or key 38 in the Standard kit.
 */

import { listDrumKits, getDrumKit, defaultDrumKitProgram, type DrumKitCapability } from "@viritura/audio";

export type SoundCategory = "kick" | "snare" | "hihat" | "tom" | "cymbal" | "percussion" | "world" | "other";

export interface SoundEntry {
  /** GS drum-kit program this sound lives in. */
  readonly kitProgram: number;
  /** Kit name (e.g. "Standard", "Orchestra", "Ethnic"). */
  readonly kitName: string;
  /** MIDI key within the kit. */
  readonly key: number;
  /** Friendly display name (GM name when available, else sample name). */
  readonly label: string;
  /** Sample name backing the key (secondary line / disambiguation). */
  readonly sample: string;
  readonly category: SoundCategory;
  /** True when this sound is on the part's default (Standard) kit, so picking
   *  it clears the `drumKit` override. */
  readonly isDefaultKit: boolean;
}

export interface SoundCategoryGroup {
  readonly category: SoundCategory;
  readonly label: string;
  readonly entries: readonly SoundEntry[];
}

export const CATEGORY_LABELS: Record<SoundCategory, string> = {
  kick: "Kick",
  snare: "Snare & Sticks",
  hihat: "Hi-Hat",
  tom: "Toms",
  cymbal: "Cymbals",
  percussion: "Percussion",
  world: "World & Orchestral",
  other: "Other",
};

const CATEGORY_ORDER: readonly SoundCategory[] = [
  "kick",
  "snare",
  "hihat",
  "tom",
  "cymbal",
  "percussion",
  "world",
  "other",
];

/** Kits surfaced in the browser, in display order: the GM Standard kit plus the
 *  two orchestral/world kits the semantic layer borrows from. */
const SOURCE_KIT_PROGRAMS: readonly number[] = [0, 48, 49];

const WORLD_RE =
  /gong|tam-?tam|conga|bongo|timbale|agogo|cuica|surdo|tabla|guiro|cabasa|maraca|claves|wood ?block|whistle|shaker|castanet|sitar|taiko|rama/i;
const PERC_RE = /triangle|tambourine|cowbell|vibraslap|clap|jingle|bell tree|bar chime|sticks|click|met /i;

/** Classify a sound into a browser category from its key + label. */
function categorize(key: number, label: string): SoundCategory {
  if (WORLD_RE.test(label)) return "world";
  if (key === 35 || key === 36) return "kick";
  if (key === 37 || key === 38 || key === 40) return "snare";
  if (key === 42 || key === 44 || key === 46) return "hihat";
  if ([41, 43, 45, 47, 48, 50].includes(key)) return "tom";
  if ([49, 51, 52, 53, 55, 57, 59].includes(key)) return "cymbal";
  if (PERC_RE.test(label)) return "percussion";
  if (key >= 60) return "percussion";
  return "other";
}

function entriesForKit(kit: DrumKitCapability, defaultProgram: number): SoundEntry[] {
  const isDefaultKit = kit.program === defaultProgram;
  return Object.entries(kit.keys).map(([k, v]) => {
    const key = Number(k);
    // On the Standard kit the GM key name is accurate; on other kits the GM
    // name is misleading (e.g. Ethnic key 45 is a "Big Gong", not GM's "Low
    // Tom"), so the sample name is the meaningful label there.
    const label = isDefaultKit ? (v.gm ?? v.sample) : v.sample;
    return {
      kitProgram: kit.program,
      kitName: kit.name,
      key,
      label,
      sample: v.sample,
      category: categorize(key, label),
      isDefaultKit,
    };
  });
}

let cachedCatalog: SoundEntry[] | null = null;

/** All catalog entries, Standard kit first, then orchestral/world extras whose
 *  labels aren't already present on the Standard kit (avoids 3× duplication). */
export function soundCatalog(): readonly SoundEntry[] {
  if (cachedCatalog) return cachedCatalog;
  const defaultProgram = defaultDrumKitProgram();
  const out: SoundEntry[] = [];
  const seenLabels = new Set<string>();
  for (const program of SOURCE_KIT_PROGRAMS) {
    const kit = getDrumKit(program);
    if (!kit) continue;
    for (const entry of entriesForKit(kit, defaultProgram)) {
      const dedupeKey = `${entry.label}`.toLowerCase();
      // Standard kit (first) always included; later kits only add NEW labels.
      if (entry.isDefaultKit) {
        out.push(entry);
        seenLabels.add(dedupeKey);
      } else if (!seenLabels.has(dedupeKey)) {
        out.push(entry);
        seenLabels.add(dedupeKey);
      }
    }
  }
  // Fall back to listing every kit if the curated source kits are absent.
  if (out.length === 0) {
    for (const kit of listDrumKits()) out.push(...entriesForKit(kit, defaultProgram));
  }
  cachedCatalog = out;
  return out;
}

/** Catalog grouped by category in display order, with a text filter applied. */
export function groupedSounds(query: string): SoundCategoryGroup[] {
  const q = query.trim().toLowerCase();
  const matches = q
    ? soundCatalog().filter((e) => e.label.toLowerCase().includes(q) || e.sample.toLowerCase().includes(q))
    : soundCatalog();
  const byCategory = new Map<SoundCategory, SoundEntry[]>();
  for (const e of matches) {
    const bucket = byCategory.get(e.category);
    if (bucket) bucket.push(e);
    else byCategory.set(e.category, [e]);
  }
  const groups: SoundCategoryGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const entries = byCategory.get(category);
    if (entries && entries.length > 0) {
      groups.push({ category, label: CATEGORY_LABELS[category], entries });
    }
  }
  return groups;
}

/** Find the catalog entry matching a (drumKit, key) selection, for labeling. */
export function findSoundEntry(drumKit: number | undefined, key: number): SoundEntry | undefined {
  const program = drumKit ?? defaultDrumKitProgram();
  return soundCatalog().find((e) => e.kitProgram === program && e.key === key);
}

/** The drumKit override implied by picking an entry (undefined when default). */
export function drumKitForEntry(entry: SoundEntry): number | undefined {
  return entry.isDefaultKit ? undefined : entry.kitProgram;
}
