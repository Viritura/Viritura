import type {
  ArpeggioMarkKind,
  BreathMark,
  BreathMarkSymbol,
  Fingering,
  NonArpeggio,
  OrnamentType,
  Orientation,
  PartMeasureArpeggio,
  Pedal,
  PedalLineStyle,
  PedalType,
  Score,
  SequenceContent,
} from "@viritura/core";
import { FormInput, Select } from "@viritura/ui";
import { labelStyle, legendStyle, sectionStyle } from "./types";
import type { SelectableElementType } from "../../score/elementTypes";
import type { NotationSelectionTarget } from "../../commands/notationInspectorCommands";
import { useSelectedMarking } from "./useSelectedMarking";

const BREATH_SYMBOL_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "comma", label: "Comma" },
  { value: "tick", label: "Tick" },
  { value: "upbow", label: "Upbow" },
  { value: "salzedo", label: "Salzedo" },
];
const ORIENTATION_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "above", label: "Above" },
  { value: "below", label: "Below" },
];
const FINGERING_OPTIONS = Array.from({ length: 6 }, (_, finger) => ({ value: String(finger), label: String(finger) }));
const ORNAMENT_OPTIONS = [
  { value: "turn", label: "Turn" },
  { value: "invertedTurn", label: "Inverted turn" },
  { value: "mordent", label: "Mordent" },
  { value: "invertedMordent", label: "Inverted mordent" },
  { value: "shortTrill", label: "Short trill" },
  { value: "trillMordent", label: "Trill mordent" },
  { value: "delayedTurn", label: "Delayed turn" },
  { value: "schleifer", label: "Schleifer" },
];
const ARPEGGIO_OPTIONS = [
  { value: "plain", label: "Plain" },
  { value: "auto", label: "Arrow (auto)" },
  { value: "up", label: "Arrow up" },
  { value: "down", label: "Arrow down" },
  { value: "nonArpeggio", label: "Non-arpeggio" },
];
const PEDAL_TYPE_OPTIONS = [
  { value: "sustain", label: "Sustain" },
  { value: "sostenuto", label: "Sostenuto" },
  { value: "una-corda", label: "Una corda" },
];
const PEDAL_STYLE_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "bracket", label: "Bracket" },
];

const NUMBER_STYLE = { width: "5rem" };
const FRACTION_STYLE = { display: "flex", gap: "0.4rem", alignItems: "center" };

export interface BreathMarkSectionProps {
  breath: BreathMark;
  onSymbolChange: (symbol: BreathMarkSymbol) => void;
  onOrientationChange: (orient: Orientation | undefined) => void;
}

export function BreathMarkSection({ breath, onSymbolChange, onOrientationChange }: BreathMarkSectionProps) {
  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Breath Mark</legend>
      <label style={labelStyle}>
        Symbol
        <Select
          aria-label="Breath symbol"
          value={breath.symbol ?? "comma"}
          options={BREATH_SYMBOL_OPTIONS}
          onValueChange={(value) => onSymbolChange(value as BreathMarkSymbol)}
        />
      </label>
      <label style={labelStyle}>
        Placement
        <Select
          aria-label="Breath placement"
          value={breath.orient ?? ""}
          options={ORIENTATION_OPTIONS}
          onValueChange={(value) => onOrientationChange((value || undefined) as Orientation | undefined)}
        />
      </label>
    </fieldset>
  );
}

export interface FingeringSectionProps {
  fingering: Fingering;
  onValueChange: (finger: number) => void;
}

export function FingeringSection({ fingering, onValueChange }: FingeringSectionProps) {
  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Fingering</legend>
      <label style={labelStyle}>
        Value
        <Select
          aria-label="Fingering value"
          value={String(fingering.finger)}
          options={FINGERING_OPTIONS}
          onValueChange={(value) => onValueChange(Number(value))}
        />
      </label>
    </fieldset>
  );
}

export interface OrnamentSectionProps {
  ornaments: readonly OrnamentType[];
  onVariantChange: (index: number, ornament: OrnamentType) => void;
}

export function OrnamentSection({ ornaments, onVariantChange }: OrnamentSectionProps) {
  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Ornament</legend>
      {ornaments.map((ornament, index) => (
        <label key={index} style={labelStyle}>
          Variant {index + 1}
          <Select
            aria-label={`Ornament variant ${index + 1}`}
            value={ornament}
            options={ORNAMENT_OPTIONS}
            onValueChange={(value) => onVariantChange(index, value as OrnamentType)}
          />
        </label>
      ))}
    </fieldset>
  );
}

export interface ArpeggioSectionProps {
  kind: ArpeggioMarkKind;
  arpeggio: PartMeasureArpeggio | NonArpeggio;
  onKindChange: (kind: ArpeggioMarkKind) => void;
  onPositionChange: (axis: 0 | 1, value: number) => void;
  onSpanChange: (endpoint: "start" | "end", value: string) => void;
}

export function ArpeggioSection({
  kind,
  arpeggio,
  onKindChange,
  onPositionChange,
  onSpanChange,
}: ArpeggioSectionProps) {
  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Arpeggio</legend>
      <label style={labelStyle}>
        Variant
        <Select
          aria-label="Arpeggio variant"
          value={kind}
          options={ARPEGGIO_OPTIONS}
          onValueChange={(value) => onKindChange(value as ArpeggioMarkKind)}
        />
      </label>
      <label style={labelStyle}>
        Position
        <span style={FRACTION_STYLE}>
          <FormInput
            aria-label="Arpeggio position numerator"
            type="number"
            value={arpeggio.position.fraction[0]}
            style={NUMBER_STYLE}
            onChange={(event) => onPositionChange(0, Number(event.target.value))}
          />
          /
          <FormInput
            aria-label="Arpeggio position denominator"
            type="number"
            min={1}
            value={arpeggio.position.fraction[1]}
            style={NUMBER_STYLE}
            onChange={(event) => onPositionChange(1, Math.max(1, Number(event.target.value)))}
          />
        </span>
      </label>
      <label style={labelStyle}>
        Span start note ID
        <FormInput value={arpeggio.span.start} onChange={(event) => onSpanChange("start", event.target.value)} />
      </label>
      <label style={labelStyle}>
        Span end note ID
        <FormInput value={arpeggio.span.end} onChange={(event) => onSpanChange("end", event.target.value)} />
      </label>
    </fieldset>
  );
}

export interface PedalSectionProps {
  pedal: Pedal;
  onTypeChange: (type: PedalType) => void;
  onStyleChange: (style: PedalLineStyle) => void;
  onPositionChange: (axis: 0 | 1, value: number) => void;
  onEndMeasureChange: (measure: string) => void;
  onEndPositionChange: (axis: 0 | 1, value: number) => void;
  onStaffChange: (staff: number | undefined) => void;
  onVoiceChange: (voice: string) => void;
}

export function PedalSection({
  pedal,
  onTypeChange,
  onStyleChange,
  onPositionChange,
  onEndMeasureChange,
  onEndPositionChange,
  onStaffChange,
  onVoiceChange,
}: PedalSectionProps) {
  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Pedal</legend>
      <label style={labelStyle}>
        Type
        <Select
          aria-label="Pedal type"
          value={pedal.type}
          options={PEDAL_TYPE_OPTIONS}
          onValueChange={(value) => onTypeChange(value as PedalType)}
        />
      </label>
      <label style={labelStyle}>
        Line style
        <Select
          aria-label="Pedal line style"
          value={pedal.style ?? "text"}
          options={PEDAL_STYLE_OPTIONS}
          onValueChange={(value) => onStyleChange(value as PedalLineStyle)}
        />
      </label>
      <label style={labelStyle}>
        Start position
        <span style={FRACTION_STYLE}>
          <FormInput
            aria-label="Pedal start numerator"
            type="number"
            value={pedal.position.fraction[0]}
            style={NUMBER_STYLE}
            onChange={(event) => onPositionChange(0, Number(event.target.value))}
          />
          /
          <FormInput
            aria-label="Pedal start denominator"
            type="number"
            min={1}
            value={pedal.position.fraction[1]}
            style={NUMBER_STYLE}
            onChange={(event) => onPositionChange(1, Math.max(1, Number(event.target.value)))}
          />
        </span>
      </label>
      <label style={labelStyle}>
        End measure ID
        <FormInput value={pedal.end.measure ?? ""} onChange={(event) => onEndMeasureChange(event.target.value)} />
      </label>
      <label style={labelStyle}>
        End position
        <span style={FRACTION_STYLE}>
          <FormInput
            aria-label="Pedal end numerator"
            type="number"
            value={pedal.end.position.fraction[0]}
            style={NUMBER_STYLE}
            onChange={(event) => onEndPositionChange(0, Number(event.target.value))}
          />
          /
          <FormInput
            aria-label="Pedal end denominator"
            type="number"
            min={1}
            value={pedal.end.position.fraction[1]}
            style={NUMBER_STYLE}
            onChange={(event) => onEndPositionChange(1, Math.max(1, Number(event.target.value)))}
          />
        </span>
      </label>
      <label style={labelStyle}>
        Staff
        <FormInput
          aria-label="Pedal staff"
          type="number"
          min={1}
          value={pedal.staff ?? ""}
          onChange={(event) => onStaffChange(event.target.value === "" ? undefined : Number(event.target.value))}
        />
      </label>
      <label style={labelStyle}>
        Voice
        <FormInput value={pedal.voice ?? ""} onChange={(event) => onVoiceChange(event.target.value)} />
      </label>
    </fieldset>
  );
}

interface SelectedMarkingInspectorsProps {
  score: Score | null;
  target: NotationSelectionTarget | null;
  selectedElementType: SelectableElementType | null;
  selectedEvent: SequenceContent | null;
  updateScore: (score: Score) => void;
}

export function SelectedMarkingInspectors({
  score,
  target,
  selectedElementType,
  selectedEvent,
  updateScore,
}: SelectedMarkingInspectorsProps) {
  const marking = useSelectedMarking({
    score,
    target,
    selectedElementType,
    selectedEvent: selectedEvent?.type === "event" ? selectedEvent : null,
    updateScore,
  });
  return (
    <>
      {marking.selectedBreath && (
        <BreathMarkSection
          breath={marking.selectedBreath}
          onSymbolChange={marking.setBreathSymbol}
          onOrientationChange={marking.setBreathOrientation}
        />
      )}
      {marking.selectedFingering && (
        <FingeringSection fingering={marking.selectedFingering} onValueChange={marking.setFingeringValue} />
      )}
      {marking.selectedOrnaments && (
        <OrnamentSection ornaments={marking.selectedOrnaments} onVariantChange={marking.setOrnament} />
      )}
      {marking.selectedArpeggio && (
        <ArpeggioSection
          kind={marking.selectedArpeggio.kind}
          arpeggio={marking.selectedArpeggio.value}
          onKindChange={marking.setArpeggioKind}
          onPositionChange={marking.setArpeggioPosition}
          onSpanChange={marking.setArpeggioSpan}
        />
      )}
      {marking.selectedPedal && (
        <PedalSection
          pedal={marking.selectedPedal}
          onTypeChange={marking.setPedalType}
          onStyleChange={marking.setPedalStyle}
          onPositionChange={marking.setPedalPosition}
          onEndMeasureChange={marking.setPedalEndMeasure}
          onEndPositionChange={marking.setPedalEndPosition}
          onStaffChange={marking.setPedalStaff}
          onVoiceChange={marking.setPedalVoice}
        />
      )}
    </>
  );
}
