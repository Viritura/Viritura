import type { CSSProperties } from "react";
import type { Score } from "@viritura/core";
import { FormInput, Select, type SelectOption } from "@viritura/ui";
import type { InspectorSectionProps } from "./types";

function tupletFieldsetStyle(isTuplet: boolean): CSSProperties {
  // Sub-group within a section: flat, no divider, indented label.
  return {
    margin: 0,
    padding: "8px 0 2px",
    border: "none",
    background: "transparent",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    marginTop: "6px",
    opacity: isTuplet ? 1 : 0.5,
  };
}
function tupletLegendStyle(): CSSProperties {
  return {
    ...legendStyle,
    fontSize: "var(--type-eyebrow-size)",
    letterSpacing: "0.1em",
    color: "var(--text-muted)",
    opacity: 0.75,
  };
}
import { useDebouncedInput } from "../../hooks/useDebouncedInput";
import { useLayoutOverrideHandlers } from "./useLayoutOverrideHandlers";
import { legendStyle, labelStyle, mergeFocusedSectionStyle, errorStyle } from "./types";

const UP_DOWN_OPTIONS: SelectOption[] = [
  { value: "", label: "Auto" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
];

const BRACKET_OPTIONS: SelectOption[] = [
  { value: "", label: "Auto" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const DISPLAY_OPTIONS: SelectOption[] = [
  { value: "", label: "Default" },
  { value: "noNumber", label: "None" },
  { value: "inner", label: "Inner" },
  { value: "both", label: "Both" },
];

interface LayoutSectionProps extends InspectorSectionProps {
  /** The selected sequence (if any). */
  selectedSequence: Score["parts"][number]["measures"][number]["sequences"][number] | null;
  /** The selected content item within the sequence. */
  selectedContent: {
    type: string;
    stemDirection?: string;
    orient?: string;
    staff?: number;
    bracket?: string;
    showNumber?: string;
    showValue?: string;
  } | null;
  /** Whether the selected content is a tuplet. */
  isTuplet: boolean;
  /** Whether the selected content is an event. */
  isEvent: boolean;
  disabled: boolean;
}

export function LayoutSection({
  score,
  target,
  updateScore,
  focusedSection,
  sectionRef,
  selectedSequence,
  selectedContent,
  isTuplet,
  isEvent,
  disabled,
}: LayoutSectionProps) {
  const {
    layoutError,
    handleStemDirectionChange,
    handleEventOrientChange,
    handleEventStaffChange,
    handleSequenceOrientChange,
    handleTupletOrientChange,
    handleTupletBracketChange,
    handleTupletShowNumberChange,
    handleTupletShowValueChange,
  } = useLayoutOverrideHandlers({ score, target, updateScore });

  const crossStaffInput = useDebouncedInput(readCrossStaffValue(isEvent, selectedContent), handleEventStaffChange);

  // Pre-compute current-value reads so the JSX stays declarative.
  const {
    stemDirectionValue,
    eventOrientValue,
    sequenceOrientValue,
    tupletOrientValue,
    tupletBracketValue,
    tupletShowNumberValue,
    tupletShowValueValue,
  } = readLayoutOverrideValues({ isEvent, isTuplet, selectedContent, selectedSequence });

  return (
    <fieldset ref={sectionRef} style={mergeFocusedSectionStyle("layout", focusedSection)} disabled={disabled}>
      <legend style={legendStyle}>Layout Overrides (O)</legend>

      <label style={labelStyle}>
        Stem Direction
        <Select
          data-testid="notation-layout-stem"
          disabled={!isEvent}
          value={stemDirectionValue}
          onValueChange={handleStemDirectionChange}
          options={UP_DOWN_OPTIONS}
        />
      </label>

      <label style={labelStyle}>
        Event Orient
        <Select
          data-testid="notation-layout-event-orient"
          disabled={!isEvent}
          value={eventOrientValue}
          onValueChange={handleEventOrientChange}
          options={UP_DOWN_OPTIONS}
        />
      </label>

      <label style={labelStyle}>
        Cross-Staff
        <FormInput
          data-testid="notation-layout-staff"
          disabled={!isEvent}
          value={crossStaffInput.value}
          onChange={(e) => crossStaffInput.onChange(e.target.value)}
          onBlur={crossStaffInput.onBlur}
          placeholder="Staff number (blank = default)"
        />
      </label>

      <label style={labelStyle}>
        Sequence Orient
        <Select
          data-testid="notation-layout-seq-orient"
          disabled={!selectedSequence}
          value={sequenceOrientValue}
          onValueChange={handleSequenceOrientChange}
          options={UP_DOWN_OPTIONS}
        />
      </label>

      <fieldset style={tupletFieldsetStyle(isTuplet)} disabled={!isTuplet}>
        <legend style={tupletLegendStyle()}>Tuplet Overrides</legend>
        <TupletOverrideControls
          orient={tupletOrientValue}
          bracket={tupletBracketValue}
          showNumber={tupletShowNumberValue}
          showValue={tupletShowValueValue}
          onOrientChange={handleTupletOrientChange}
          onBracketChange={handleTupletBracketChange}
          onShowNumberChange={handleTupletShowNumberChange}
          onShowValueChange={handleTupletShowValueChange}
        />
      </fieldset>

      {layoutError && <div style={errorStyle}>{layoutError}</div>}
    </fieldset>
  );
}

interface TupletOverrideControlsProps {
  orient: string;
  bracket: string;
  showNumber: string;
  showValue: string;
  onOrientChange: (value: string) => void;
  onBracketChange: (value: string) => void;
  onShowNumberChange: (value: string) => void;
  onShowValueChange: (value: string) => void;
}

function TupletOverrideControls({
  orient,
  bracket,
  showNumber,
  showValue,
  onOrientChange,
  onBracketChange,
  onShowNumberChange,
  onShowValueChange,
}: TupletOverrideControlsProps) {
  return (
    <>
      <label style={labelStyle}>
        Tuplet Orient
        <Select
          data-testid="notation-layout-tuplet-orient"
          value={orient}
          onValueChange={onOrientChange}
          options={UP_DOWN_OPTIONS}
        />
      </label>
      <label style={labelStyle}>
        Bracket
        <Select
          data-testid="notation-layout-tuplet-bracket"
          value={bracket}
          onValueChange={onBracketChange}
          options={BRACKET_OPTIONS}
        />
      </label>
      <label style={labelStyle}>
        Show Number
        <Select
          data-testid="notation-layout-tuplet-shownumber"
          value={showNumber}
          onValueChange={onShowNumberChange}
          options={DISPLAY_OPTIONS}
        />
      </label>
      <label style={labelStyle}>
        Show Value
        <Select
          data-testid="notation-layout-tuplet-showvalue"
          value={showValue}
          onValueChange={onShowValueChange}
          options={DISPLAY_OPTIONS}
        />
      </label>
    </>
  );
}

type SelectedContent = LayoutSectionProps["selectedContent"];

function readCrossStaffValue(isEvent: boolean, selectedContent: SelectedContent): string {
  if (!isEvent || selectedContent?.type !== "event") return "";
  return selectedContent.staff?.toString() ?? "";
}

interface ReadLayoutValuesArgs {
  isEvent: boolean;
  isTuplet: boolean;
  selectedContent: SelectedContent;
  selectedSequence: LayoutSectionProps["selectedSequence"];
}

function readLayoutOverrideValues({ isEvent, isTuplet, selectedContent, selectedSequence }: ReadLayoutValuesArgs) {
  const eventContent = isEvent && selectedContent?.type === "event" ? selectedContent : null;
  const tupletContent = isTuplet && selectedContent?.type === "tuplet" ? selectedContent : null;
  return {
    stemDirectionValue: eventContent?.stemDirection ?? "",
    eventOrientValue: eventContent?.orient ?? "",
    sequenceOrientValue: selectedSequence?.orient ?? "",
    tupletOrientValue: tupletContent?.orient ?? "",
    tupletBracketValue: tupletContent?.bracket ?? "",
    tupletShowNumberValue: tupletContent?.showNumber ?? "",
    tupletShowValueValue: tupletContent?.showValue ?? "",
  };
}
