import { useMemo } from "react";
import { NavigationDial } from "./NavigationDial";
import { describeClickBar, type ClickDialProps } from "./barNavigation";

export function BarDial({ bars, ...props }: ClickDialProps) {
  const entries = useMemo(
    () =>
      bars.map((bar) => ({
        id: `${bar.measureIndex}-${bar.visit}`,
        label: String(bar.number),
        description: `${describeClickBar(bar)}${bar.rehearsal ? `, rehearsal ${bar.rehearsal}` : ""}`,
        detail: `${bar.visitCount > 1 ? `${bar.visit}/${bar.visitCount}` : ""}${bar.startable ? "" : " partial"}`,
        startable: bar.startable,
      })),
    [bars],
  );
  return <NavigationDial {...props} entries={entries} label="Start bar" />;
}
