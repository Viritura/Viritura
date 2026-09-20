import {
  formatChordSymbolText,
  resolveChordSymbol,
  UNSUPPORTED_CHORD_MESSAGE,
  type ChordQuality,
  type ChordSymbol,
  type Part,
} from "@viritura/core";
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
  sourcePart?: Part;
  onTextChange: (text: string) => void;
  onRootStepChange: (step: string) => void;
  onRootAlterChange: (alter: number | undefined) => void;
  onQualityChange: (quality: ChordQuality) => void;
  onKindTextChange: (text: string) => void;
  onExtensionChange: (extension: ChordSymbol["extension"]) => void;
  onBassStepChange: (step: string | undefined) => void;
  onBassAlterChange: (alter: number | undefined) => void;
  onVisibilityChange: (visibility: NonNullable<Part["chordSymbolVisibility"]>) => void;
  onTextOverrideChange: (text: string) => void;
}

function ChordTextInput({
  value,
  onCommit,
  placeholder,
}: {
  value: string;
  onCommit: (text: string) => void;
  placeholder: string;
}) {
  return (
    <FormInput
      key={value}
      defaultValue={value}
      placeholder={placeholder}
      onBlur={(event) => {
        if (event.target.value !== value) onCommit(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.value = value;
          event.currentTarget.blur();
        } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function ChordSymbolSection(props: Props) {
  const { chord, sourcePart } = props;
  const resolution = resolveChordSymbol(chord);

  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Chord Symbol</legend>
      <label style={labelStyle}>
        Chord text
        <ChordTextInput
          value={chord.rawText ?? formatChordSymbolText({ ...chord, textOverride: undefined })}
          placeholder="e.g. F#maj7/A#"
          onCommit={props.onTextChange}
        />
      </label>
      {resolution.status === "unsupported" && <p role="status">{UNSUPPORTED_CHORD_MESSAGE}</p>}
      {resolution.status === "silent" && <p role="status">No chord: silent.</p>}
      {chord.root && (
        <>
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
              value={chord.quality ?? "major"}
              options={QUALITY_OPTIONS}
              onValueChange={(value) => props.onQualityChange(value as ChordQuality)}
            />
          </label>
          {chord.quality === "other" && (
            <label style={labelStyle}>
              Quality text
              <ChordTextInput
                value={chord.kindText ?? ""}
                placeholder="e.g. Neapolitan"
                onCommit={props.onKindTextChange}
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
        </>
      )}
      {sourcePart && (
        <label style={labelStyle}>
          Chord visibility — {sourcePart.name}
          <Select
            value={sourcePart.chordSymbolVisibility ?? "auto"}
            options={[
              { value: "auto", label: "Auto" },
              { value: "show", label: "Show" },
              { value: "hide", label: "Hide" },
            ]}
            onValueChange={(value) => props.onVisibilityChange(value as NonNullable<Part["chordSymbolVisibility"]>)}
          />
        </label>
      )}
      <label style={labelStyle}>
        Display override
        <ChordTextInput
          value={chord.textOverride ?? ""}
          placeholder="Use semantic spelling"
          onCommit={props.onTextOverrideChange}
        />
      </label>
    </fieldset>
  );
}
