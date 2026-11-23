export interface RecordingCueInput {
  /** Rehearsal mark text at the start bar, if any (e.g. "O"). */
  readonly rehearsal?: string;
  /** Displayed bar number of the start bar. */
  readonly measureNumber: number | string;
  readonly countoffClicks: number;
}

/** Plain-language summary of what Play will do, e.g. "Rehearsal O, 4 clicks free". */
export function describeRecordingCue({ rehearsal, measureNumber, countoffClicks }: RecordingCueInput): string {
  const place = rehearsal?.trim() ? `Rehearsal ${rehearsal.trim()}` : `Bar ${measureNumber}`;
  if (countoffClicks <= 0) return `${place}, no countoff`;
  return `${place}, ${countoffClicks} ${countoffClicks === 1 ? "click" : "clicks"} free`;
}
