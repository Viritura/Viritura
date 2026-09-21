export interface SelectionPlaybackStatus {
  readonly badgeText: string;
  readonly accessibleDescription: string;
}

export function selectionPlaybackStatus(staffCount: number | null): SelectionPlaybackStatus | null {
  if (staffCount === null) return null;
  const staffLabel = staffCount === 1 ? "staff" : "staves";
  return {
    badgeText: `${staffCount} selected ${staffLabel}`,
    accessibleDescription: `Playback limited to ${staffCount} selected ${staffLabel}.`,
  };
}
