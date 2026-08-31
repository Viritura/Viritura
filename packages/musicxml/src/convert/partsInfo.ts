import { childElements, childText, findChild } from "../xmlHelpers";
import type { GroupInfo, PartInfo } from "../types";

/** Title-case a hyphen/underscore-separated token, e.g. "wood-block" → "Wood Block". */
function humanizeToken(token: string): string {
  return token
    .split(/[-_]/)
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// A parenthesized transposition key embedded in a part name, e.g. "(B Flat)",
// "(F)", "(E♭)", "(Bb)". Content is a single pitch letter optionally followed
// by an accidental word/symbol. Anything else in parentheses (e.g. "(divisi)")
// is left untouched.
const EMBEDDED_KEY_PAREN = /\s*\(\s*[A-G](?:\s*(?:flat|sharp|natural|♭|♯|b|#))?\s*\)/gi;

/**
 * Strip transposition and player-number tokens that exporters frequently bake
 * into the part name, e.g. "Clarinet (B Flat) 2" → "Clarinet", "Horn (F) 4" →
 * "Horn", "Flute 1" → "Flute". The MNX engine derives the "in B♭" suffix from
 * the structured `transposition` field and auto-numbers like-named parts —
 * stacking the player numbers in the condensed score — so these embedded
 * qualifiers must collapse to the bare instrument base, or the engine can
 * neither show the transposition key nor stack the numbers.
 *
 * Roman numerals (e.g. "Violin I" / "Violin II") denote distinct sections, not
 * stand numbers, and are preserved.
 */
function normalizeInstrumentName(name: string): string {
  const withoutKey = name.replace(EMBEDDED_KEY_PAREN, "");
  // Drop a trailing Arabic player number ("Flute 2" → "Flute"); keep Roman
  // numerals so "Violin II" stays a distinct section.
  const withoutNumber = withoutKey.replace(/\s+\d+\s*$/, "");
  return withoutNumber.replace(/\s{2,}/g, " ").trim();
}

/**
 * Resolve a display name for a `<score-part>`. Exporters sometimes emit an empty
 * `<part-name>` (e.g. unpitched percussion with `print-object="no"`), leaving the
 * part nameless. Fall back through the other naming signals before giving up so
 * the part doesn't surface as a generic "Part N": part-name → part-name-display →
 * instrument-name → humanized instrument-sound (last dotted segment, the most
 * specific token in the MusicXML standard-sound id, e.g. "wood.wood-block" →
 * "Wood Block").
 */
function resolvePartName(scorePart: Element): string {
  const direct = childText(scorePart, "part-name")?.trim();
  if (direct) return direct;

  const displayText = findChild(scorePart, "part-name-display")?.textContent?.trim();
  if (displayText) return displayText;

  const scoreInstrument = findChild(scorePart, "score-instrument");
  if (scoreInstrument) {
    const instrumentName = childText(scoreInstrument, "instrument-name")?.trim();
    if (instrumentName) return instrumentName;

    const sound = childText(scoreInstrument, "instrument-sound")?.trim();
    if (sound) {
      const lastSegment = sound.split(".").pop() ?? "";
      const humanized = humanizeToken(lastSegment);
      if (humanized) return humanized;
    }
  }

  return "";
}

export function getPartsInfo(root: Element): { parts: PartInfo[]; groups: GroupInfo[] } {
  const partList = findChild(root, "part-list");
  if (!partList) return { parts: [], groups: [] };

  const parts: PartInfo[] = [];
  const groups: GroupInfo[] = [];

  // MusicXML `<part-group>` start/stop pairs are matched by `number`. Real-world
  // exporters (incl. those producing this orchestral score) reuse the same
  // `number` for sequential sibling groups without an intervening `stop`, or
  // emit a `stop` whose `number` doesn't match any open group. A plain
  // map-by-number clobbers and silently drops groups. Instead keep an open
  // stack: reopening a number closes the prior same-number group at the current
  // index; a `stop` pops the matching open group (or the most-recent one when
  // the number doesn't match); any still-open groups close at the end.
  interface OpenGroup {
    number: string;
    symbol: string;
    name: string | null;
    barline: string;
    startIndex: number;
  }
  const open: OpenGroup[] = [];

  const closeGroup = (g: OpenGroup, endIndex: number): void => {
    if (endIndex > g.startIndex) {
      groups.push({ symbol: g.symbol, name: g.name, barline: g.barline, startIndex: g.startIndex, endIndex });
    }
  };

  for (const el of childElements(partList)) {
    if (el.tagName === "score-part") {
      const id = el.getAttribute("id") ?? "";
      const name = normalizeInstrumentName(resolvePartName(el));
      const abbrev = normalizeInstrumentName(childText(el, "part-abbreviation") ?? "");
      const scoreInstrument = findChild(el, "score-instrument");
      const instrumentSound = scoreInstrument ? (childText(scoreInstrument, "instrument-sound")?.trim() ?? "") : "";
      const info: PartInfo = { id, name, abbreviation: abbrev, staves: 1 };
      if (instrumentSound) info.instrumentSound = instrumentSound;
      parts.push(info);
    } else if (el.tagName === "part-group") {
      const gtype = el.getAttribute("type");
      const gnum = el.getAttribute("number") ?? "1";
      if (gtype === "start") {
        // If this number is already open, the exporter is reusing it for a
        // sibling group — close the previous one here before opening the new.
        const existingIdx = open.findIndex((g) => g.number === gnum);
        if (existingIdx !== -1) {
          closeGroup(open[existingIdx]!, parts.length);
          open.splice(existingIdx, 1);
        }
        open.push({
          number: gnum,
          symbol: childText(el, "group-symbol") ?? "bracket",
          name: childText(el, "group-name"),
          barline: childText(el, "group-barline") ?? "yes",
          startIndex: parts.length,
        });
      } else if (gtype === "stop") {
        // Pop the matching open group; fall back to the most recently opened
        // when the number doesn't line up (tolerant of malformed nesting).
        let popIdx = -1;
        for (let i = open.length - 1; i >= 0; i--) {
          if (open[i]!.number === gnum) {
            popIdx = i;
            break;
          }
        }
        if (popIdx === -1 && open.length > 0) popIdx = open.length - 1;
        if (popIdx !== -1) {
          closeGroup(open[popIdx]!, parts.length);
          open.splice(popIdx, 1);
        }
      }
    }
  }

  // Close any groups left open at end of the part-list.
  for (const g of open) closeGroup(g, parts.length);

  // De-duplicate identical spans (a reopened-and-leftover group can produce two
  // entries covering the same parts); keep the first occurrence.
  const seen = new Set<string>();
  const deduped = groups.filter((g) => {
    const key = `${g.startIndex}:${g.endIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { parts, groups: deduped };
}
