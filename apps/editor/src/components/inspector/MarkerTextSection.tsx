import { Button, Select, type SelectOption } from "@viritura/ui";
import type { MarkerText, MarkerTextPlacement } from "@viritura/core";
import type { CSSProperties } from "react";
import { labelStyle, legendStyle, sectionStyle } from "./types";
import { TextContentEditor } from "./TextContentEditor";
import { MARKER_DEFINITIONS, MARKER_TEXT_INHERITED_STYLE, type NavigationMarkerKind } from "./markerText";

const modeLabelStyle: CSSProperties = { ...labelStyle, gap: 6 };
const descriptionStyle: CSSProperties = { margin: 0, color: "var(--text-muted)", fontSize: "0.75rem" };

function placementOptions(noun: string): SelectOption[] {
  return [
    { value: "before", label: `Before ${noun}` },
    { value: "after", label: `After ${noun}` },
    { value: "replace", label: `Replace ${noun}` },
  ];
}

function isPlacement(value: string): value is MarkerTextPlacement {
  return value === "before" || value === "after" || value === "replace";
}

interface MarkerTextSectionProps {
  kind: NavigationMarkerKind;
  value: MarkerText | null;
  onChange: (value: MarkerText | null) => void;
}

export function MarkerTextSection({ kind, value, onChange }: MarkerTextSectionProps) {
  const definition = MARKER_DEFINITIONS[kind];
  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>{definition.title} Text</legend>
      <p style={descriptionStyle}>
        Authored text stays attached to this {definition.title.toLowerCase()} and does not change navigation.
      </p>
      {value ? (
        <>
          <div style={labelStyle}>
            <span>Text</span>
            <TextContentEditor
              value={value.content}
              onChange={(content) => onChange({ ...value, content })}
              placeholder={definition.placeholder}
              ariaLabel={`${definition.title} text`}
              inheritedStyle={MARKER_TEXT_INHERITED_STYLE}
            />
          </div>
          <label style={modeLabelStyle}>
            <span>Position</span>
            <Select
              aria-label={`${definition.title} text position`}
              value={value.placement}
              options={placementOptions(definition.noun)}
              onValueChange={(placement) => {
                if (isPlacement(placement)) onChange({ ...value, placement });
              }}
            />
          </label>
          <Button variant="link" size="sm" onClick={() => onChange(null)}>
            Remove text
          </Button>
        </>
      ) : (
        <Button
          variant="default"
          size="sm"
          onClick={() => onChange({ content: [{ text: "" }], placement: definition.defaultPlacement })}
        >
          Add text
        </Button>
      )}
    </fieldset>
  );
}

interface SelectedMarkerTextSectionProps {
  marker: { kind: NavigationMarkerKind; text: MarkerText | null } | null;
  onChange: (value: MarkerText | null) => void;
}

export function SelectedMarkerTextSection({ marker, onChange }: SelectedMarkerTextSectionProps) {
  if (!marker) return null;
  return <MarkerTextSection key={marker.kind} kind={marker.kind} value={marker.text} onChange={onChange} />;
}
