import type { LyricLineType } from "@viritura/core";
import { FormInput, Select } from "@viritura/ui";
import { useState } from "react";
import { labelStyle, legendStyle, sectionStyle } from "./types";

interface LyricLineOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface LyricSectionProps {
  text: string;
  syllabicType: LyricLineType;
  lineId: string;
  lineOptions: LyricLineOption[];
  onTextChange: (text: string) => void;
  onSyllabicTypeChange: (type: LyricLineType) => void;
  onLineChange: (lineId: string) => void;
}

const SYLLABIC_OPTIONS = [
  { value: "whole", label: "Whole word" },
  { value: "start", label: "Start of word" },
  { value: "middle", label: "Middle of word" },
  { value: "end", label: "End of word" },
] satisfies Array<{ value: LyricLineType; label: string }>;

export function LyricSection({
  text,
  syllabicType,
  lineId,
  lineOptions,
  onTextChange,
  onSyllabicTypeChange,
  onLineChange,
}: LyricSectionProps) {
  const [textDraft, setTextDraft] = useState(text);
  const commitText = () => {
    if (textDraft !== text) onTextChange(textDraft);
  };

  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Lyric syllable</legend>
      <label style={labelStyle}>
        Text
        <FormInput
          aria-label="Lyric syllable text"
          value={textDraft}
          onChange={(event) => setTextDraft(event.target.value)}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </label>
      <label style={labelStyle}>
        Position in word
        <Select
          aria-label="Lyric syllable position"
          value={syllabicType}
          onValueChange={(value) => onSyllabicTypeChange(value as LyricLineType)}
          options={SYLLABIC_OPTIONS}
        />
      </label>
      <label style={labelStyle}>
        Lyric line
        <Select aria-label="Lyric line" value={lineId} onValueChange={onLineChange} options={lineOptions} />
      </label>
    </fieldset>
  );
}
