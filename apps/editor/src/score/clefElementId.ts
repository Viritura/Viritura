export interface ClefElementLocation {
  partIndex: number;
  measureIndex: number;
  clefIndex: number;
}

const CLEF_ELEMENT_ID_RE = /^p(\d+)\/m(\d+)\/clef(?:(\d+))?$/;

export function buildClefElementId(partIndex: number, measureIndex: number, clefIndex: number): string {
  return clefIndex === 0 ? `p${partIndex}/m${measureIndex}/clef` : `p${partIndex}/m${measureIndex}/clef${clefIndex}`;
}

export function parseClefElementId(elementId: string): ClefElementLocation | null {
  const match = elementId.match(CLEF_ELEMENT_ID_RE);
  if (!match) return null;
  return {
    partIndex: Number.parseInt(match[1]!, 10),
    measureIndex: Number.parseInt(match[2]!, 10),
    clefIndex: match[3] === undefined ? 0 : Number.parseInt(match[3], 10),
  };
}

export function isClefElementId(elementId: string): boolean {
  return parseClefElementId(elementId) !== null;
}
