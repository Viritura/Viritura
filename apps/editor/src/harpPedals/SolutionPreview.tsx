import { collectHarpPedalNotes, type HarpPedalSolution, type Score } from "@viritura/core";
import { formatHarpPedalText } from "./harpPedalText";
import styles from "./HarpPedalPopover.module.css";

interface Props {
  solution: HarpPedalSolution;
  score: Score | null;
  partIndex: number;
}

function formatPitch(pitch: { step: string; alter?: number; octave: number }): string {
  const accidental = pitch.alter === -1 ? "b" : pitch.alter === 1 ? "#" : pitch.alter ? `${pitch.alter}` : "";
  return `${pitch.step}${accidental}${pitch.octave}`;
}

export function SolutionPreview({ solution, score, partIndex }: Props) {
  const notes = score ? collectHarpPedalNotes(score, partIndex) : [];

  return (
    <>
      <p>
        {solution.settingChanges} pedal setting changes, {solution.pedalMovements} pedal movements,{" "}
        {solution.spellingEdits.length} respelled {solution.spellingEdits.length === 1 ? "note" : "notes"}.
      </p>
      <ol className={styles.solutionPreview}>
        {solution.settings.map((setting, index) => (
          <li key={`${setting.measureIndex}:${setting.fraction.join("/")}:${index}`}>
            Measure {setting.measureIndex + 1}, {formatHarpPedalText(setting.tuning)}
          </li>
        ))}
      </ol>
      {solution.spellingEdits.length > 0 && (
        <ul className={styles.solutionPreview}>
          {solution.spellingEdits.map((edit) => {
            const original = notes.find((note) => note.eventId === edit.eventId && note.noteIndex === edit.noteIndex);
            return (
              <li key={`${edit.eventId}:${edit.noteIndex}`}>
                {original ? formatPitch(original.pitch) : `Note ${edit.noteIndex + 1}`} {"->"} {formatPitch(edit.pitch)}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
