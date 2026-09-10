import { useMemo } from "react";
import { CascadingMenu, PanelFooter, type CascadingMenuItem } from "@viritura/ui";
import type { Part, PartDisplayInfo } from "@viritura/core";
import styles from "./AddScoreButton.module.css";

export interface AddScoreButtonProps {
  parts: readonly Part[];
  partDisplayMap: Map<string, PartDisplayInfo>;
  onAddScore: (type: "full" | "condensed" | "custom" | "part", partId?: string) => void;
  /** Open the multi-select picker to build a new section score. */
  onAddSectionScore?: () => void;
}

export function AddScoreButton({ parts, partDisplayMap, onAddScore, onAddSectionScore }: AddScoreButtonProps) {
  const items = useMemo<CascadingMenuItem[]>(() => {
    const scoreTypes: CascadingMenuItem[] = [
      { id: "full", label: "Full score", onSelect: () => onAddScore("full") },
      { id: "condensed", label: "Condensed score", onSelect: () => onAddScore("condensed") },
      { id: "custom", label: "Custom score", onSelect: () => onAddScore("custom") },
    ];
    if (onAddSectionScore) {
      scoreTypes.push({ id: "section", label: "Section score", onSelect: onAddSectionScore });
    }

    const partScores = parts.map((part, index) => {
      const partId = part.id ?? "";
      const info = partDisplayMap.get(partId);
      return {
        id: partId || `part-${index}`,
        label: info?.displayName ?? part.name ?? partId,
        onSelect: () => onAddScore("part", part.id),
      };
    });

    return partScores.length === 0
      ? scoreTypes
      : [
          ...scoreTypes,
          { id: "score-type-separator", separator: true },
          { id: "part", label: "Instrumental part", children: partScores },
        ];
  }, [onAddScore, onAddSectionScore, partDisplayMap, parts]);

  return (
    <PanelFooter>
      <CascadingMenu
        ariaLabel="Add score"
        className={styles.trigger}
        label="Add score"
        items={items}
        triggerSize="sm"
      />
    </PanelFooter>
  );
}
