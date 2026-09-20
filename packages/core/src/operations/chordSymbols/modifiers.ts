export interface ChordModifiers {
  added: number[];
  omitted: number[];
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
  if (inGroup || needsDegree || !afterDegree || afterComma) return undefined;
  return {
    added: [...new Set(result.added)].sort((a, b) => a - b),
    omitted: [...new Set(result.omitted)].sort((a, b) => a - b),
  };
}

export function formatModifiers(modifiers: ChordModifiers): string {
  return (
    modifiers.added.map((degree) => `add${degree}`).join("") +
    modifiers.omitted.map((degree) => `omit${degree}`).join("")
  );
}

const ADDED_INTERVALS: Readonly<Record<number, number>> = { 2: 2, 4: 5, 6: 9, 7: 10, 9: 2, 11: 5, 13: 9 };

export function applyModifiers(degrees: Map<number, number[]>, modifiers?: ChordModifiers): number[] {
  // Additions name only that degree. In particular add7 is the minor seventh,
  // and add9/11/13 do not imply any lower extensions.
  for (const degree of modifiers?.added ?? []) {
    degrees.set(degree, [...(degrees.get(degree) ?? []), ADDED_INTERVALS[degree]!]);
  }
  for (const degree of modifiers?.omitted ?? []) degrees.delete(degree);
  return [...degrees.values()].flat();
}
