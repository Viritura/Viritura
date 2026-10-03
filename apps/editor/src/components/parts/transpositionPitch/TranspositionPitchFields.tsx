import { FormField, FormInput, Select } from "@viritura/ui";
import {
  intervalForSoundingPitch,
  PITCH_LETTERS,
  pitchSpelling,
  soundingPitchFor,
  soundingPitchLabel,
  type SoundingPitch,
} from "./pitch";
import { transpositionPitchPresets } from "./presets";
import styles from "./TranspositionPitchFields.module.css";

export interface TranspositionPitchFieldsProps {
  instrumentId?: string;
  halfSteps: number;
  staffDistance: number;
  onChange: (halfSteps: number, staffDistance: number) => void;
}

const SPELLINGS = PITCH_LETTERS.flatMap((letter) =>
  [-2, -1, 0, 1, 2].map((accidental) => ({
    value: `${letter}:${accidental}`,
    label: pitchSpelling({ letter, accidental }),
  })),
);

export function TranspositionPitchFields({
  instrumentId,
  halfSteps,
  staffDistance,
  onChange,
}: TranspositionPitchFieldsProps) {
  const pitch = soundingPitchFor(halfSteps, staffDistance);
  const [octaveDraft, setOctaveDraft] = useState(String(pitch.octave));
  const [previousOctave, setPreviousOctave] = useState(pitch.octave);
  if (previousOctave !== pitch.octave) {
    setPreviousOctave(pitch.octave);
    setOctaveDraft(String(pitch.octave));
  }
  const presets = transpositionPitchPresets(instrumentId);
  const selected = presets.find((preset) => preset.halfSteps === halfSteps && preset.staffDistance === staffDistance);
  const spelling = `${pitch.letter}:${pitch.accidental}`;
  const spellings = SPELLINGS.some((option) => option.value === spelling)
    ? SPELLINGS
    : [...SPELLINGS, { value: spelling, label: pitchSpelling(pitch) }];
  const changePitch = (next: SoundingPitch) => {
    const interval = intervalForSoundingPitch(next);
    onChange(interval.halfSteps, interval.staffDistance);
  };

  return (
    <div className={styles.root}>
      <FormField label="Transposition preset">
        <Select
          value={selected?.id ?? "custom"}
          options={[
            ...presets.map((preset) => ({ value: preset.id, label: preset.label })),
            { value: "custom", label: "Custom pitch", disabled: true },
          ]}
          onValueChange={(id) => {
            const preset = presets.find((option) => option.id === id);
            if (preset) onChange(preset.halfSteps, preset.staffDistance);
          }}
        />
      </FormField>
      <p className={styles.summary}>Written C4 sounds as {soundingPitchLabel(halfSteps, staffDistance)}</p>
      <div className={styles.pitch}>
        <FormField label="Sounding pitch">
          <Select
            value={spelling}
            options={spellings}
            onValueChange={(value) => {
              const [letter, accidental] = value.split(":");
              changePitch({ ...pitch, letter: letter as SoundingPitch["letter"], accidental: Number(accidental) });
            }}
          />
        </FormField>
        <FormField label="Sounding octave">
          <FormInput
            type="number"
            step={1}
            value={octaveDraft}
            onChange={(event) => {
              const raw = event.target.value;
              setOctaveDraft(raw);
              const octave = Number(raw);
              if (raw !== "" && Number.isSafeInteger(octave)) changePitch({ ...pitch, octave });
            }}
            onBlur={() => setOctaveDraft(String(pitch.octave))}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </FormField>
      </div>
      <p className={styles.summary}>
        Changes transposition only; instrument identity and playback timbre stay unchanged.
      </p>
    </div>
  );
}
import { useState } from "react";
