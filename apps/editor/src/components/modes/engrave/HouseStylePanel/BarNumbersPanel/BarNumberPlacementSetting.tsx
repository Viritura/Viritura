import { FormField, MultiSelectPopover, type MultiSelectPopoverGroup } from "@viritura/ui";
import type { BarNumberSettings } from "@viritura/core";
import type { BracketPlacement } from "./bracketPlacements";
import { bracketMatchesSelection } from "./bracketPlacements";

type SystemPlacement = NonNullable<BarNumberSettings["placements"]>[number];

interface BarNumberPlacementSettingProps {
  scope: "document" | "layout";
  placements: SystemPlacement[];
  aboveGroups?: string[][];
  groups: BracketPlacement[];
  onChange: (changes: Partial<Pick<BarNumberSettings, "placements" | "aboveGroups">>) => void;
}

const SYSTEM_PLACEMENT_OPTIONS = [
  { value: "system:aboveSystem", placement: "aboveSystem", label: "Above the whole system" },
  { value: "system:belowSystem", placement: "belowSystem", label: "Below the whole system" },
] as const satisfies readonly {
  value: string;
  placement: SystemPlacement;
  label: string;
}[];

function bracketSelectionValue(parts: string[], index: number): string {
  return `bracket:${JSON.stringify(parts)}:${index}`;
}

export function BarNumberPlacementSetting({
  scope,
  placements,
  aboveGroups,
  groups,
  onChange,
}: BarNumberPlacementSettingProps) {
  const placementGroups: MultiSelectPopoverGroup[] = [
    { label: "System", options: SYSTEM_PLACEMENT_OPTIONS },
    ...(scope === "layout" && groups.length
      ? [
          {
            label: "Bracket groups",
            options: groups.map((group, index) => ({
              value: bracketSelectionValue(group.parts, index),
              label: `Above ${group.label} bracket`,
            })),
          },
        ]
      : []),
  ];
  const selectedValues = [
    ...placements.map((placement) => `system:${placement}`),
    ...(scope === "layout"
      ? groups.flatMap((group, index) =>
          aboveGroups?.some((parts) => bracketMatchesSelection(group, parts))
            ? [bracketSelectionValue(group.parts, index)]
            : [],
        )
      : []),
  ];

  function handleValueChange(selected: string[]) {
    const changes: Partial<Pick<BarNumberSettings, "placements" | "aboveGroups">> = {};
    const nextPlacements: SystemPlacement[] = selected.flatMap((value) => {
      const option = SYSTEM_PLACEMENT_OPTIONS.find((entry) => entry.value === value);
      return option ? [option.placement] : [];
    });
    const systemChanged =
      placements.length !== nextPlacements.length ||
      placements.some((placement) => !nextPlacements.includes(placement));
    if (systemChanged) changes.placements = nextPlacements;

    if (scope === "layout") {
      const bracketChanged = groups.some((group, index) => {
        const wasSelected = aboveGroups?.some((parts) => bracketMatchesSelection(group, parts)) ?? false;
        return wasSelected !== selected.includes(bracketSelectionValue(group.parts, index));
      });
      if (bracketChanged) {
        const nextAboveGroups = (aboveGroups ?? []).filter((parts) => {
          const index = groups.findIndex((group) => bracketMatchesSelection(group, parts));
          const group = groups[index];
          return !group || selected.includes(bracketSelectionValue(group.parts, index));
        });
        groups.forEach((group, index) => {
          if (
            selected.includes(bracketSelectionValue(group.parts, index)) &&
            !aboveGroups?.some((parts) => bracketMatchesSelection(group, parts))
          ) {
            nextAboveGroups.push(group.parts);
          }
        });
        changes.aboveGroups = nextAboveGroups;
      }
    }

    if (Object.keys(changes).length) onChange(changes);
  }

  return (
    <FormField label="Placement">
      <MultiSelectPopover
        ariaLabel="Placement"
        value={selectedValues}
        groups={placementGroups}
        onValueChange={handleValueChange}
      />
    </FormField>
  );
}
