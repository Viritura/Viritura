import type { CSSProperties } from "react";
import type { Tempo, NoteValueBase, TextContent } from "@viritura/core";
import { ButtonGroup, Checkbox, FormInput } from "@viritura/ui";
import { sectionStyle, legendStyle, labelStyle } from "./types";
import { ManualOffsetFields, type ManualOffsetControl } from "./DirectionTextSection";
import { useDebouncedInput } from "../../hooks/useDebouncedInput";
import { TextContentEditor, type InheritedTextStyle } from "./TextContentEditor";

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
  { value: "1", label: "." },
  { value: "2", label: ".." },
];

const TEMPO_BPM_INPUT_STYLE: CSSProperties = { width: "4.5rem" };

// Stable identity so an absent tempo text does not look like a new value on
// every render, which would make the debounced input reset in a loop.
const NO_TEXT: TextContent = [];

export interface TempoSectionProps {
  tempo: Tempo;
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
}

export function TempoSection({
  tempo,
  onBpmChange,
  onValueBaseChange,
  onDotsChange,
  onTextChange,
  onShowTextChange,
  onShowMetronomeChange,
  offset,
  inheritedStyle,
}: TempoSectionProps) {
  const bpmInput = useDebouncedInput(String(tempo.bpm), (value) => {
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

  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Tempo</legend>
      <label style={labelStyle}>
        BPM
        <FormInput
          type="number"
          min={Number.MIN_VALUE}
          max={999}
          step="any"
          style={TEMPO_BPM_INPUT_STYLE}
          value={bpmInput.value}
          onChange={(e) => bpmInput.onChange(e.target.value)}
          onBlur={handleBpmBlur}
        />
      </label>
      <label style={labelStyle}>
        Beat unit
        <ButtonGroup<NoteValueBase> options={BEAT_BASE_OPTIONS} value={tempo.value.base} onChange={onValueBaseChange} />
      </label>
      <label style={labelStyle}>
        Dots
        <ButtonGroup<"0" | "1" | "2">
          options={DOTS_OPTIONS}
          value={String(tempo.value.dots ?? 0) as "0" | "1" | "2"}
          onChange={(v) => onDotsChange(parseInt(v, 10))}
        />
      </label>
      <div style={labelStyle}>
        <span>Text</span>
        <TextContentEditor
          value={textInput.value}
          placeholder="e.g. Allegro con brio"
          ariaLabel="Text"
          onChange={textInput.onChange}
          onBlur={textInput.onBlur}
          inheritedStyle={inheritedStyle}
        />
      </div>
      <Checkbox
        label="Show text"
        checked={tempo.showText !== false}
        onChange={(e) => onShowTextChange(e.target.checked)}
      />
      <Checkbox
        label="Show metronome mark"
        checked={tempo.showMetronomeMark !== false}
        onChange={(e) => onShowMetronomeChange(e.target.checked)}
      />
      {offset && <ManualOffsetFields offset={offset} />}
    </fieldset>
  );
}
