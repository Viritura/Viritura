import type { CSSProperties } from "react";
import { Button, ButtonGroup, Checkbox, FormInput, GlyphButtonGroup } from "@viritura/ui";
import type { MeasureRepeat, MeasureRepeatDisplayNumber, MultiStaffOrientation, Note } from "@viritura/core";
import type { AccidentalDisplayMode } from "../../commands/noteCommands";
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
const ACCIDENTAL_DISPLAY_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "show", label: "Show" },
  { value: "hide", label: "Hide" },
] satisfies Array<{ value: AccidentalDisplayMode; label: string }>;

type AccidentalEnclosureMode = "bare" | "parentheses" | "brackets";
const ACCIDENTAL_GLYPHS: Record<number, string> = {
  [-3]: String.fromCodePoint(0xe266),
  [-2]: String.fromCodePoint(0xe264),
  [-1]: String.fromCodePoint(0xe260),
  [0]: String.fromCodePoint(0xe261),
  [1]: String.fromCodePoint(0xe262),
  [2]: String.fromCodePoint(0xe263),
  [3]: String.fromCodePoint(0xe265),
};
const PARENS_LEFT = String.fromCodePoint(0xe26a);
const PARENS_RIGHT = String.fromCodePoint(0xe26b);
const BRACKET_LEFT = String.fromCodePoint(0xe26c);
const BRACKET_RIGHT = String.fromCodePoint(0xe26d);

const BARLINE_TYPES = ["regular", "double", "final", "heavy", "dashed", "dotted", "tick", "short"] as const;
type BarlineTypeValue = (typeof BARLINE_TYPES)[number];

const BARLINE_TYPE_OPTIONS = BARLINE_TYPES.map((t) => ({
  value: t,
  label: t.charAt(0).toUpperCase() + t.slice(1),
}));

const DISPLAY_NUMBER_OPTIONS: { value: MeasureRepeatDisplayNumber; label: string; tooltip: string }[] = [
  { value: "auto", label: "Auto", tooltip: "Auto" },
  { value: "yes", label: "Show", tooltip: "Show" },
  { value: "no", label: "Hide", tooltip: "Hide" },
];

const COUNTER_ORIENT_OPTIONS: { value: MultiStaffOrientation; label: string; tooltip: string }[] = [
  { value: "above", label: "Above", tooltip: "Above" },
  { value: "below", label: "Below", tooltip: "Below" },
];

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

export interface MeasureRepeatSectionProps {
  repeat: MeasureRepeat;
  focusedSection: InspectorSection | null;
  onDisplayNumberChange: (value: MeasureRepeatDisplayNumber) => void;
  onCounterEnabledChange: (enabled: boolean) => void;
  onCounterCountChange: (count: number) => void;
  onCounterOrientChange: (orient: MultiStaffOrientation) => void;
}

export function MeasureRepeatSection({
  repeat,
  focusedSection,
  onDisplayNumberChange,
  onCounterEnabledChange,
  onCounterCountChange,
  onCounterOrientChange,
}: MeasureRepeatSectionProps) {
  return (
    <fieldset style={mergeFocusedSectionStyle("measure", focusedSection)}>
      <legend style={legendStyle}>Measure Repeat</legend>
      <label style={labelStyle}>
        Span
        <span>
          {repeat.number} bar{repeat.number === 1 ? "" : "s"}
        </span>
      </label>
      <label style={labelStyle}>
        Span Number
        <ButtonGroup<MeasureRepeatDisplayNumber>
          options={DISPLAY_NUMBER_OPTIONS}
          value={repeat.displayNumber ?? "auto"}
          onChange={onDisplayNumberChange}
          ariaLabel="Span number display"
        />
      </label>
      <Checkbox
        label="Show iteration counter"
        checked={repeat.counter !== undefined}
        onChange={(event) => onCounterEnabledChange(event.target.checked)}
      />
      {repeat.counter && (
        <>
          <label style={labelStyle}>
            Counter
            <FormInput
              type="number"
              min={1}
              value={repeat.counter.count}
              onChange={(event) => onCounterCountChange(Number.parseInt(event.target.value, 10))}
              style={REPEAT_COUNT_INPUT_STYLE}
            />
          </label>
          <label style={labelStyle}>
            Counter Position
            <ButtonGroup<MultiStaffOrientation>
              options={COUNTER_ORIENT_OPTIONS}
              value={repeat.counter.orient === "below" ? "below" : "above"}
              onChange={onCounterOrientChange}
              ariaLabel="Counter position"
            />
          </label>
        </>
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
  onModeChange: (mode: AccidentalDisplayMode) => void;
  onEnclosureChange: (symbol: "parentheses" | "brackets" | null) => void;
}

export function AccidentalDisplaySection({ note, onModeChange, onEnclosureChange }: AccidentalDisplaySectionProps) {
  const displayMode: AccidentalDisplayMode = note.accidentalDisplay
    ? note.accidentalDisplay.show
      ? "show"
      : "hide"
    : "auto";
  const accidentalGlyph = ACCIDENTAL_GLYPHS[note.pitch.alter ?? 0] ?? ACCIDENTAL_GLYPHS[0]!;
  const enclosureMode: AccidentalEnclosureMode = note.accidentalDisplay?.enclosure?.symbol ?? "bare";
  const enclosureOptions = [
    { value: "bare", label: accidentalGlyph, tooltip: "Bare", useBravura: true },
    {
      value: "parentheses",
      label: `${PARENS_LEFT}${accidentalGlyph}${PARENS_RIGHT}`,
      tooltip: "Parentheses",
      useBravura: true,
    },
    {
      value: "brackets",
      label: `${BRACKET_LEFT}${accidentalGlyph}${BRACKET_RIGHT}`,
      tooltip: "Brackets",
      useBravura: true,
    },
  ] satisfies Array<{ value: AccidentalEnclosureMode; label: string; tooltip: string; useBravura: true }>;
  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Accidental Display</legend>
      <div style={labelStyle}>
        <span>Visibility</span>
        <ButtonGroup
          data-testid="notation-accidental-display-mode"
          options={ACCIDENTAL_DISPLAY_OPTIONS}
          value={displayMode}
          onChange={onModeChange}
          ariaLabel="Accidental visibility"
        />
      </div>
      <div style={labelStyle}>
        <span>Style</span>
        <GlyphButtonGroup<AccidentalEnclosureMode>
          data-testid="notation-accidental-enclosure"
          options={enclosureOptions.map(({ value, label, tooltip }) => ({ value, glyph: label, label: tooltip }))}
          value={enclosureMode}
          onChange={(mode) => onEnclosureChange(mode === "bare" ? null : mode)}
          ariaLabel="Accidental enclosure"
        />
      </div>
    </fieldset>
  );
}
