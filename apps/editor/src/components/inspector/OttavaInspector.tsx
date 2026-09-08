import type { Orientation, Score } from "@viritura/core";
import { Select } from "@viritura/ui";
import type { NotationSelectionTarget } from "../../commands/notationInspectorCommands";
import { labelStyle, legendStyle, sectionStyle } from "./types";
import { useOttavaInspector } from "./useOttavaInspector";

const DISPLACEMENT_OPTIONS = [
  { value: "1", label: "8va (up 1 octave)" },
  { value: "-1", label: "8vb (down 1 octave)" },
  { value: "2", label: "15ma (up 2 octaves)" },
  { value: "-2", label: "15mb (down 2 octaves)" },
  { value: "3", label: "22ma (up 3 octaves)" },
  { value: "-3", label: "22mb (down 3 octaves)" },
] as const;
const ORIENTATION_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "above", label: "Above" },
  { value: "below", label: "Below" },
] as const;

interface OttavaInspectorProps {
  score: Score | null;
  target: NotationSelectionTarget | null;
  updateScore: (score: Score) => void;
}

export function OttavaInspector({ score, target, updateScore }: OttavaInspectorProps) {
  const state = useOttavaInspector({ score, target, updateScore });
  if (!state) return null;

  const staffOptions = [
    { value: "", label: "All staves" },
    ...Array.from({ length: state.staffCount }, (_, index) => ({
      value: String(index + 1),
      label: `Staff ${index + 1}`,
    })),
  ];
  const voiceOptions = [
    { value: "", label: "All voices" },
    ...state.voiceOptions.map((voice) => ({ value: voice, label: voice })),
  ];
  const start = state.ottava.position.fraction;
  const end = state.ottava.end.position.fraction;

  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Ottava</legend>
      <label style={labelStyle}>
        Displacement
        <Select
          aria-label="Ottava displacement"
          value={String(state.ottava.value)}
          options={DISPLACEMENT_OPTIONS}
          onValueChange={(value) => state.onValueChange(Number(value))}
        />
      </label>
      <label style={labelStyle}>
        Orientation
        <Select
          aria-label="Ottava orientation"
          value={state.ottava.orient ?? ""}
          options={ORIENTATION_OPTIONS}
          onValueChange={(value) => state.onOrientationChange((value || undefined) as Orientation | undefined)}
        />
      </label>
      <label style={labelStyle}>
        Staff
        <Select
          aria-label="Ottava staff"
          value={state.ottava.staff?.toString() ?? ""}
          options={staffOptions}
          onValueChange={(value) => state.onStaffChange(value ? Number(value) : undefined)}
        />
      </label>
      <label style={labelStyle}>
        Voice
        <Select
          aria-label="Ottava voice"
          value={state.ottava.voice ?? ""}
          options={voiceOptions}
          onValueChange={state.onVoiceChange}
        />
      </label>
      <div style={labelStyle}>
        Span
        <span>
          {start[0]}/{start[1]} → {state.ottava.end.measure} @ {end[0]}/{end[1]}
        </span>
        <span>Drag either endpoint handle in the score to adjust the span.</span>
      </div>
    </fieldset>
  );
}
