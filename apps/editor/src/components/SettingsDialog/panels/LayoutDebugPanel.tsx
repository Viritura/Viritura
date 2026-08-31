import { Checkbox, PanelActionButton, SectionLabel, SettingsRow, Switch } from "@viritura/ui";
import { Layers } from "lucide-react";
import { useLayoutDebugStore, type LayoutDebugCategories } from "../../../debug/layoutDebugStore";
import styles from "./LayoutDebugPanel.module.css";

const LAYOUT_DEBUG_CATEGORIES: Array<{ key: keyof LayoutDebugCategories; label: string }> = [
  { key: "systemBboxes", label: "System bboxes" },
  { key: "staffLines", label: "Staff top/bottom" },
  { key: "aboveBelowExtras", label: "Above/below extras" },
  { key: "interSystemGaps", label: "Inter-system gaps" },
  { key: "staffPairGaps", label: "Staff-pair gaps" },
  { key: "measureExtremes", label: "Per-measure extremes" },
  { key: "noteSpacing", label: "Note spacing" },
  { key: "placementBoxes", label: "Placement boxes" },
  { key: "labels", label: "Labels" },
  { key: "pageFill", label: "Page fill state" },
];

export function LayoutDebugPanel() {
  const enabled = useLayoutDebugStore((s) => s.enabled);
  const categories = useLayoutDebugStore((s) => s.categories);
  const setEnabled = useLayoutDebugStore((s) => s.setEnabled);
  const toggleCategory = useLayoutDebugStore((s) => s.toggleCategory);
  const setAllCategories = useLayoutDebugStore((s) => s.setAllCategories);

  return (
    <>
      <SettingsRow label="Spacing overlay" description="Draw the engraving engine's measurement guides over the score.">
        {({ controlId, descriptionId }) => (
          <Switch id={controlId} aria-describedby={descriptionId} checked={enabled} onCheckedChange={setEnabled} />
        )}
      </SettingsRow>

      {/* Checkboxes rather than switches: these are a multi-select set scoped
          to the overlay above, not independent instant-apply settings. */}
      <div className={styles.categorySection}>
        <div className={styles.categoryHeader}>
          <SectionLabel className={styles.categoryLabel} label="Categories" icon={<Layers size={13} />} />
          <span className={styles.categoryActions}>
            <PanelActionButton onClick={() => setAllCategories(true)} disabled={!enabled}>
              All
            </PanelActionButton>
            <PanelActionButton onClick={() => setAllCategories(false)} disabled={!enabled}>
              None
            </PanelActionButton>
          </span>
        </div>

        <div className={styles.categoryGrid} data-disabled={!enabled ? "true" : undefined}>
          {LAYOUT_DEBUG_CATEGORIES.map(({ key, label }) => (
            <Checkbox
              key={key}
              checked={categories[key]}
              disabled={!enabled}
              onChange={() => toggleCategory(key)}
              label={label}
            />
          ))}
        </div>
      </div>
    </>
  );
}
