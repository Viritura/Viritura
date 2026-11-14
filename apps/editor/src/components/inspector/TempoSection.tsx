import type { Tempo, NoteValueBase, TextContent, Swing, ResolvedTempoSwing } from "@viritura/core";
import { Checkbox, FormField, FormInput, SectionLabel, Select } from "@viritura/ui";
import { sectionStyle } from "./types";
import { ManualOffsetFields, type ManualOffsetControl } from "./DirectionTextSection";
import { useDebouncedInput } from "../../hooks/useDebouncedInput";
import { TextContentEditor, type InheritedTextStyle } from "./TextContentEditor";
import { SwingControls } from "./SwingControls";
import styles from "./TempoSection.module.css";

const BEAT_BASE_OPTIONS: { value: NoteValueBase; label: string }[] = [
  { value: "whole", label: "whole" },
  { value: "half", label: "half" },
  { value: "quarter", label: "quarter" },
  { value: "eighth", label: "eighth" },
  { value: "16th", label: "16th" },
  { value: "32nd", label: "32nd" },
];

const DOTS_OPTIONS: { value: "0" | "1" | "2"; label: string }[] = [
  { value: "0", label: "None" },
  { value: "1", label: "1 dot" },
  { value: "2", label: "2 dots" },
];

// Stable identity so an absent tempo text does not look like a new value on
// every render, which would make the debounced input reset in a loop.
const NO_TEXT: TextContent = [];

export interface TempoSectionProps {
  tempo: Tempo;
  effectiveSwing?: ResolvedTempoSwing;
  onSwingChange: (swing: Swing | undefined) => void;
  onBpmChange: (bpm: number) => void;
  onValueBaseChange: (base: NoteValueBase) => void;
  onDotsChange: (dots: number) => void;
  onTextChange: (text: TextContent) => void;
  onShowTextChange: (show: boolean) => void;
  onShowMetronomeChange: (show: boolean) => void;
  /** Optional manual position offset editor (sp). */
  offset?: ManualOffsetControl;
  /** Weight and slant of the score's tempo text style, applied to unstyled runs. */
  inheritedStyle?: InheritedTextStyle;
  title?: string;
  onTempoEnabledChange?: (enabled: boolean) => void;
}

export function TempoSection({
  tempo,
  effectiveSwing,
  onSwingChange,
  onBpmChange,
  onValueBaseChange,
  onDotsChange,
  onTextChange,
  onShowTextChange,
  onShowMetronomeChange,
  offset,
  inheritedStyle,
  title = "Tempo",
  onTempoEnabledChange,
}: TempoSectionProps) {
  const bpmInput = useDebouncedInput(tempo.bpm === undefined ? "" : String(tempo.bpm), (value) => {
    const bpm = Number(value);
    if (Number.isFinite(bpm)) onBpmChange(bpm);
  });
  const textInput = useDebouncedInput<TextContent>(tempo.text ?? NO_TEXT, onTextChange);
  const handleBpmBlur = () => {
    if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(bpmInput.value)) {
      bpmInput.onBlur();
    } else {
      bpmInput.reset();
    }
  };
  const beatOptions =
    !tempo.value || BEAT_BASE_OPTIONS.some((option) => option.value === tempo.value?.base)
      ? BEAT_BASE_OPTIONS
      : [...BEAT_BASE_OPTIONS, { value: tempo.value.base, label: tempo.value.base }];
  const dots = tempo.value?.dots ?? 0;
  const dotsOptions = dots > 2 ? [...DOTS_OPTIONS, { value: String(dots), label: `${dots} dots` }] : DOTS_OPTIONS;

  return (
    <fieldset style={sectionStyle}>
      <legend className={styles.title}>{title}</legend>
      {onTempoEnabledChange && (
        <Checkbox
          label="Set tempo"
          checked={tempo.bpm !== undefined}
          onChange={(event) => onTempoEnabledChange(event.target.checked)}
        />
      )}
      {tempo.bpm !== undefined && tempo.value !== undefined && (
        <div className={styles.metronomeFields}>
          <FormField label="BPM" className={styles.field}>
            <FormInput
              type="number"
              min={Number.MIN_VALUE}
              max={999}
              step="any"
              className={styles.input}
              value={bpmInput.value}
              onChange={(e) => bpmInput.onChange(e.target.value)}
              onBlur={handleBpmBlur}
            />
          </FormField>
          <FormField label="Beat unit" className={styles.field}>
            <Select
              options={beatOptions}
              value={tempo.value.base}
              onValueChange={(value) => {
                const option = beatOptions.find((option) => option.value === value);
                if (!option) throw new Error(`Unsupported tempo beat unit: ${value}`);
                onValueBaseChange(option.value);
              }}
            />
          </FormField>
          <FormField label="Dots" className={styles.field}>
            <Select options={dotsOptions} value={String(dots)} onValueChange={(value) => onDotsChange(Number(value))} />
          </FormField>
        </div>
      )}
      <SwingControls swing={tempo.swing} effective={effectiveSwing} onChange={onSwingChange} />
      <div className={styles.group} role="group" aria-label="Appearance">
        <SectionLabel className={styles.groupTitle} label="Appearance" />
        <div className={styles.textField}>
          <span className={styles.textLabel}>Printed text</span>
          <TextContentEditor
            value={textInput.value}
            placeholder="e.g. Allegro con brio"
            ariaLabel="Printed text"
            onChange={textInput.onChange}
            onBlur={textInput.onBlur}
            inheritedStyle={inheritedStyle}
            multiline
          />
        </div>
        <div className={styles.visibility}>
          <Checkbox
            label="Show text"
            checked={tempo.showText !== false}
            onChange={(e) => onShowTextChange(e.target.checked)}
          />
          {tempo.bpm !== undefined && (
            <Checkbox
              label="Show metronome mark"
              checked={tempo.showMetronomeMark !== false}
              onChange={(e) => onShowMetronomeChange(e.target.checked)}
            />
          )}
        </div>
      </div>
      {offset && <ManualOffsetFields offset={offset} />}
    </fieldset>
  );
}
