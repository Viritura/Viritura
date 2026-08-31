import type { RefObject } from "react";
import type { Tie, Slur } from "@viritura/core";
import { Checkbox, FormInput, Select } from "@viritura/ui";
import { legendStyle, labelStyle, mergeFocusedSectionStyle, errorStyle } from "./types";
import type { InspectorSection } from "./notationInspectorMeta";

const SIDE_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
] as const;

const LINE_TYPE_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
] as const;

export interface TieSectionProps {
  tie: Tie;
  focusedSection: InspectorSection | null;
  sectionRef: RefObject<HTMLFieldSetElement | null>;
  error: string | null;
  onTargetChange: (value: string) => void;
  onTargetTypeChange: (value: string) => void;
  onSideChange: (value: string) => void;
  onLvChange: (checked: boolean) => void;
}

export function TieSection({
  tie,
  focusedSection,
  sectionRef,
  error,
  onTargetChange,
  onTargetTypeChange,
  onSideChange,
  onLvChange,
}: TieSectionProps) {
  return (
    <fieldset ref={sectionRef} style={mergeFocusedSectionStyle("tie", focusedSection)}>
      <legend style={legendStyle}>Tie advanced</legend>
      <label style={labelStyle}>
        Target Note ID
        <FormInput
          data-testid="notation-tie-target"
          value={tie.target ?? ""}
          onChange={(e) => onTargetChange(e.target.value)}
        />
      </label>
      <label style={labelStyle}>
        Target Type
        <FormInput
          data-testid="notation-tie-target-type"
          value={tie.targetType ?? ""}
          onChange={(e) => onTargetTypeChange(e.target.value)}
        />
      </label>
      <label style={labelStyle}>
        Side
        <FormInput
          data-testid="notation-tie-side"
          value={tie.side ?? ""}
          onChange={(e) => onSideChange(e.target.value)}
        />
      </label>
      <Checkbox
        data-testid="notation-tie-lv"
        label="Laissez vibrer (LV)"
        checked={tie.lv === true}
        onChange={(e) => onLvChange(e.target.checked)}
      />
      {error && <div style={errorStyle}>{error}</div>}
    </fieldset>
  );
}

export interface SlurSectionProps {
  slur: Slur;
  focusedSection: InspectorSection | null;
  sectionRef: RefObject<HTMLFieldSetElement | null>;
  error: string | null;
  onTargetChange: (value: string) => void;
  onSideChange: (value: string) => void;
  onSideEndChange: (value: string) => void;
  onLineTypeChange: (value: string) => void;
  onStartNoteChange: (value: string) => void;
  onEndNoteChange: (value: string) => void;
}

export function SlurSection({
  slur,
  focusedSection,
  sectionRef,
  error,
  onTargetChange,
  onSideChange,
  onSideEndChange,
  onLineTypeChange,
  onStartNoteChange,
  onEndNoteChange,
}: SlurSectionProps) {
  return (
    <fieldset ref={sectionRef} style={mergeFocusedSectionStyle("slur", focusedSection)}>
      <legend style={legendStyle}>Slur advanced</legend>
      <label style={labelStyle}>
        Target Event ID
        <FormInput
          data-testid="notation-slur-target"
          value={slur.target ?? ""}
          onChange={(e) => onTargetChange(e.target.value)}
        />
      </label>
      <label style={labelStyle}>
        Side
        <Select
          data-testid="notation-slur-side"
          value={slur.side ?? ""}
          onValueChange={onSideChange}
          options={[...SIDE_OPTIONS]}
        />
      </label>
      <label style={labelStyle}>
        End Side
        <Select
          data-testid="notation-slur-side-end"
          value={slur.sideEnd ?? ""}
          onValueChange={onSideEndChange}
          options={[...SIDE_OPTIONS]}
        />
      </label>
      <label style={labelStyle}>
        Line Type
        <Select
          data-testid="notation-slur-line-type"
          value={slur.lineType ?? ""}
          onValueChange={onLineTypeChange}
          options={[...LINE_TYPE_OPTIONS]}
        />
      </label>
      <label style={labelStyle}>
        Start Note ID
        <FormInput
          data-testid="notation-slur-start-note"
          value={slur.startNote ?? ""}
          onChange={(e) => onStartNoteChange(e.target.value)}
        />
      </label>
      <label style={labelStyle}>
        End Note ID
        <FormInput
          data-testid="notation-slur-end-note"
          value={slur.endNote ?? ""}
          onChange={(e) => onEndNoteChange(e.target.value)}
        />
      </label>
      {error && <div style={errorStyle}>{error}</div>}
    </fieldset>
  );
}
