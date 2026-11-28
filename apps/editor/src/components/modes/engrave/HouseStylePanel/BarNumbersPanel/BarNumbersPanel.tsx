import { useState } from "react";
import { Info } from "lucide-react";
import { Button, ButtonGroup, Checkbox, FormField, FormInput, type ButtonGroupOption } from "@viritura/ui";
import {
  DEFAULT_BAR_NUMBER_SETTINGS,
  DEFAULT_PAGE_SETUP,
  DEFAULT_TEXT_STYLES,
  resolveScorePageSetup,
  type BarNumberSettings,
  type BarNumberTextStyle,
} from "@viritura/core";
import { toast } from "sonner";
import { TextStyleToolbar } from "../../../../inspector/TextContentEditor";
import { useDocumentStore, useDocumentStoreApi } from "../../../../../store/DocumentContext";
import { useViewStateStore } from "../../../../../store/viewStateStore";
import styles from "./BarNumbersPanel.module.css";
import { bracketPlacements } from "./bracketPlacements";
import { BarNumberPlacementSetting } from "./BarNumberPlacementSetting";
import { EnclosureChoice, HorizontalAlignmentChoice } from "./BarNumberStyleChoices";
import { effectiveBarNumberStyle, updateBarNumberStyle } from "./barNumberStyle";
import { applyBarNumberPreset, type BarNumberPreset } from "./barNumberPresets";

const FREQUENCY_OPTIONS = [
  { value: "systemStarts", label: "Systems", tooltip: "First bar of each system" },
  { value: "everyBar", label: "Every bar" },
  { value: "hidden", label: "Hidden" },
] satisfies ButtonGroupOption<Required<BarNumberSettings>["frequency"]>[];

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

interface BarNumbersPanelProps {
  /** House style settings, or the selected layout's own overrides. */
  scope: "document" | "layout";
}

export function BarNumbersPanel({ scope: requestedScope }: BarNumbersPanelProps) {
  const score = useDocumentStore((state) => state.workingScore ?? state.score);
  const store = useDocumentStoreApi();
  const scoreIndex = useViewStateStore((state) => state.selectedScoreIndex);
  const definition = score?.scores?.[scoreIndex];
  const scope = definition ? requestedScope : "document";
  const numberStyle = score ? effectiveBarNumberStyle(score, scoreIndex, scope) : DEFAULT_TEXT_STYLES.barNumber!;
  const spatiumMm = score ? resolveScorePageSetup(score, scoreIndex).spatiumMm : DEFAULT_PAGE_SETUP.spatiumMm;
  const settings = {
    ...DEFAULT_BAR_NUMBER_SETTINGS,
    ...score?.barNumbers,
    ...(scope === "layout" ? definition?.barNumbers : {}),
  };
  const choiceSettings = { ...settings, ...numberStyle };
  const selectedPlacements =
    scope === "layout" &&
    definition?.barNumbers?.placement !== undefined &&
    definition.barNumbers.placements === undefined
      ? [definition.barNumbers.placement]
      : (settings.placements ?? [settings.placement]);
  const placements = [
    ...new Set(selectedPlacements.map((placement) => (placement === "belowTopInstrument" ? "belowSystem" : placement))),
  ];
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
  function updateStyle(changes: Partial<BarNumberTextStyle>) {
    const current = store.getState().workingScore ?? store.getState().score;
    if (!current) {
      toast.error("Open a score before changing its bar-number style.");
      return;
    }
    if (scope === "layout" && !current.scores?.[scoreIndex]) {
      toast.error("Select a score layout before changing its bar-number style.");
      return;
    }
    store.getState().updateScore(updateBarNumberStyle(current, scoreIndex, scope, changes));
  }
  function applyPreset(preset: BarNumberPreset) {
    const document = store.getState();
    const current = document.workingScore ?? document.score;
    if (!current) {
      toast.error("Open a score before applying a bar-number preset.");
      return;
    }
    if (scope === "layout" && !current.scores?.[scoreIndex]) {
      toast.error("Select a score layout before applying a bar-number preset.");
      return;
    }
    document.updateScore(applyBarNumberPreset(current, scoreIndex, scope, preset));
  }
  function resetStyleAndSettings() {
    if (scope === "layout") {
      commit(undefined);
      return;
    }
    const current = store.getState().workingScore ?? store.getState().score;
    if (!current) {
      toast.error("Open a score before resetting its bar-number style.");
      return;
    }
    const textStyles = { ...(current.textStyles ?? {}) };
    delete textStyles.barNumber;
    store.getState().updateScore({
      ...current,
      barNumbers: undefined,
      textStyles: Object.keys(textStyles).length ? textStyles : undefined,
    });
  }
  return (
    <div className={styles.root} data-testid="bar-numbers-panel">
      {scope === "layout" && (
        <p className={styles.scopeNote}>
          {definition?.barNumbers
            ? `${definition.name ?? "This layout"} has its own bar number settings.`
            : `${definition?.name ?? "This layout"} follows the house style. Changes here apply only to this layout.`}
        </p>
      )}
      <FormField label="Presets">
        <div className={styles.presets}>
          <Button size="sm" variant="default" onClick={() => applyPreset("classical")}>
            Classical
          </Button>
          <Button size="sm" variant="default" onClick={() => applyPreset("film")}>
            Film score
          </Button>
        </div>
      </FormField>
      <FormField label="Frequency">
        <ButtonGroup
          options={FREQUENCY_OPTIONS}
          value={settings.frequency}
          onChange={(value) => update("frequency", value)}
        />
      </FormField>
      <Checkbox
        label="Show on first bar"
        checked={settings.showFirst}
        onChange={(event) => update("showFirst", event.target.checked)}
      />
      <BarNumberPlacementSetting
        scope={scope}
        placements={placements}
        aboveGroups={settings.aboveGroups}
        groups={groups}
        onChange={(changes) => {
          const current = store.getState().workingScore ?? store.getState().score;
          const stored = scope === "document" ? current?.barNumbers : current?.scores?.[scoreIndex]?.barNumbers;
          commit({ ...stored, ...changes });
        }}
      />
      <div className={styles.verticalAlignment}>
        <FormField
          label="Bar number vertical alignment"
          action={
            <Button
              variant="ghost"
              size="sm"
              shape="icon"
              ariaLabel="About bar number vertical alignment"
              tooltip="Follow musical content lets numbers move to clear nearby markings. Reserve separate space creates a staff-like row to align the numbers and keep room for them, whether its line is shown or hidden."
            >
              <Info size={14} />
            </Button>
          }
        >
          <ButtonGroup
            options={[
              { value: "content", label: "Follow musical content" },
              { value: "separate", label: "Reserve separate space" },
            ]}
            value={settings.onStaff ? "separate" : "content"}
            onChange={(value) => update("onStaff", value === "separate")}
          />
        </FormField>
        {settings.onStaff && (
          <Checkbox
            label="Show staff line"
            checked={settings.showStaffLine}
            onChange={(event) => update("showStaffLine", event.target.checked)}
          />
        )}
      </div>
      <HorizontalAlignmentChoice settings={choiceSettings} onChange={(value) => update("horizontalAlignment", value)} />
      <NumberSetting
        key={`distance:${scope}:${scoreIndex}`}
        label="Distance from staff (staff spaces)"
        name="Bar number distance"
        value={settings.distance}
        min={0}
        error="Bar number distance must be a finite, non-negative number of staff spaces."
        onCommit={(value) => update("distance", value)}
      />
      <TextStyleToolbar
        mode="role"
        activeStyle={numberStyle}
        spatiumMm={spatiumMm}
        minSizeSp={0.5}
        maxSizeSp={8}
        onApplyStyle={updateStyle}
        onInvalidSize={(min, max) => toast.error(`Bar number size must be between ${min} and ${max} pt.`)}
      />
      <EnclosureChoice settings={choiceSettings} onChange={(value) => update("enclosure", value)} />
      <Button variant="default" size="sm" fullWidth onClick={resetStyleAndSettings}>
        {scope === "layout" ? "Use house style bar numbers" : "Reset bar number house style"}
      </Button>
    </div>
  );
}
