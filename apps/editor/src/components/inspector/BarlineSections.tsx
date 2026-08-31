import type { CSSProperties } from "react";
import { Button, ButtonGroup, Checkbox, FormInput } from "@viritura/ui";
import type { Note } from "@viritura/core";
import { sectionStyle, legendStyle, labelStyle, mergeFocusedSectionStyle } from "./types";
import type { InspectorSection } from "./notationInspectorMeta";

const PILL_ROW_WRAP_STYLE: CSSProperties = { display: "flex", gap: "0.3rem", flexWrap: "wrap" };
const PILL_ROW_STYLE: CSSProperties = { display: "flex", gap: "0.3rem" };
const REPEAT_COUNT_ROW_STYLE: CSSProperties = { display: "flex", alignItems: "center", gap: "0.4rem" };
const REPEAT_COUNT_INPUT_STYLE: CSSProperties = { width: "3.5rem" };
const REPEAT_COUNT_HINT_STYLE: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  color: "var(--vscode-descriptionForeground, #888)",
};
const TRILL_ROW_STYLE: CSSProperties = { display: "flex", gap: "0.4rem", marginTop: "0.2rem" };
const ACCIDENTAL_ROW_WRAP_STYLE: CSSProperties = { display: "flex", gap: "0.4rem", flexWrap: "wrap" };
const ACCIDENTAL_ROW_STYLE: CSSProperties = { display: "flex", gap: "0.4rem", marginTop: "0.3rem" };

const BARLINE_TYPES = ["regular", "double", "final", "heavy", "dashed", "dotted", "tick", "short"] as const;
type BarlineTypeValue = (typeof BARLINE_TYPES)[number];

const BARLINE_TYPE_OPTIONS = BARLINE_TYPES.map((t) => ({
  value: t,
  label: t.charAt(0).toUpperCase() + t.slice(1),
}));

type TrillAccidentalValue = "none" | "flat" | "natural" | "sharp";
const TRILL_ACCIDENTAL_OPTIONS: { value: TrillAccidentalValue; label: string }[] = [
  { value: "none", label: "None" },
  { value: "flat", label: "♭ Flat" },
  { value: "natural", label: "♮ Natural" },
  { value: "sharp", label: "♯ Sharp" },
];

function accidentalToValue(accidental: number | undefined): TrillAccidentalValue {
  if (accidental === -1) return "flat";
  if (accidental === 0) return "natural";
  if (accidental === 1) return "sharp";
  return "none";
}

export interface BarlineSectionProps {
  focusedSection: InspectorSection | null;
  currentBarlineType: string | null;
  hasRepeatEnd: boolean;
  hasRepeatStart: boolean;
  repeatEndTimes: number;
  onBarlineTypeChange: (type: BarlineTypeValue) => void;
  onToggleRepeatEnd: () => void;
  onToggleRepeatStart: () => void;
  onRepeatEndTimesChange: (times: number) => void;
}

export function BarlineSection({
  focusedSection,
  currentBarlineType,
  hasRepeatEnd,
  hasRepeatStart,
  repeatEndTimes,
  onBarlineTypeChange,
  onToggleRepeatEnd,
  onToggleRepeatStart,
  onRepeatEndTimesChange,
}: BarlineSectionProps) {
  // Coerce the current barline type to a known value so ButtonGroup always
  // has a defined selection; if the score is in an unknown state we fall
  // back to "regular" visually.
  const currentType = (BARLINE_TYPES as readonly string[]).includes(currentBarlineType ?? "")
    ? (currentBarlineType as BarlineTypeValue)
    : "regular";
  return (
    <fieldset style={mergeFocusedSectionStyle("measure", focusedSection)}>
      <legend style={legendStyle}>Barline</legend>
      <label style={labelStyle}>
        Type
        <div style={PILL_ROW_WRAP_STYLE}>
          <ButtonGroup<BarlineTypeValue>
            options={BARLINE_TYPE_OPTIONS}
            value={currentType}
            onChange={onBarlineTypeChange}
          />
        </div>
      </label>
      <label style={labelStyle}>
        Repeats
        <div style={PILL_ROW_STYLE}>
          <Button size="sm" active={hasRepeatEnd} onClick={onToggleRepeatEnd} label="Repeat End" />
          <Button size="sm" active={hasRepeatStart} onClick={onToggleRepeatStart} label="Repeat Start" />
        </div>
      </label>
      {hasRepeatEnd && (
        <label style={labelStyle}>
          Repeat Count
          <div style={REPEAT_COUNT_ROW_STYLE}>
            <FormInput
              type="number"
              min={2}
              max={32}
              value={repeatEndTimes}
              onChange={(e) => onRepeatEndTimesChange(parseInt(e.target.value, 10) || 2)}
              style={REPEAT_COUNT_INPUT_STYLE}
            />
            <span style={REPEAT_COUNT_HINT_STYLE}>{repeatEndTimes === 2 ? "(default)" : `×${repeatEndTimes}`}</span>
          </div>
        </label>
      )}
    </fieldset>
  );
}

export interface TrillSectionProps {
  accidental: number | undefined;
  onAccidentalChange: (value: -1 | 0 | 1 | null) => () => void;
}

export function TrillSection({ accidental, onAccidentalChange }: TrillSectionProps) {
  const current = accidentalToValue(accidental);
  const handleChange = (next: TrillAccidentalValue) => {
    if (next === "none") onAccidentalChange(null)();
    else if (next === "flat") onAccidentalChange(-1)();
    else if (next === "natural") onAccidentalChange(0)();
    else onAccidentalChange(1)();
  };
  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Trill</legend>
      <label style={labelStyle}>
        Accidental
        <div style={TRILL_ROW_STYLE}>
          <ButtonGroup<TrillAccidentalValue>
            options={TRILL_ACCIDENTAL_OPTIONS}
            value={current}
            onChange={handleChange}
          />
        </div>
      </label>
    </fieldset>
  );
}

export interface AccidentalDisplaySectionProps {
  note: Note;
  onShowToggle: () => void;
  onCourtesyToggle: () => void;
  onEnclosureToggle: (symbol: "parentheses" | "brackets") => () => void;
}

export function AccidentalDisplaySection({
  note,
  onShowToggle,
  onCourtesyToggle,
  onEnclosureToggle,
}: AccidentalDisplaySectionProps) {
  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Accidental Display</legend>
      <div style={ACCIDENTAL_ROW_WRAP_STYLE}>
        <Checkbox label="Show" checked={note.accidentalDisplay?.show === true} onChange={onShowToggle} />
        <Checkbox
          label="Courtesy (A)"
          checked={note.accidentalDisplay?.show === true && note.accidentalDisplay.force === true}
          onChange={onCourtesyToggle}
        />
      </div>
      <div style={ACCIDENTAL_ROW_STYLE}>
        <Checkbox
          label="( )"
          checked={note.accidentalDisplay?.enclosure?.symbol === "parentheses"}
          onChange={onEnclosureToggle("parentheses")}
        />
        <Checkbox
          label="[ ]"
          checked={note.accidentalDisplay?.enclosure?.symbol === "brackets"}
          onChange={onEnclosureToggle("brackets")}
        />
      </div>
    </fieldset>
  );
}
