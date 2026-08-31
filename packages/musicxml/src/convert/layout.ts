import { classifyInstrument, FAMILY_ORDER } from "../constants";
import type {
  GroupInfo,
  MnxGlobalMeasure,
  MnxLayoutContent,
  MnxLayoutGroup,
  MnxLayoutStaff,
  MnxPart,
  MnxScore,
  MnxSystemLayout,
  PartInfo,
} from "../types";
import { computeMultimeasureRests } from "./multimeasureRests";

function makeStaff(info: PartInfo, staffNum?: number): MnxLayoutStaff {
  const source: { part: string; staff?: number } = { part: info.id };
  if (staffNum !== undefined) source.staff = staffNum;
  // Reference the part's display name rather than hardcoding it, so the engine
  // auto-numbers like instruments (two "Flute" parts → "Flute 1"/"Flute 2")
  // and derives the abbreviated label for subsequent systems. Condensed staves
  // (multiple sources) keep an explicit `label` since labelref resolves a
  // single part only.
  return {
    type: "staff",
    sources: [source],
    labelref: "name",
  };
}

function buildLayoutFromGroups(partsInfo: PartInfo[], sortedGroups: GroupInfo[]): MnxLayoutContent[] {
  // Emit a single part as either a plain staff or, for multi-staff instruments
  // (e.g. piano), a brace group spanning its staves.
  function emitPart(pInfo: PartInfo): MnxLayoutContent {
    if (pInfo.staves > 1) {
      const staves: MnxLayoutContent[] = [];
      for (let s = 1; s <= pInfo.staves; s++) staves.push(makeStaff(pInfo, s));
      return { type: "group", content: staves, symbol: "brace", barlineStyle: "unified", label: pInfo.name };
    }
    return makeStaff(pInfo);
  }

  // Walk the part index range left→right. Whenever a group begins at the current
  // index, emit it (recursing into its inner content) and jump past it; this
  // preserves the original part order instead of hoisting nested groups to the
  // front. `groupList` holds only the groups eligible at this nesting level.
  function buildGroupContent(start: number, end: number, groupList: GroupInfo[]): MnxLayoutContent[] {
    const symbolMap: Record<string, string> = {
      bracket: "bracket",
      brace: "brace",
      line: "bracket",
      square: "bracket",
      none: "noSymbol",
    };
    const barlineMap: Record<string, string> = {
      yes: "unified",
      no: "individual",
      Mensurstrich: "mensurstrich",
    };

    const content: MnxLayoutContent[] = [];
    let idx = start;
    while (idx < end && idx < partsInfo.length) {
      // Widest group that begins exactly at this index becomes the outer group
      // here; strictly-narrower groups inside it are handled by recursion.
      const groupHere = groupList
        .filter((g) => g.startIndex === idx && g.endIndex <= end)
        .sort((a, b) => b.endIndex - a.endIndex)[0];

      if (groupHere) {
        const subGroups = groupList.filter(
          (sg) =>
            sg !== groupHere &&
            sg.startIndex >= groupHere.startIndex &&
            sg.endIndex <= groupHere.endIndex &&
            !(sg.startIndex === groupHere.startIndex && sg.endIndex === groupHere.endIndex),
        );
        const groupObj: MnxLayoutGroup = {
          type: "group",
          content: buildGroupContent(groupHere.startIndex, groupHere.endIndex, subGroups),
          symbol: symbolMap[groupHere.symbol] ?? "bracket",
          barlineStyle: barlineMap[groupHere.barline] ?? "unified",
        };
        if (groupHere.name) groupObj.label = groupHere.name;
        content.push(groupObj);
        idx = groupHere.endIndex;
      } else {
        content.push(emitPart(partsInfo[idx]!));
        idx++;
      }
    }

    return content;
  }

  return buildGroupContent(0, partsInfo.length, sortedGroups);
}

export function buildLayout(partsInfo: PartInfo[], groups: GroupInfo[]): MnxLayoutContent[] {
  if (groups.length > 0) {
    const sorted = [...groups].sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex);
    return buildLayoutFromGroups(partsInfo, sorted);
  }

  // Auto-group by instrument family
  const families = new Map<string, PartInfo[]>();
  for (const p of partsInfo) {
    const family = classifyInstrument(p.name);
    if (!families.has(family)) families.set(family, []);
    families.get(family)!.push(p);
  }

  const content: MnxLayoutContent[] = [];

  function addPartToLayout(p: PartInfo): void {
    if (p.staves > 1) {
      const staves: MnxLayoutContent[] = [];
      for (let s = 1; s <= p.staves; s++) {
        staves.push(makeStaff(p, s));
      }
      content.push({
        type: "group",
        content: staves,
        symbol: "brace",
        barlineStyle: "unified",
        label: p.name,
      });
    } else {
      content.push(makeStaff(p));
    }
  }

  for (const familyName of FAMILY_ORDER) {
    const familyParts = families.get(familyName);
    if (!familyParts) continue;
    if (familyParts.length === 1) {
      addPartToLayout(familyParts[0]!);
    } else {
      const groupContent: MnxLayoutContent[] = [];
      for (const p of familyParts) {
        if (p.staves > 1) {
          const staves: MnxLayoutContent[] = [];
          for (let s = 1; s <= p.staves; s++) {
            staves.push(makeStaff(p, s));
          }
          groupContent.push({
            type: "group",
            content: staves,
            symbol: "brace",
            barlineStyle: "unified",
            label: p.name,
          });
        } else {
          groupContent.push(makeStaff(p));
        }
      }
      content.push({
        type: "group",
        content: groupContent,
        symbol: "bracket",
        barlineStyle: "unified",
      });
    }
  }

  const otherParts = families.get("other");
  if (otherParts) {
    for (const p of otherParts) {
      addPartToLayout(p);
    }
  }

  return content;
}

// ─── Condensed score ─────────────────────────────────────────────────

/**
 * Strip a trailing part number from an instrument name so like instruments can
 * be matched: "Flute 1" → "Flute", "Horn 2" → "Horn", "Violin I" → "Violin".
 * Leaves transposition keys intact ("Trumpet in C" stays "Trumpet in C", and
 * "Trumpet in C 2" → "Trumpet in C").
 */
function baseInstrumentName(name: string): string {
  const m = /^(.*?)\s+(\d+|[IVX]+)$/i.exec(name);
  if (m) {
    const base = m[1]!.trim();
    // Don't strip when the trailing token is a key letter ("in C", "in F").
    if (!/\bin$/i.test(base)) return base;
  }
  return name.trim();
}

/**
 * A staff is condensable when it carries a single woodwind/brass part on a
 * single staff. Returns its base instrument name, or null if not condensable.
 * Multi-staff instruments (piano), strings, percussion and keyboards are never
 * condensed — only winds and brass, matching standard orchestral practice.
 */
function condensableBase(node: MnxLayoutContent, partsById: Map<string, PartInfo>): string | null {
  if (node.type !== "staff") return null;
  if (node.sources.length !== 1) return null;
  const src = node.sources[0]!;
  if (src.staff !== undefined) return null;
  const info = partsById.get(src.part);
  if (!info) return null;
  const family = classifyInstrument(info.name);
  if (family !== "woodwind" && family !== "brass") return null;
  return baseInstrumentName(info.name);
}

/**
 * Recursively merge runs of consecutive same-instrument wind/brass staves into
 * shared staves, paired two-by-two (e.g. Flute 1 + Flute 2 → one staff with two
 * sources; four Horns → two condensed staves). Groups are walked in place so
 * the bracket/brace structure is preserved.
 */
function condenseContent(content: MnxLayoutContent[], partsById: Map<string, PartInfo>): MnxLayoutContent[] {
  const out: MnxLayoutContent[] = [];
  let i = 0;
  while (i < content.length) {
    const node = content[i]!;
    if (node.type === "group") {
      out.push({ ...node, content: condenseContent(node.content, partsById) });
      i++;
      continue;
    }
    const base = condensableBase(node, partsById);
    if (base === null) {
      out.push(node);
      i++;
      continue;
    }
    // Gather a run of consecutive staves sharing this base instrument name.
    const run: MnxLayoutStaff[] = [node as MnxLayoutStaff];
    let j = i + 1;
    while (j < content.length && condensableBase(content[j]!, partsById) === base) {
      run.push(content[j] as MnxLayoutStaff);
      j++;
    }
    // Condense in pairs; an odd trailing part keeps its own staff.
    for (let k = 0; k < run.length; k += 2) {
      const pair = run.slice(k, k + 2);
      if (pair.length === 1) {
        out.push(pair[0]!);
      } else {
        out.push({ type: "staff", label: base, sources: pair.flatMap((s) => s.sources) });
      }
    }
    i = j;
  }
  return out;
}

function hasMultiSourceStaff(content: MnxLayoutContent[]): boolean {
  return content.some((n) => (n.type === "group" ? hasMultiSourceStaff(n.content) : n.sources.length > 1));
}

/**
 * Build a condensed layout from a full-score layout by merging same-instrument
 * wind/brass pairs onto shared staves. Returns `changed: false` when nothing
 * could be condensed (so callers can skip emitting a redundant score).
 */
export function buildCondensedLayout(
  fullContent: MnxLayoutContent[],
  partsInfo: PartInfo[],
): { content: MnxLayoutContent[]; changed: boolean } {
  const partsById = new Map(partsInfo.map((p) => [p.id, p]));
  const content = condenseContent(fullContent, partsById);
  return { content, changed: hasMultiSourceStaff(content) };
}

// ─── Individual parts ────────────────────────────────────────────────

/** Layout content for a single part: a plain staff, or a braced staff group
 *  for multi-staff instruments (e.g. piano). */
export function buildPartContent(info: PartInfo): MnxLayoutContent[] {
  if (info.staves > 1) {
    const staves: MnxLayoutContent[] = [];
    for (let s = 1; s <= info.staves; s++) staves.push(makeStaff(info, s));
    return [{ type: "group", content: staves, symbol: "brace", barlineStyle: "unified", label: info.name }];
  }
  return [makeStaff(info)];
}

/**
 * Resolve display names for individual part scores. Falls back to the part
 * abbreviation, then to "Part N", so a part with an empty `<part-name>` never
 * yields an empty score name (the MNX engine requires a non-empty `name`).
 * When two parts share the same resolved name (the auto-numbering convention,
 * e.g. two parts both named "Flute"), number them sequentially → "Flute 1",
 * "Flute 2". Already-unique or already-numbered names are left untouched.
 */
export function numberedPartNames(partsInfo: PartInfo[]): string[] {
  const base = partsInfo.map((p, i) => p.name.trim() || p.abbreviation.trim() || `Part ${i + 1}`);
  const counts = new Map<string, number>();
  for (const name of base) counts.set(name, (counts.get(name) ?? 0) + 1);
  const running = new Map<string, number>();
  return base.map((name) => {
    if ((counts.get(name) ?? 0) <= 1) return name;
    const n = (running.get(name) ?? 0) + 1;
    running.set(name, n);
    return /\d$/.test(name) ? name : `${name} ${n}`;
  });
}

/**
 * Assemble the document's layouts and scores from the full-score layout tree:
 * a full score, an auto-condensed score (winds/brass same-instrument pairs
 * merged onto shared staves), and one score per part. Score names are always
 * non-empty (the engine requires it).
 */
export function buildLayoutsAndScores(
  layoutContent: MnxLayoutContent[],
  partsInfo: PartInfo[],
  mnxParts: MnxPart[],
  globalMeasures: MnxGlobalMeasure[],
): { layouts: MnxSystemLayout[]; scores: MnxScore[] } {
  const fullId = "full-score";
  const layouts: MnxSystemLayout[] = [{ id: fullId, content: layoutContent }];
  const scores: MnxScore[] = [{ name: "Full score", layout: fullId }];

  const condensed = buildCondensedLayout(layoutContent, partsInfo);
  if (condensed.changed) {
    layouts.push({ id: "condensed-score", content: condensed.content });
    scores.push({ name: "Condensed", layout: "condensed-score" });
  }

  // Individual parts (only worth emitting when there's more than one part).
  if (partsInfo.length > 1) {
    const names = numberedPartNames(partsInfo);
    partsInfo.forEach((info, idx) => {
      const partId = `part-${info.id}`;
      layouts.push({ id: partId, content: buildPartContent(info) });
      const score: MnxScore = { name: names[idx]!, layout: partId };
      // Transposing-instrument parts render written (transposed) pitch.
      if (mnxParts[idx]?.transposition) score.useWritten = true;
      // Player parts consolidate runs of empty measures into multimeasure rests.
      const part = mnxParts[idx];
      if (part) {
        const mmRests = computeMultimeasureRests(part, globalMeasures);
        if (mmRests.length > 0) score.multimeasureRests = mmRests;
      }
      scores.push(score);
    });
  }

  return { layouts, scores };
}
