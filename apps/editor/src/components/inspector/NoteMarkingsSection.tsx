import type { NoteMarkings, SlideInType, SlideOutType } from "@viritura/core";
import { Select } from "@viritura/ui";
import { sectionStyle, legendStyle } from "./types";

const SLIDE_IN_OPTIONS = [
  { value: "", label: "None" },
  { value: "scoop", label: "Scoop" },
  { value: "plop", label: "Plop" },
] as const;

const SLIDE_OUT_OPTIONS = [
  { value: "", label: "None" },
  { value: "falloff", label: "Falloff" },
  { value: "doit", label: "Doit" },
] as const;

export interface NoteMarkingsSectionProps {
  markings: NoteMarkings | undefined;
  onSlideInChange: (type: SlideInType | undefined) => void;
  onSlideOutChange: (type: SlideOutType | undefined) => void;
}

export function NoteMarkingsSection({ markings, onSlideInChange, onSlideOutChange }: NoteMarkingsSectionProps) {
  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Note markings</legend>
      <label>
        Slide in
        <Select
          aria-label="Slide in"
          value={markings?.slideIn?.type ?? ""}
          options={SLIDE_IN_OPTIONS}
          onValueChange={(value) => onSlideInChange(value === "" ? undefined : (value as SlideInType))}
        />
      </label>
      <label>
        Slide out
        <Select
          aria-label="Slide out"
          value={markings?.slideOut?.type ?? ""}
          options={SLIDE_OUT_OPTIONS}
          onValueChange={(value) => onSlideOutChange(value === "" ? undefined : (value as SlideOutType))}
        />
      </label>
      <p>Notation only; no playback pitch or duration is defined.</p>
    </fieldset>
  );
}
