#!/usr/bin/env node
/**
 * One-off deterministic migration from MNX schema-19 dynamics to schema-27.
 *
 * Schema 27 restructured accents. `attackValue` became `residualValue` with the
 * roles reversed: `value` is now the attack and `residualValue` the level that
 * persists after it, so `fp` is `{type: "accent", value: "f", residualValue: "p"}`
 * rather than `{type: "immediate", attackValue: "f", value: "p"}`. The written
 * spelling of an accent is now assembled from `accentPrefix` / `value` /
 * `residualValue` / `accentSuffix`, defaulting to the `s` and `z` of `sfz`, so
 * the glyph override that used to carry the spelling is redundant and is
 * dropped.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const scoresDir = resolve(root, "packages/format/fixtures/mnx");

/** Structural decomposition of every accent spelling MNX 27 can express. */
const ACCENT_PARTS = {
  sfz: { value: "f" },
  sffz: { value: "ff" },
  sf: { value: "f", accentSuffix: "" },
  fz: { value: "f", accentPrefix: "" },
  rf: { value: "f", accentPrefix: "r", accentSuffix: "" },
  rfz: { value: "f", accentPrefix: "r" },
  fp: { value: "f", accentPrefix: "", accentSuffix: "", residualValue: "p" },
  pf: { value: "p", accentPrefix: "", accentSuffix: "", residualValue: "f" },
  sfp: { value: "f", accentSuffix: "", residualValue: "p" },
  sfpp: { value: "f", accentSuffix: "", residualValue: "pp" },
};

/** Glyph overrides that encoded a spelling schema 27 now encodes structurally. */
const GLYPH_TO_SPELLING = {
  dynamicSforzato: "sfz",
  dynamicSforzatoFF: "sffz",
  dynamicSforzando1: "sf",
  dynamicForzando: "fz",
  dynamicRinforzando1: "rf",
  dynamicRinforzando2: "rfz",
  dynamicFortePiano: "fp",
  dynamicPF: "pf",
  dynamicSforzandoPiano: "sfp",
  dynamicSforzandoPianissimo: "sfpp",
};

/** Recover the written spelling of a schema-19 accent or attack dynamic. */
function spellingOf(dynamic) {
  const glyphs = dynamic.glyphs ?? [];
  if (glyphs.length === 1 && GLYPH_TO_SPELLING[glyphs[0]]) return GLYPH_TO_SPELLING[glyphs[0]];
  // No usable glyph hint: rebuild from the schema-19 attack/body pair, which
  // spelled the attack first. A bare accent was always an "sfz"-family marking.
  if (dynamic.attackValue !== undefined) return `${dynamic.attackValue}${dynamic.value ?? ""}`;
  return `s${dynamic.value ?? "f"}z`;
}

function migrateDynamic(dynamic) {
  const isAccent = dynamic.type === "accent" || dynamic.attackValue !== undefined;
  if (!isAccent) return false;

  const spelling = spellingOf(dynamic);
  const parts = ACCENT_PARTS[spelling];
  if (!parts) return false;

  const before = JSON.stringify(dynamic);
  delete dynamic.attackValue;
  delete dynamic.accentPrefix;
  delete dynamic.accentSuffix;
  delete dynamic.residualValue;
  dynamic.type = "accent";
  dynamic.value = parts.value;
  if (parts.residualValue !== undefined) dynamic.residualValue = parts.residualValue;
  if (parts.accentPrefix !== undefined) dynamic.accentPrefix = parts.accentPrefix;
  if (parts.accentSuffix !== undefined) dynamic.accentSuffix = parts.accentSuffix;
  // The spelling is now derivable from the structural parts.
  if (dynamic.glyphs?.length === 1 && GLYPH_TO_SPELLING[dynamic.glyphs[0]]) delete dynamic.glyphs;
  return JSON.stringify(dynamic) !== before;
}

let changedFiles = 0;
let migrated = 0;
for (const fileName of (await readdir(scoresDir)).filter((name) => name.endsWith(".mnx")).sort()) {
  const path = resolve(scoresDir, fileName);
  const previous = await readFile(path, "utf8");
  const doc = JSON.parse(previous);
  let fileChanged = false;
  for (const part of doc.parts ?? []) {
    for (const measure of part.measures ?? []) {
      for (const dynamic of measure.dynamics ?? []) {
        if (migrateDynamic(dynamic)) {
          migrated++;
          fileChanged = true;
        }
      }
    }
  }
  if (!fileChanged) continue;
  // Preserve each fixture's existing formatting: some large imported scores are
  // stored minified so their diffs stay reviewable.
  const pretty = /^\{\n {2}"/.test(previous);
  const next = pretty ? `${JSON.stringify(doc, null, 2)}\n` : JSON.stringify(doc);
  if (next !== previous) {
    await writeFile(path, next);
    changedFiles++;
  }
}
console.log(`Migrated ${migrated} accent dynamics across ${changedFiles} score files.`);
