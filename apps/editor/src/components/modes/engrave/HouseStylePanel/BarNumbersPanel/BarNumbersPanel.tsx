import { useState } from "react";
import { Button, Checkbox, FormField, FormInput, Select } from "@viritura/ui";
import { DEFAULT_BAR_NUMBER_SETTINGS, type BarNumberSettings } from "@viritura/core";
import { toast } from "sonner";
import { useDocumentStore, useDocumentStoreApi } from "../../../../../store/DocumentContext";
import { useViewStateStore } from "../../../../../store/viewStateStore";
import styles from "./BarNumbersPanel.module.css";
import { bracketMatchesSelection, bracketPlacements } from "./bracketPlacements";

interface ChoiceProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}

function Choice<T extends string>({ label, value, options, onChange }: ChoiceProps<T>) {
  return (
    <FormField label={label}>
      <Select
        aria-label={label}
        value={value}
        options={options}
        onValueChange={(next) => {
          const option = options.find((entry) => entry.value === next);
          if (option) onChange(option.value);
        }}
      />
    </FormField>
  );
}

interface NumberSettingProps {
  label: string;
  name: string;
  value: number;
  min: number;
  max?: number;
  error: string;
  onCommit: (value: number) => void;
}

function NumberSetting({ label, name, value, min, max, error, onCommit }: NumberSettingProps) {
  const [draft, setDraft] = useState(String(value));
  const [previous, setPrevious] = useState(value);
  if (previous !== value) {
    setPrevious(value);
    setDraft(String(value));
  }
  return (
    <FormField label={label}>
      <FormInput
        aria-label={name}
        type="number"
        min={min}
        max={max}
        step={0.25}
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => {
          const parsed = Number(draft);
          if (!draft.trim() || !Number.isFinite(parsed) || parsed < min || (max !== undefined && parsed > max)) {
            toast.error(error);
            setDraft(String(value));
            return;
          }
          if (parsed !== value) onCommit(parsed);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setDraft(String(value));
        }}
      />
    </FormField>
  );
}

export function BarNumbersPanel() {
  const score = useDocumentStore((state) => state.score);
  const store = useDocumentStoreApi();
  const scoreIndex = useViewStateStore((state) => state.selectedScoreIndex);
  const [requestedScope, setScope] = useState<"document" | "layout">("document");
  const definition = score?.scores?.[scoreIndex];
  const scope = definition ? requestedScope : "document";
  const settings = {
    ...DEFAULT_BAR_NUMBER_SETTINGS,
    ...score?.barNumbers,
    ...(scope === "layout" ? definition?.barNumbers : {}),
  };
  const selectedPlacements =
    scope === "layout" &&
    definition?.barNumbers?.placement !== undefined &&
    definition.barNumbers.placements === undefined
      ? [definition.barNumbers.placement]
      : (settings.placements ?? [settings.placement]);
  const groups = bracketPlacements(score, scoreIndex);
  function commit(next: BarNumberSettings | undefined) {
    const document = store.getState();
    const current = document.workingScore ?? document.score;
    if (!current) {
      toast.error("Open a score before changing its bar numbers.");
      return;
    }
    if (scope === "document") {
      document.updateScore({ ...current, barNumbers: next });
      return;
    }
    const currentScores = current.scores;
    const view = currentScores?.[scoreIndex];
    if (!currentScores || !view) {
      toast.error("Select a score layout before changing its bar numbers.");
      return;
    }
    const scores = [...currentScores];
    scores[scoreIndex] = { ...view, barNumbers: next };
    document.updateScore({ ...current, scores });
  }
  function update<K extends keyof BarNumberSettings>(field: K, value: BarNumberSettings[K]) {
    const current = store.getState().workingScore ?? store.getState().score;
    const stored = scope === "document" ? current?.barNumbers : current?.scores?.[scoreIndex]?.barNumbers;
    commit({ ...stored, [field]: value });
  }
  return (
    <div className={styles.root} data-testid="bar-numbers-panel">
      <Choice
        label="Apply to"
        value={scope}
        options={[
          { value: "document", label: "House style (all layouts)" },
          ...(definition ? [{ value: "layout" as const, label: `Current layout: ${definition.name ?? "score"}` }] : []),
        ]}
        onChange={setScope}
      />
      <Choice
        label="Frequency"
        value={settings.frequency}
        options={[
          { value: "systemStarts", label: "System starts" },
          { value: "everyBar", label: "Every bar" },
          { value: "hidden", label: "Hidden" },
        ]}
        onChange={(value) => update("frequency", value)}
      />
      <FormField label="Placement (select any)">
        <div>
          {(
            [
              ["aboveSystem", "Above the whole system"],
              ["belowSystem", "Below the whole system"],
              ["belowTopInstrument", "Below the top instrument"],
            ] as const
          ).map(([value, label]) => (
            <Checkbox
              key={value}
              label={label}
              checked={selectedPlacements.includes(value)}
              onChange={(event) =>
                update(
                  "placements",
                  event.target.checked
                    ? [...selectedPlacements, value]
                    : selectedPlacements.filter((placement) => placement !== value),
                )
              }
            />
          ))}
          {scope === "layout" &&
            groups.map((group) => (
              <Checkbox
                key={JSON.stringify(group.parts)}
                label={`Above ${group.label} bracket`}
                checked={settings.aboveGroups?.some((parts) => bracketMatchesSelection(group, parts)) ?? false}
                onChange={(event) => {
                  const selected = settings.aboveGroups ?? [];
                  update(
                    "aboveGroups",
                    event.target.checked
                      ? [...selected, group.parts]
                      : selected.filter((parts) => !bracketMatchesSelection(group, parts)),
                  );
                }}
              />
            ))}
        </div>
      </FormField>
      <Checkbox
        label="Reserve a bar-number row"
        checked={settings.onStaff}
        onChange={(event) => update("onStaff", event.target.checked)}
      />
      {settings.onStaff && (
        <Checkbox
          label="Show staff line"
          checked={settings.showStaffLine}
          onChange={(event) => update("showStaffLine", event.target.checked)}
        />
      )}
      <Choice
        label="Horizontal alignment"
        value={settings.horizontalAlignment}
        options={[
          { value: "barline", label: "Aligned with barline" },
          { value: "center", label: "Centered within bar" },
        ]}
        onChange={(value) => update("horizontalAlignment", value)}
      />
      <NumberSetting
        key={`distance:${scope}:${scoreIndex}`}
        label="Distance from staff (staff spaces)"
        name="Bar number distance"
        value={settings.distance}
        min={0}
        error="Bar number distance must be a finite, non-negative number of staff spaces."
        onCommit={(value) => update("distance", value)}
      />
      <Checkbox
        label="Show bar 1"
        checked={settings.showFirst}
        onChange={(event) => update("showFirst", event.target.checked)}
      />
      <Choice
        label="Font family"
        value={settings.family}
        options={[
          { value: "serif", label: "Serif" },
          { value: "sans-serif", label: "Sans serif" },
          { value: "monospace", label: "Monospace" },
        ]}
        onChange={(value) => update("family", value)}
      />
      <NumberSetting
        key={`size:${scope}:${scoreIndex}`}
        label="Size (staff spaces)"
        name="Bar number size"
        value={settings.size}
        min={0.5}
        max={8}
        error="Bar number size must be between 0.5 and 8 staff spaces."
        onCommit={(value) => update("size", value)}
      />
      <Checkbox label="Bold" checked={settings.bold} onChange={(event) => update("bold", event.target.checked)} />
      <Checkbox label="Italic" checked={settings.italic} onChange={(event) => update("italic", event.target.checked)} />
      <Choice
        label="Enclosure"
        value={settings.enclosure}
        options={[
          { value: "none", label: "None" },
          { value: "box", label: "Box" },
          { value: "circle", label: "Circle" },
        ]}
        onChange={(value) => update("enclosure", value)}
      />
      <Button variant="ghost" onClick={() => commit(undefined)}>
        {scope === "layout" ? "Reset layout overrides" : "Reset bar number house style"}
      </Button>
      <p className={styles.description}>
        {scope === "layout"
          ? "Only edited fields override the house style. Other layouts are unchanged."
          : "Layouts inherit these defaults unless they have their own overrides."}{" "}
        Bar 0 is never printed. Distance is a minimum: musical markings may require more clearance. A reserved row keeps
        numbers vertically aligned and clears space even when its line is hidden. Otherwise, numbers follow the local
        musical content. Bracket choices are specific to the current layout.
        {!definition && " Create a layout in the Layouts tab to add layout-specific overrides."}
      </p>
    </div>
  );
}
