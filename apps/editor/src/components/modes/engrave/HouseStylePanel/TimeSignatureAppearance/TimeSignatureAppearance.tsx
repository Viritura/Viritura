import { useCallback, useState } from "react";
import { Collapsible, FormField, FormInput, Select } from "@viritura/ui";
import type {
  TimeSignatureDistribution,
  TimeSignatureGrandStaff,
  TimeSignaturePosition,
  SenzaMisuraDisplay,
  TimeSignatureSettings,
} from "@viritura/core";
import { useDocumentStore, useDocumentStoreApi } from "../../../../../store/DocumentContext";
import {
  DISTRIBUTION_OPTIONS,
  descriptionForPreset,
  GRAND_STAFF_OPTIONS,
  POSITION_OPTIONS,
  presetFor,
  RENDER_STYLE_OPTIONS,
  SENZA_MISURA_OPTIONS,
  setSettings,
  settingsFor,
  settingsForPreset,
  TIME_SIGNATURE_PRESETS,
  type TimeSignatureScope,
} from "./timeSignatureAppearanceModel";
import { TimeSignaturePresetCard } from "./TimeSignaturePresetCard";
import { NumeralDesignCard } from "./NumeralDesignCard";
import styles from "./TimeSignatureAppearance.module.css";

const SCOPE_OPTIONS = [
  { value: "score", label: "Full scores" },
  { value: "parts", label: "Parts" },
] as const;

const MIN_SCALE = 0.5;
const MAX_SCALE = 12;
const SCALE_STEP = 0.25;

function formatScale(value: number): string {
  return String(Number(value.toFixed(2)));
}

interface ScaleInputProps {
  value: number;
  onCommit: (value: number) => void;
}

/** Buffer typing locally and publish one re-layout only on blur or Enter. */
function ScaleInput({ value, onCommit }: ScaleInputProps) {
  const [draft, setDraft] = useState(formatScale(value));
  const [previousValue, setPreviousValue] = useState(value);
  if (previousValue !== value) {
    setPreviousValue(value);
    setDraft(formatScale(value));
  }

  const commit = () => {
    const parsed = Number(draft);
    if (!draft.trim() || !Number.isFinite(parsed)) {
      setDraft(formatScale(value));
      return;
    }
    const snapped = Math.round(parsed / SCALE_STEP) * SCALE_STEP;
    const constrained = Math.min(MAX_SCALE, Math.max(MIN_SCALE, snapped));
    setDraft(formatScale(constrained));
    if (constrained !== value) onCommit(constrained);
  };

  return (
    <div className={styles.scaleControl}>
      <FormInput
        type="number"
        min={MIN_SCALE}
        max={MAX_SCALE}
        step={SCALE_STEP}
        value={draft}
        aria-label="Time signature scale"
        className={styles.scaleInput}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(formatScale(value));
          }
        }}
      />
      <span className={styles.scaleSuffix}>×</span>
    </div>
  );
}

/**
 * Live time-signature appearance editor for Engrave mode's House Style panel.
 *
 * The shared score canvas stays visible beside this panel. The scope selector
 * chooses which document defaults are edited; the score switcher in Engrave's
 * toolbar chooses the full score or part layout being previewed.
 */
export function TimeSignatureAppearance() {
  const score = useDocumentStore((state) => state.score);
  const store = useDocumentStoreApi();
  const [scope, setScope] = useState<TimeSignatureScope>("score");
  const settings = settingsFor(score?.timeSignatures, scope);
  const preset = presetFor(settings);
  const groupDistribution = settings.distribution === "perGroup";

  const commitSettings = useCallback(
    (nextSettings: Required<TimeSignatureSettings>) => {
      const current = store.getState().workingScore;
      if (!current) return;
      const next = setSettings(current.timeSignatures, scope, nextSettings);
      store.getState().updateScore({
        ...current,
        timeSignatures: Object.keys(next).length > 0 ? next : undefined,
      });
    },
    [scope, store],
  );

  const commitField = useCallback(
    <K extends keyof Required<TimeSignatureSettings>>(field: K, value: Required<TimeSignatureSettings>[K]) => {
      const current = store.getState().workingScore;
      if (!current) return;
      const currentSettings = settingsFor(current.timeSignatures, scope);
      const nextSettings = {
        ...currentSettings,
        [field]: value,
      };
      commitSettings(nextSettings);
    },
    [commitSettings, scope, store],
  );

  if (!score) return null;

  return (
    <div className={styles.root}>
      <p className={styles.previewHint}>
        Changes engrave live on the score. Use the score switcher above the canvas to preview a full score or a part.
      </p>

      <FormField label="Apply to">
        <Select
          aria-label="Time signature appearance scope"
          value={scope}
          options={SCOPE_OPTIONS}
          onValueChange={(value) => setScope(value as TimeSignatureScope)}
        />
      </FormField>

      <div className={styles.presetGrid} role="radiogroup" aria-label="Time signature style">
        {TIME_SIGNATURE_PRESETS.map((presetOption) => (
          <TimeSignaturePresetCard
            key={presetOption.id}
            preset={presetOption}
            selected={preset === presetOption.id}
            onSelect={(id) => {
              const presetSettings = settingsForPreset(id);
              if (presetSettings) commitSettings(presetSettings);
            }}
          />
        ))}
      </div>
      <p className={styles.presetDescription}>{descriptionForPreset(preset)}</p>

      <Collapsible title="Advanced" className={styles.advanced}>
        <div className={styles.advancedFields}>
          <div className={styles.numeralGrid} role="radiogroup" aria-label="Time signature numeral design">
            {RENDER_STYLE_OPTIONS.map((design) => (
              <NumeralDesignCard
                key={design.value}
                design={design}
                selected={settings.renderStyle === design.value}
                onSelect={(value) => commitField("renderStyle", value)}
              />
            ))}
          </div>

          <FormField label="Distribution">
            <Select
              aria-label="Time signature distribution"
              value={settings.distribution}
              options={DISTRIBUTION_OPTIONS}
              onValueChange={(value) => commitField("distribution", value as TimeSignatureDistribution)}
            />
          </FormField>

          <FormField label="Grand staves">
            <Select
              aria-label="Time signature grand staff behavior"
              disabled={!groupDistribution}
              value={settings.grandStaff}
              options={GRAND_STAFF_OPTIONS}
              onValueChange={(value) => commitField("grandStaff", value as TimeSignatureGrandStaff)}
            />
          </FormField>

          <FormField label="Vertical position">
            <Select
              aria-label="Time signature vertical position"
              value={settings.position}
              options={POSITION_OPTIONS}
              onValueChange={(value) => commitField("position", value as TimeSignaturePosition)}
            />
          </FormField>

          <FormField label="Scale">
            <ScaleInput value={settings.scale} onCommit={(value) => commitField("scale", value)} />
            {settings.renderStyle === "outsideStaff" && (
              <span className={styles.scaleHint}>Film-score group meters commonly use 6–10×.</span>
            )}
          </FormField>
          <FormField label="Open meter">
            <Select
              aria-label="Senza misura display"
              value={settings.senzaMisura}
              options={SENZA_MISURA_OPTIONS}
              onValueChange={(value) => commitField("senzaMisura", value as SenzaMisuraDisplay)}
            />
          </FormField>
        </div>
      </Collapsible>
    </div>
  );
}
