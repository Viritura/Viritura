import { FormInput, Select } from "@viritura/ui";
import type { Jump, Score } from "@viritura/core";
import type { NotationSelectionTarget } from "../../commands/notationInspectorCommands";
import { JUMP_LABELS, setNavigationMarkerProperties } from "../../commands/navigationMarkers";
import { navigationMarkerKind } from "./markerText";
import { labelStyle, legendStyle, sectionStyle } from "./types";

interface NavigationMarkerSectionProps {
  score: Score | null;
  target: NotationSelectionTarget | null;
  updateScore: (score: Score) => void;
}

function PositionInput({
  label,
  value,
  min,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  onCommit: (value: number) => void;
}) {
  return (
    <FormInput
      key={value}
      aria-label={label}
      type="number"
      min={min}
      step={1}
      defaultValue={value}
      onBlur={(event) => {
        const input = event.currentTarget;
        const number = Number(input.value);
        if (input.value.trim() && Number.isSafeInteger(number) && number >= min) onCommit(number);
        else input.value = String(value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

export function NavigationMarkerSection({ score, target, updateScore }: NavigationMarkerSectionProps) {
  const kind = navigationMarkerKind(target?.elementType);
  const marker = score && target && kind ? score.global.measures[target.measureIndex]?.[kind] : null;
  if (!score || !target || !kind || !marker) return null;
  const update = (properties: Parameters<typeof setNavigationMarkerProperties>[3]) =>
    updateScore(setNavigationMarkerProperties(score, target.measureIndex, kind, properties));
  const [numerator, denominator] = marker.location.fraction;
  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Navigation</legend>
      {kind === "jump" && (
        <label style={labelStyle}>
          Instruction
          <Select
            aria-label="Jump instruction"
            value={(marker as Jump).type}
            options={Object.entries(JUMP_LABELS).map(([value, label]) => ({ value, label }))}
            onValueChange={(type) => {
              if (Object.hasOwn(JUMP_LABELS, type)) update({ type: type as Jump["type"] });
            }}
          />
        </label>
      )}
      <label style={labelStyle}>
        Position numerator (whole notes)
        <PositionInput
          label="Marker position numerator"
          value={numerator}
          min={0}
          onCommit={(value) => update({ location: { ...marker.location, fraction: [value, denominator] } })}
        />
      </label>
      <label style={labelStyle}>
        Position denominator
        <PositionInput
          label="Marker position denominator"
          value={denominator}
          min={1}
          onCommit={(value) => update({ location: { ...marker.location, fraction: [numerator, value] } })}
        />
      </label>
      {(kind === "segno" || kind === "coda") && (
        <label style={labelStyle}>
          Glyph
          <Select
            aria-label="Marker glyph"
            value={(marker as { glyph?: string }).glyph ?? ""}
            options={[
              { value: "", label: "Default" },
              ...(kind === "segno"
                ? [
                    { value: "segno", label: "Segno" },
                    { value: "segnoSerpent1", label: "Serpent 1" },
                    { value: "segnoSerpent2", label: "Serpent 2" },
                  ]
                : [
                    { value: "coda", label: "Coda" },
                    { value: "codaSquare", label: "Square coda" },
                  ]),
            ]}
            onValueChange={(glyph) => update({ glyph: glyph || null })}
          />
        </label>
      )}
    </fieldset>
  );
}
