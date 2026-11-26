import { useMemo } from "react";
import { NavigationDial } from "./NavigationDial";
import {
  describeClickBar,
  isClickLandmark,
  type ClickBar,
  type ClickDialEntry,
  type ClickDialProps,
} from "./barNavigation";

interface LandmarkEntry extends ClickDialEntry {
  readonly barIndex: number;
}

function landmarkEntry(bar: ClickBar, barIndex: number): LandmarkEntry | undefined {
  if (!isClickLandmark(bar)) return undefined;
  const barDetail = `${bar.number}${bar.visitCount > 1 ? ` (${bar.visit}/${bar.visitCount})` : ""}${bar.startable ? "" : " partial"}`;
  const tempo = bar.tempoName ? `Tempo ${bar.tempoName}${bar.tempoNameWithinBar ? " within the bar" : ""}` : "";
  const rehearsal = bar.rehearsal ? `Rehearsal ${bar.rehearsal}` : "";
  return {
    barIndex,
    id: `${bar.measureIndex}-${bar.visit}`,
    label: bar.rehearsal ?? bar.tempoName!,
    kind: bar.rehearsal ? "mark" : "text",
    description: `${[rehearsal, tempo].filter(Boolean).join(", ")}, ${describeClickBar(bar)}`,
    detail: bar.rehearsal && bar.tempoName ? `${bar.tempoName} · ${barDetail}` : barDetail,
    startable: bar.startable,
  };
}

/** Upper track: rehearsal marks and named tempo changes, adjacent regardless of the bars between them. */
export function RehearsalDial({ bars, index, onSelect, ...props }: ClickDialProps) {
  const landmarks = useMemo(() => bars.flatMap((bar, barIndex) => landmarkEntry(bar, barIndex) ?? []), [bars]);
  const selectable = useMemo(() => landmarks.some((entry) => entry.startable), [landmarks]);
  if (!selectable) return null;

  let low = 0;
  let high = landmarks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (landmarks[middle]!.barIndex <= index) low = middle + 1;
    else high = middle;
  }
  return (
    <NavigationDial
      {...props}
      entries={landmarks}
      label="Rehearsal"
      index={low - 1}
      onSelect={(next) => onSelect(landmarks[next]!.barIndex)}
    />
  );
}
