export interface ChordModifiers {
  added: number[];
  omitted: number[];
  altered?: { degree: number; alter: -1 | 1 }[];
}

interface AlteredDegreeToken {
  degree: number;
  alter: -1 | 1;
  length: number;
}

function parseAlteredDegree(text: string): AlteredDegreeToken | undefined {
  const match = /^([b#♭♯])(13|11|9|5)/u.exec(text);
  if (!match) return undefined;
  return {
    degree: Number(match[2]),
    alter: match[1] === "b" || match[1] === "♭" ? -1 : 1,
    length: match[0].length,
  };
}

function finishModifiers(
  result: ChordModifiers,
  inGroup: boolean,
  needsDegree: boolean,
  afterDegree: boolean,
  afterComma: boolean,
): ChordModifiers | undefined {
  if (inGroup || needsDegree || !afterDegree || afterComma) return undefined;
  return {
    added: [...new Set(result.added)].sort((a, b) => a - b),
    omitted: [...new Set(result.omitted)].sort((a, b) => a - b),
    ...(result.altered
      ? {
          altered: result.altered
            .filter(
              (item, index, items) =>
                items.findIndex((other) => other.degree === item.degree && other.alter === item.alter) === index,
            )
            .sort((a, b) => a.degree - b.degree || a.alter - b.alter),
        }
      : {}),
  };
}

/** Degree lists require an explicit operation; bare numeric extensions are not guessed. */
export function parseModifiers(text: string): ChordModifiers | undefined {
  const result: ChordModifiers = { added: [], omitted: [] };
  let rest = text.trim().toLowerCase();
  if (!rest) return result;
  let operation: "added" | "omitted" | undefined;
  let needsDegree = false;
  let afterDegree = false;
  let inGroup = false;
  let afterComma = false;
  while (rest) {
    const altered = parseAlteredDegree(rest);
    if (altered) {
      if (needsDegree) return undefined;
      (result.altered ??= []).push({
        degree: altered.degree,
        alter: altered.alter,
      });
      operation = undefined;
      afterDegree = true;
      afterComma = false;
      rest = rest.slice(altered.length).trimStart();
      continue;
    }
    const marker = /^(add|omit|no)/.exec(rest)?.[0];
    if (marker) {
      if (needsDegree) return undefined;
      operation = marker === "add" ? "added" : "omitted";
      needsDegree = true;
      afterDegree = false;
      afterComma = false;
      rest = rest.slice(marker.length).trimStart();
      continue;
    }
    const degreeText = /^(13|11|[1-79])/.exec(rest)?.[0];
    if (degreeText) {
      const degree = Number(degreeText);
      if (!operation || (operation === "added" && [1, 3, 5].includes(degree))) return undefined;
      result[operation].push(degree);
      needsDegree = false;
      afterDegree = true;
      afterComma = false;
      rest = rest.slice(degreeText.length).trimStart();
      continue;
    }
    if (rest[0] === "(" && !inGroup && !afterComma) {
      inGroup = true;
      afterDegree = false;
    } else if (rest[0] === ")" && inGroup && afterDegree) {
      inGroup = false;
    } else if (rest[0] === "," && afterDegree && !afterComma) {
      afterComma = true;
      afterDegree = false;
    } else {
      return undefined;
    }
    rest = rest.slice(1).trimStart();
  }
  return finishModifiers(result, inGroup, needsDegree, afterDegree, afterComma);
}

export function formatModifiers(modifiers: ChordModifiers): string {
  return (
    (modifiers.altered ?? []).map(({ degree, alter }) => `${alter === -1 ? "b" : "#"}${degree}`).join("") +
    modifiers.added.map((degree) => `add${degree}`).join("") +
    modifiers.omitted.map((degree) => `omit${degree}`).join("")
  );
}

const ADDED_INTERVALS: Readonly<Record<number, number>> = { 2: 2, 4: 5, 6: 9, 7: 10, 9: 2, 11: 5, 13: 9 };

export function applyModifiers(degrees: Map<number, number[]>, modifiers?: ChordModifiers): number[] {
  const altered = new Map<number, number[]>();
  for (const { degree, alter } of modifiers?.altered ?? []) {
    const natural = degree === 5 ? 7 : ADDED_INTERVALS[degree]!;
    altered.set(degree, [...(altered.get(degree) ?? []), natural + alter]);
  }
  for (const [degree, intervals] of altered) degrees.set(degree, intervals);
  // Additions name only that degree. In particular add7 is the minor seventh,
  // and add9/11/13 do not imply any lower extensions.
  for (const degree of modifiers?.added ?? []) {
    degrees.set(degree, [...(degrees.get(degree) ?? []), ADDED_INTERVALS[degree]!]);
  }
  for (const degree of modifiers?.omitted ?? []) degrees.delete(degree);
  return [...degrees.values()].flat();
}
