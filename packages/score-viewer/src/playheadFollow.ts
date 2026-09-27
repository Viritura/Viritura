export function followOffset(
  coordinate: number,
  extent: number,
  scroll: number,
  viewport: number,
  fraction: number,
): number {
  if (coordinate >= scroll && coordinate + extent <= scroll + viewport) return scroll;
  return Math.max(0, coordinate - viewport * fraction);
}
