import { useMemo } from "react";
import { NavigationDial } from "./NavigationDial";
import { describeClickBar, type ClickDialProps } from "./barNavigation";

export function RehearsalDial({ bars, index, onSelect, ...props }: ClickDialProps) {
  const rehearsals = useMemo(
    () =>
      bars.flatMap((bar, barIndex) =>
        bar.rehearsal
          ? [
              {
                barIndex,
                id: `${bar.measureIndex}-${bar.visit}`,
                label: bar.rehearsal,
                description: `Rehearsal ${bar.rehearsal}, ${describeClickBar(bar)}`,
                detail: `${bar.number}${bar.visitCount > 1 ? ` (${bar.visit}/${bar.visitCount})` : ""}${bar.startable ? "" : " partial"}`,
                startable: bar.startable,
              },
            ]
          : [],
      ),
    [bars],
  );
  const selectable = useMemo(() => rehearsals.some((entry) => entry.startable), [rehearsals]);
  if (!selectable) return null;

  let low = 0;
  let high = rehearsals.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (rehearsals[middle]!.barIndex <= index) low = middle + 1;
    else high = middle;
  }
  return (
    <NavigationDial
      {...props}
      entries={rehearsals}
      label="Rehearsal"
      index={low - 1}
      onSelect={(next) => onSelect(rehearsals[next]!.barIndex)}
    />
  );
}
