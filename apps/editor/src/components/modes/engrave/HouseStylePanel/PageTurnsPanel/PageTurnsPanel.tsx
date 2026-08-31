import { useCallback, useState } from "react";
import { Checkbox, FormField, FormInput, Select } from "@viritura/ui";
import {
  defaultPageSetupForScore,
  resolvePageTurnSettings,
  type PageSetup,
  type PageTurnSettings,
  type ResolvedPageTurnSettings,
} from "@viritura/core";

import { useDocumentStore, useDocumentStoreApi } from "../../../../../store/DocumentContext";
import { useViewStateStore } from "../../../../../store/viewStateStore";
import styles from "./PageTurnsPanel.module.css";

const TITLE_PAGE_OPTIONS = [
  { value: "auto", label: "Auto — use when the turn plan wins" },
  { value: "always", label: "Always" },
  { value: "never", label: "Never" },
] as const;

const FIRST_PAGE_OPTIONS = [
  { value: "auto", label: "Standard binding (auto)" },
  { value: "recto", label: "Force first page recto" },
  { value: "verso", label: "Force first page verso" },
] as const;

interface NumberFieldProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly suffix?: string;
  readonly onCommit: (value: number) => void;
}

function formatNumber(value: number): string {
  return String(Number(value.toFixed(3)));
}

/** Buffer numeric typing so one field edit publishes one layout update. */
function NumberField({ label, value, min, max, step, suffix, onCommit }: NumberFieldProps) {
  const [draft, setDraft] = useState(formatNumber(value));
  const [previousValue, setPreviousValue] = useState(value);
  if (previousValue !== value) {
    setPreviousValue(value);
    setDraft(formatNumber(value));
  }

  const commit = () => {
    const parsed = Number(draft);
    if (!draft.trim() || !Number.isFinite(parsed)) {
      setDraft(formatNumber(value));
      return;
    }
    const constrained = Math.min(max, Math.max(min, parsed));
    setDraft(formatNumber(constrained));
    if (constrained !== value) onCommit(constrained);
  };

  return (
    <FormField label={label}>
      <div className={styles.numberControl}>
        <FormInput
          aria-label={label}
          type="number"
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.preventDefault();
              setDraft(formatNumber(value));
            }
          }}
        />
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </div>
    </FormField>
  );
}

function storedSettings(settings: ResolvedPageTurnSettings): PageTurnSettings {
  return {
    enabled: settings.enabled,
    comfortableSecs: settings.comfortableSecs,
    vsSecs: settings.vsSecs,
    minAcceptableSecs: settings.minAcceptableSecs,
    targetFillFraction: settings.targetFillFraction,
    minFillFraction: settings.minFillFraction,
    verticalJustifyThreshold: settings.verticalJustifyThreshold,
    allowPartialPages: settings.allowPartialPages,
    allowIntentionalBlanks: settings.allowIntentionalBlanks,
    titlePage: settings.titlePage,
    ...(settings.firstPageRecto === undefined ? {} : { firstPageRecto: settings.firstPageRecto }),
    emitVsMarks: settings.emitVsMarks,
    defaultBpm: settings.defaultBpm,
    weights: { ...settings.weights },
  };
}

interface SettingsSectionProps {
  readonly settings: ResolvedPageTurnSettings;
  readonly onUpdate: (update: (current: ResolvedPageTurnSettings) => ResolvedPageTurnSettings) => void;
}

function TurnWindowsSection({ settings, onUpdate }: SettingsSectionProps) {
  const set = (field: "comfortableSecs" | "vsSecs" | "minAcceptableSecs" | "defaultBpm", value: number) =>
    onUpdate((current) => ({ ...current, [field]: value }));
  return (
    <section className={styles.group}>
      <h3>Turn windows</h3>
      <div className={styles.fieldGrid}>
        <NumberField
          label="Comfortable"
          value={settings.comfortableSecs}
          min={0}
          max={60}
          step={0.1}
          suffix="sec"
          onCommit={(value) => set("comfortableSecs", value)}
        />
        <NumberField
          label="V.S. threshold"
          value={settings.vsSecs}
          min={0}
          max={60}
          step={0.1}
          suffix="sec"
          onCommit={(value) => set("vsSecs", value)}
        />
        <NumberField
          label="Minimum acceptable"
          value={settings.minAcceptableSecs}
          min={0}
          max={60}
          step={0.1}
          suffix="sec"
          onCommit={(value) => set("minAcceptableSecs", value)}
        />
        <NumberField
          label="Fallback tempo"
          value={settings.defaultBpm}
          min={1}
          max={400}
          step={1}
          suffix="BPM"
          onCommit={(value) => set("defaultBpm", value)}
        />
      </div>
    </section>
  );
}

function PageDensitySection({ settings, onUpdate }: SettingsSectionProps) {
  return (
    <section className={styles.group}>
      <h3>Page density</h3>
      <div className={styles.fieldGrid}>
        <NumberField
          label="Target fill"
          value={settings.targetFillFraction * 100}
          min={50}
          max={100}
          step={1}
          suffix="%"
          onCommit={(value) => onUpdate((current) => ({ ...current, targetFillFraction: value / 100 }))}
        />
        <NumberField
          label="Minimum fill"
          value={settings.minFillFraction * 100}
          min={50}
          max={100}
          step={1}
          suffix="%"
          onCommit={(value) => onUpdate((current) => ({ ...current, minFillFraction: value / 100 }))}
        />
        <NumberField
          label="Vertical justification"
          value={settings.verticalJustifyThreshold * 100}
          min={50}
          max={100}
          step={1}
          suffix="%"
          onCommit={(value) => onUpdate((current) => ({ ...current, verticalJustifyThreshold: value / 100 }))}
        />
      </div>
      <label className={styles.checkRow}>
        <Checkbox
          aria-label="Allow partial music pages"
          checked={settings.allowPartialPages}
          onChange={(event) =>
            onUpdate((current) => ({
              ...current,
              allowPartialPages: event.currentTarget.checked,
            }))
          }
        />
        <span>
          <strong>Allow partial music pages</strong>
          <small>Leave an acceptable page ragged when it buys a materially better turn.</small>
        </span>
      </label>
      <label className={styles.checkRow}>
        <Checkbox
          aria-label="Allow intentional blank pages"
          checked={settings.allowIntentionalBlanks}
          onChange={(event) =>
            onUpdate((current) => ({
              ...current,
              allowIntentionalBlanks: event.currentTarget.checked,
            }))
          }
        />
        <span>
          <strong>Allow intentional blank pages</strong>
          <small>Use a blank leaf only when its parity benefit outweighs its cost.</small>
        </span>
      </label>
    </section>
  );
}

function PageSequenceSection({ settings, onUpdate }: SettingsSectionProps) {
  const firstPageValue = settings.firstPageRecto === undefined ? "auto" : settings.firstPageRecto ? "recto" : "verso";
  return (
    <section className={styles.group}>
      <h3>Page sequence</h3>
      <div className={styles.selectStack}>
        <FormField label="Title page">
          <Select
            aria-label="Title page policy"
            value={settings.titlePage}
            options={TITLE_PAGE_OPTIONS}
            onValueChange={(value) =>
              onUpdate((current) => ({
                ...current,
                titlePage: value as ResolvedPageTurnSettings["titlePage"],
              }))
            }
          />
        </FormField>
        <FormField label="First-page binding">
          <Select
            aria-label="First-page binding"
            value={firstPageValue}
            options={FIRST_PAGE_OPTIONS}
            onValueChange={(value) =>
              onUpdate((current) => ({
                ...current,
                firstPageRecto: value === "auto" ? undefined : value === "recto",
              }))
            }
          />
        </FormField>
      </div>
      <label className={styles.checkRow}>
        <Checkbox
          aria-label="Emit V.S. and time marks"
          checked={settings.emitVsMarks}
          onChange={(event) =>
            onUpdate((current) => ({
              ...current,
              emitVsMarks: event.currentTarget.checked,
            }))
          }
        />
        <span>
          <strong>Emit V.S. and “time” marks</strong>
          <small>Print turn guidance when the selected boundary needs it.</small>
        </span>
      </label>
    </section>
  );
}

function ObjectiveWeightsSection({ settings, onUpdate }: SettingsSectionProps) {
  const set = (field: keyof ResolvedPageTurnSettings["weights"], value: number) =>
    onUpdate((current) => ({
      ...current,
      weights: { ...current.weights, [field]: value },
    }));
  return (
    <section className={styles.group}>
      <h3>Objective weights</h3>
      <p>Higher values make that concern more expensive in the global plan.</p>
      <div className={styles.fieldGrid}>
        <NumberField
          label="Density"
          value={settings.weights.density}
          min={0}
          max={100}
          step={0.1}
          onCommit={(value) => set("density", value)}
        />
        <NumberField
          label="Turn quality"
          value={settings.weights.turn}
          min={0}
          max={100}
          step={0.1}
          onCommit={(value) => set("turn", value)}
        />
        <NumberField
          label="Sparse page"
          value={settings.weights.sparse}
          min={0}
          max={100}
          step={0.1}
          onCommit={(value) => set("sparse", value)}
        />
        <NumberField
          label="Title page"
          value={settings.weights.titlePage}
          min={0}
          max={100}
          step={0.1}
          onCommit={(value) => set("titlePage", value)}
        />
        <NumberField
          label="Blank page"
          value={settings.weights.blankPage}
          min={0}
          max={100}
          step={0.1}
          onCommit={(value) => set("blankPage", value)}
        />
        <NumberField
          label="Time marking"
          value={settings.weights.timeMarking}
          min={0}
          max={100}
          step={0.1}
          onCommit={(value) => set("timeMarking", value)}
        />
      </div>
    </section>
  );
}

/** Complete, live editor for the engine's auto page-turn configuration. */
export function PageTurnsPanel() {
  const score = useDocumentStore((state) => state.score);
  const store = useDocumentStoreApi();
  const scoreIndex = useViewStateStore((state) => state.selectedScoreIndex);
  const scoreDefinition = score?.scores?.[scoreIndex];
  const defaults = defaultPageSetupForScore(score?.scores, scoreIndex, score?.layouts, score?.parts?.length);
  const effectiveSetup: PageSetup = {
    ...defaults,
    ...scoreDefinition?.pageSetup,
    margins: {
      ...defaults.margins,
      ...scoreDefinition?.pageSetup?.margins,
    },
  };
  const settings = resolvePageTurnSettings(effectiveSetup.pageTurns);

  const commit = useCallback(
    (update: (current: ResolvedPageTurnSettings) => ResolvedPageTurnSettings) => {
      const currentScore = store.getState().workingScore;
      const currentDefinition = currentScore?.scores?.[scoreIndex];
      if (!currentScore || !currentDefinition) return;
      const currentDefaults = defaultPageSetupForScore(
        currentScore.scores,
        scoreIndex,
        currentScore.layouts,
        currentScore.parts.length,
      );
      const currentSetup: PageSetup = {
        ...currentDefaults,
        ...currentDefinition.pageSetup,
        margins: {
          ...currentDefaults.margins,
          ...currentDefinition.pageSetup?.margins,
        },
      };
      const nextSettings = storedSettings(update(resolvePageTurnSettings(currentSetup.pageTurns)));
      const scores = [...(currentScore.scores ?? [])];
      scores[scoreIndex] = {
        ...currentDefinition,
        pageSetup: {
          ...currentSetup,
          pageTurns: nextSettings,
        },
      };
      store.getState().updateScore({ ...currentScore, scores });
    },
    [scoreIndex, store],
  );

  if (!score) {
    return <p className={styles.empty}>Open a score to configure page turns.</p>;
  }
  if (!scoreDefinition) {
    return <p className={styles.empty}>This document has no editable score layout.</p>;
  }

  return (
    <div className={styles.root}>
      <p className={styles.intro}>
        Tunes automatic part casting for the score or part selected above the canvas. Authored page breaks and full
        scores are unchanged.
      </p>

      <div className={styles.toggleRow}>
        <div>
          <strong>Optimize physical turns</strong>
          <span>Plan real system and page boundaries across the whole part.</span>
        </div>
        <Checkbox
          aria-label="Enable page-turn optimization"
          checked={settings.enabled}
          onChange={(event) => commit((current) => ({ ...current, enabled: event.currentTarget.checked }))}
        />
      </div>

      <TurnWindowsSection settings={settings} onUpdate={commit} />
      <PageDensitySection settings={settings} onUpdate={commit} />
      <PageSequenceSection settings={settings} onUpdate={commit} />
      <ObjectiveWeightsSection settings={settings} onUpdate={commit} />
    </div>
  );
}
