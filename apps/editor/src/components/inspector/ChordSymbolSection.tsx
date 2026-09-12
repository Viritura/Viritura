import type { ChordQuality, ChordSymbol } from "@viritura/core";
import { FormInput, Select } from "@viritura/ui";
import { labelStyle, legendStyle, sectionStyle } from "./types";

const STEP_OPTIONS = ["A", "B", "C", "D", "E", "F", "G"].map((value) => ({ value, label: value }));
const OPTIONAL_STEP_OPTIONS = [{ value: "", label: "None" }, ...STEP_OPTIONS];
const ACCIDENTAL_OPTIONS = [
  { value: "-2", label: "Double flat" },
  { value: "-1", label: "Flat" },
  { value: "", label: "Natural" },
  { value: "1", label: "Sharp" },
  { value: "2", label: "Double sharp" },
];
const QUALITY_OPTIONS = [
  ["major", "Major"],
  ["minor", "Minor"],
  ["dominant", "Dominant"],
  ["diminished", "Diminished"],
  ["augmented", "Augmented"],
  ["half-diminished", "Half-diminished"],
  ["minor-major", "Minor-major"],
  ["power", "Power"],
  ["suspended2", "Suspended 2"],
  ["suspended4", "Suspended 4"],
  ["other", "Other"],
].map(([value, label]) => ({ value: value!, label: label! }));
const EXTENSION_OPTIONS = [
  { value: "", label: "None" },
  ...[6, 7, 9, 11, 13].map((value) => ({ value: String(value), label: String(value) })),
];
const EXTENSION_VALUES: Record<string, ChordSymbol["extension"]> = {
  "": undefined,
  "6": 6,
  "7": 7,
  "9": 9,
  "11": 11,
  "13": 13,
};

interface Props {
  chord: ChordSymbol;
  staffCount: number;
  onRootStepChange: (step: string) => void;
  onRootAlterChange: (alter: number | undefined) => void;
  onQualityChange: (quality: ChordQuality) => void;
  onKindTextChange: (text: string) => void;
  onExtensionChange: (extension: ChordSymbol["extension"]) => void;
  onBassStepChange: (step: string | undefined) => void;
  onBassAlterChange: (alter: number | undefined) => void;
  onStaffChange: (staff: number | undefined) => void;
  onTextOverrideChange: (text: string) => void;
}

export function ChordSymbolSection(props: Props) {
  const { chord, staffCount } = props;
  const staffOptions = [
    { value: "", label: "Top staff" },
    ...Array.from({ length: staffCount }, (_, index) => ({
      value: String(index + 1),
      label: `Staff ${index + 1}`,
    })),
  ];

  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Chord Symbol</legend>
      <label style={labelStyle}>
        Root
        <Select value={chord.root.step} options={STEP_OPTIONS} onValueChange={props.onRootStepChange} />
      </label>
      <label style={labelStyle}>
        Root accidental
        <Select
          value={chord.root.alter?.toString() ?? ""}
          options={ACCIDENTAL_OPTIONS}
          onValueChange={(value) => props.onRootAlterChange(value === "" ? undefined : Number(value))}
        />
      </label>
      <label style={labelStyle}>
        Quality
        <Select
          value={chord.quality}
          options={QUALITY_OPTIONS}
          onValueChange={(value) => props.onQualityChange(value as ChordQuality)}
        />
      </label>
      {chord.quality === "other" && (
        <label style={labelStyle}>
          Quality text
          <FormInput
            value={chord.kindText ?? ""}
            placeholder="e.g. Neapolitan"
            onChange={(event) => props.onKindTextChange(event.target.value)}
          />
        </label>
      )}
      <label style={labelStyle}>
        Extension
        <Select
          value={chord.extension?.toString() ?? ""}
          options={EXTENSION_OPTIONS}
          onValueChange={(value) => props.onExtensionChange(EXTENSION_VALUES[value])}
        />
      </label>
      <label style={labelStyle}>
        Bass
        <Select
          value={chord.bass?.step ?? ""}
          options={OPTIONAL_STEP_OPTIONS}
          onValueChange={(value) => props.onBassStepChange(value || undefined)}
        />
      </label>
      {chord.bass && (
        <label style={labelStyle}>
          Bass accidental
          <Select
            value={chord.bass.alter?.toString() ?? ""}
            options={ACCIDENTAL_OPTIONS}
            onValueChange={(value) => props.onBassAlterChange(value === "" ? undefined : Number(value))}
          />
        </label>
      )}
      {staffCount > 1 && (
        <label style={labelStyle}>
          Staff
          <Select
            value={chord.staff?.toString() ?? ""}
            options={staffOptions}
            onValueChange={(value) => props.onStaffChange(value === "" ? undefined : Number(value))}
          />
        </label>
      )}
      <label style={labelStyle}>
        Display override
        <FormInput
          value={chord.textOverride ?? ""}
          placeholder="Use semantic spelling"
          onChange={(event) => props.onTextOverrideChange(event.target.value)}
        />
      </label>
    </fieldset>
  );
}
