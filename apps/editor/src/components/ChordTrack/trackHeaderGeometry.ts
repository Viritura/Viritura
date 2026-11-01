export interface TrackHeaderGeometry {
  left: number;
  right: number;
  width: number;
  buttonSize: number;
}

export function trackHeaderGeometry(
  firstBarX: number,
  scale: number,
  sticky: boolean,
  leftInset = 0,
): TrackHeaderGeometry {
  const buttonSize = Math.max(24, 18 * scale);
  const width = 70 * scale + buttonSize;
  const naturalLeft = firstBarX - width;
  const left = sticky ? Math.max(naturalLeft, leftInset + 8) : naturalLeft;
  return { left, right: left + width, width, buttonSize };
}
