import type { CSSProperties } from "react";
import { ButtonGroup, IconButton, Select, type ButtonGroupOption, type SelectOption } from "@viritura/ui";
import { Info } from "lucide-react";
import type { InspectorSectionProps } from "./types";

function tupletFieldsetStyle(): CSSProperties {
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
import { useLayoutOverrideHandlers } from "./useLayoutOverrideHandlers";
import { legendStyle, labelStyle, mergeFocusedSectionStyle, errorStyle } from "./types";

const UP_DOWN_OPTIONS: SelectOption[] = [
  { value: "", label: "Auto" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
];
const UP_DOWN_PILL_OPTIONS: ButtonGroupOption[] = UP_DOWN_OPTIONS;

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

const FIELD_LABEL_HEADER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-1)",
};

interface LayoutSectionProps extends InspectorSectionProps {
  /** The selected content item within the sequence. */
  selectedContent: {
    type: string;
    stemDirection?: string;
    placement?: string;
    staff?: number;
    bracket?: string;
    showNumber?: string;
    showValue?: string;
  } | null;
  /** Whether the selected content is a tuplet. */
  isTuplet: boolean;
  /** Whether the selected content is an event. */
  isEvent: boolean;
  /** Number of staves owned by the selected event's instrument. */
  staffCount: number;
  disabled: boolean;
}

export function LayoutSection({
  score,
  target,
  updateScore,
  focusedSection,
  sectionRef,
  selectedContent,
  isTuplet,
  isEvent,
  staffCount,
  disabled,
}: LayoutSectionProps) {
  const {
    layoutError,
    handleStemDirectionChange,
    handleEventStaffChange,
    handleTupletPlacementChange,
    handleTupletBracketChange,
    handleTupletShowNumberChange,
    handleTupletShowValueChange,
  } = useLayoutOverrideHandlers({ score, target, updateScore });

  // Pre-compute current-value reads so the JSX stays declarative.
  const { stemDirectionValue, tupletPlacementValue, tupletBracketValue, tupletShowNumberValue, tupletShowValueValue } =
    readLayoutOverrideValues({ isEvent, isTuplet, selectedContent });
  const staffOptions: ButtonGroupOption[] = [
    { value: "", label: "Auto" },
    ...Array.from({ length: staffCount }, (_, index) => ({
      value: String(index + 1),
      label: String(index + 1),
    })),
  ];

  return (
    <fieldset ref={sectionRef} style={mergeFocusedSectionStyle("layout", focusedSection)} disabled={disabled}>
      <legend style={legendStyle}>Layout Overrides</legend>

      <LayoutOverrideField
        label="Stem Direction"
        tooltip="Sets only the selected event's stem direction. It does not change the event's vertical orientation."
      >
        <ButtonGroup
          data-testid="notation-layout-stem"
          ariaLabel="Stem Direction"
          disabled={!isEvent}
          value={stemDirectionValue}
          onChange={handleStemDirectionChange}
          options={UP_DOWN_PILL_OPTIONS}
        />
      </LayoutOverrideField>

      {isEvent && staffCount > 1 && (
        <LayoutOverrideField
          label="Cross-Staff"
          tooltip="Moves the selected event to another staff of the same instrument while keeping it in its current voice sequence."
        >
          <ButtonGroup
            data-testid="notation-layout-staff"
            ariaLabel="Cross-Staff"
            value={readCrossStaffValue(isEvent, selectedContent)}
            onChange={handleEventStaffChange}
            options={staffOptions}
          />
        </LayoutOverrideField>
      )}

      {isTuplet && (
        <fieldset style={tupletFieldsetStyle()}>
          <legend style={tupletLegendStyle()}>Tuplet Overrides</legend>
          <TupletOverrideControls
            placement={tupletPlacementValue}
            bracket={tupletBracketValue}
            showNumber={tupletShowNumberValue}
            showValue={tupletShowValueValue}
            onPlacementChange={handleTupletPlacementChange}
            onBracketChange={handleTupletBracketChange}
            onShowNumberChange={handleTupletShowNumberChange}
            onShowValueChange={handleTupletShowValueChange}
          />
        </fieldset>
      )}

      {layoutError && <div style={errorStyle}>{layoutError}</div>}
    </fieldset>
  );
}

function LayoutOverrideField({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip: string;
  children: React.ReactNode;
}) {
  return (
    <div style={labelStyle}>
      <span style={FIELD_LABEL_HEADER_STYLE}>
        {label}
        <IconButton size="xs" variant="ghost" tooltip={tooltip} tooltipSide="right" aria-label={`About ${label}`}>
          <Info size={11} aria-hidden="true" />
        </IconButton>
      </span>
      {children}
    </div>
  );
}

interface TupletOverrideControlsProps {
  placement: string;
  bracket: string;
  showNumber: string;
  showValue: string;
  onPlacementChange: (value: string) => void;
  onBracketChange: (value: string) => void;
  onShowNumberChange: (value: string) => void;
  onShowValueChange: (value: string) => void;
}

function TupletOverrideControls({
  placement,
  bracket,
  showNumber,
  showValue,
  onPlacementChange,
  onBracketChange,
  onShowNumberChange,
  onShowValueChange,
}: TupletOverrideControlsProps) {
  return (
    <>
      <label style={labelStyle}>
        Tuplet Placement
        <Select
          data-testid="notation-layout-tuplet-placement"
          value={placement}
          onValueChange={onPlacementChange}
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
}

function readLayoutOverrideValues({ isEvent, isTuplet, selectedContent }: ReadLayoutValuesArgs) {
  const eventContent = isEvent && selectedContent?.type === "event" ? selectedContent : null;
  const tupletContent = isTuplet && selectedContent?.type === "tuplet" ? selectedContent : null;
  return {
    stemDirectionValue: eventContent?.stemDirection ?? "",
    tupletPlacementValue: tupletContent?.placement ?? "",
    tupletBracketValue: tupletContent?.bracket ?? "",
    tupletShowNumberValue: tupletContent?.showNumber ?? "",
    tupletShowValueValue: tupletContent?.showValue ?? "",
  };
}
