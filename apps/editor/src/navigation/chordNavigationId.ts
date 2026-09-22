import { canonicalChordSymbolId } from "../score/ElementPath";

export { chordSymbolId as globalChordNavigationId } from "../score/ElementPath";

export function canonicalNavigationId(elementId: string): string {
  return canonicalChordSymbolId(elementId) ?? elementId;
}

/** Keep a rendered staff identity only when cycling harmony within its measure. */
export function retainChordNavigationCopy(currentId: string, targetId: string): string {
  const source = currentId.match(/^(m\d+)\/chord\d+(\/p\d+\/staff\d+)$/);
  const target = targetId.match(/^(m\d+)\/chord\d+$/);
  return source && target && source[1] === target[1] ? `${targetId}${source[2]}` : targetId;
}

export function chordCopyPartIndex(elementId: string): number | undefined {
  const match = elementId.match(/^m\d+\/chord\d+\/p(\d+)\/staff\d+$/);
  return match ? Number(match[1]) : undefined;
}
