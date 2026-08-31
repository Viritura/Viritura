import type {
  DynamicGroup,
  DynamicPrefix,
  DynamicSuffix,
  DynamicValue,
  MultiStaffOrientation,
  WedgeType,
} from "@viritura/core";
import { FormInput, Select } from "@viritura/ui";
import { ManualOffsetFields, type ManualOffsetControl } from "./DirectionTextSection";
import { labelStyle, legendStyle, sectionStyle } from "./types";

const DYNAMIC_VALUES = [
  "n",
  "pppppp",
  "ppppp",
  "pppp",
  "ppp",
  "pp",
  "p",
  "mp",
  "mf",
  "f",
  "ff",
  "fff",
  "ffff",
  "fffff",
  "ffffff",
] as const;
const VALUE_OPTIONS = DYNAMIC_VALUES.map((value) => ({ value, label: value === "n" ? "niente" : value }));
const OPTIONAL_VALUE_OPTIONS = [{ value: "", label: "None" }, ...VALUE_OPTIONS];
const ACCENT_PREFIX_OPTIONS = [
  { value: "s", label: "s (sforzando)" },
  { value: "r", label: "r (rinforzando)" },
  { value: "", label: "None" },
] as const;
const ACCENT_SUFFIX_OPTIONS = [
  { value: "z", label: "z (zato)" },
  { value: "", label: "None" },
] as const;
const RELATIVE_OPTIONS = [
  { value: "louder", label: "Louder" },
  { value: "softer", label: "Softer" },
] as const;
const WEDGE_OPTIONS = [
  { value: "increasing", label: "Crescendo" },
  { value: "decreasing", label: "Diminuendo" },
] as const;
const ORIENTATION_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "above", label: "Above" },
  { value: "below", label: "Below" },
  { value: "between", label: "Between staves" },
] as const;

interface DynamicGroupSectionProps {
  dynamic: DynamicGroup;
  staffCount: number;
  voiceOptions?: readonly string[];
  onValueChange: (value: DynamicValue | undefined) => void;
  onResidualValueChange: (value: DynamicValue | undefined) => void;
  onAccentPrefixChange: (value: DynamicPrefix) => void;
  onAccentSuffixChange: (value: DynamicSuffix) => void;
  onRelativeValueChange: (value: "louder" | "softer") => void;
  onWedgeTypeChange: (value: WedgeType) => void;
  onPrefixChange: (value: string) => void;
  onSuffixChange: (value: string) => void;
  onOrientationChange: (value: MultiStaffOrientation | undefined) => void;
  onStaffChange: (value: number | undefined) => void;
  onStaffEndChange: (value: number | undefined) => void;
  onVisuallyContinuesChange: (value: string) => void;
  onVoiceChange: (value: string) => void;
  offset: ManualOffsetControl;
}

/** Variant-aware editor for one standard MNX dynamic group. */
export function DynamicGroupSection({
  dynamic,
  staffCount,
  voiceOptions = [],
  onValueChange,
  onResidualValueChange,
  onAccentPrefixChange,
  onAccentSuffixChange,
  onRelativeValueChange,
  onWedgeTypeChange,
  onPrefixChange,
  onSuffixChange,
  onOrientationChange,
  onStaffChange,
  onStaffEndChange,
  onVisuallyContinuesChange,
  onVoiceChange,
  offset,
}: DynamicGroupSectionProps) {
  const staffOptions = Array.from({ length: staffCount }, (_, index) => ({
    value: String(index + 1),
    label: `Staff ${index + 1}`,
  }));
  const scopedStaffOptions = [{ value: "", label: "All staves" }, ...staffOptions];
  const endStaffOptions = [{ value: "", label: "Same as start staff" }, ...staffOptions];
  const availableVoices = Array.from(new Set([...(dynamic.voice ? [dynamic.voice] : []), ...voiceOptions]));
  const scopedVoiceOptions = [
    { value: "", label: "All voices" },
    ...availableVoices.map((voice) => ({ value: voice, label: voice })),
  ];

  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Dynamic — {dynamic.type}</legend>

      {dynamic.type === "relative" ? (
        <label style={labelStyle}>
          Relative change
          <Select
            value={dynamic.relativeValue}
            options={[...RELATIVE_OPTIONS]}
            onValueChange={(value) => onRelativeValueChange(value as "louder" | "softer")}
          />
        </label>
      ) : dynamic.type === "gradual" ? (
        <>
          <label style={labelStyle}>
            Wedge
            <Select
              value={dynamic.wedgeType}
              options={[...WEDGE_OPTIONS]}
              onValueChange={(value) => onWedgeTypeChange(value as WedgeType)}
            />
          </label>
          <label style={labelStyle}>
            Start value
            <Select
              value={dynamic.value ?? ""}
              options={OPTIONAL_VALUE_OPTIONS}
              onValueChange={(value) => onValueChange((value || undefined) as DynamicValue | undefined)}
            />
          </label>
          <div style={labelStyle}>
            End
            <span>
              {dynamic.end.measure} @ {dynamic.end.position.fraction[0]}/{dynamic.end.position.fraction[1]}
            </span>
          </div>
        </>
      ) : (
        <label style={labelStyle}>
          Value
          <Select
            value={dynamic.value}
            options={VALUE_OPTIONS}
            onValueChange={(value) => onValueChange(value as DynamicValue)}
          />
        </label>
      )}

      {dynamic.type === "accent" && (
        <>
          <label style={labelStyle}>
            Accent prefix
            <Select
              value={dynamic.accentPrefix ?? "s"}
              options={[...ACCENT_PREFIX_OPTIONS]}
              onValueChange={(value) => onAccentPrefixChange(value as DynamicPrefix)}
            />
          </label>
          <label style={labelStyle}>
            Accent suffix
            <Select
              value={dynamic.accentSuffix ?? "z"}
              options={[...ACCENT_SUFFIX_OPTIONS]}
              onValueChange={(value) => onAccentSuffixChange(value as DynamicSuffix)}
            />
          </label>
          <label style={labelStyle}>
            Residual value
            <Select
              value={dynamic.residualValue ?? ""}
              options={OPTIONAL_VALUE_OPTIONS}
              onValueChange={(value) => onResidualValueChange((value || undefined) as DynamicValue | undefined)}
            />
          </label>
        </>
      )}

      <label style={labelStyle}>
        Prefix
        <FormInput value={dynamic.prefix ?? ""} onChange={(event) => onPrefixChange(event.target.value)} />
      </label>
      <label style={labelStyle}>
        Suffix
        <FormInput value={dynamic.suffix ?? ""} onChange={(event) => onSuffixChange(event.target.value)} />
      </label>
      <label style={labelStyle}>
        Orientation
        <Select
          value={dynamic.orient ?? ""}
          options={[...ORIENTATION_OPTIONS]}
          onValueChange={(value) => onOrientationChange((value || undefined) as MultiStaffOrientation | undefined)}
        />
      </label>
      {staffCount > 1 && (
        <>
          <label style={labelStyle}>
            {dynamic.type === "gradual" ? "Start staff" : "Staff"}
            <Select
              value={dynamic.staff?.toString() ?? ""}
              options={scopedStaffOptions}
              onValueChange={(value) => onStaffChange(value === "" ? undefined : Number(value))}
            />
          </label>
          {dynamic.type === "gradual" && (
            <label style={labelStyle}>
              End staff
              <Select
                value={dynamic.staffEnd?.toString() ?? ""}
                options={endStaffOptions}
                onValueChange={(value) => onStaffEndChange(value === "" ? undefined : Number(value))}
              />
            </label>
          )}
        </>
      )}
      <label style={labelStyle}>
        Visually continues
        <FormInput
          value={dynamic.visuallyContinues ?? ""}
          placeholder="Previous dynamic group ID"
          onChange={(event) => onVisuallyContinuesChange(event.target.value)}
        />
      </label>
      <label style={labelStyle}>
        Voice
        <Select value={dynamic.voice ?? ""} options={scopedVoiceOptions} onValueChange={onVoiceChange} />
      </label>
      <ManualOffsetFields offset={offset} />
    </fieldset>
  );
}
