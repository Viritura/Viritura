import { Button } from "@viritura/ui";
import type { Fretboard, FretboardNote } from "@viritura/core";
import styles from "./FretboardEditor.module.css";

interface Props {
  frame: Fretboard;
  onNoteChange: (string: number, note: FretboardNote | undefined, existingFret?: number) => void;
}

export function FretboardGrid({ frame, onNoteChange }: Props) {
  const first = frame.firstFret?.fret ?? 1;
  const stringCount = Math.min(12, Math.max(2, Math.trunc(frame.frameStrings) || 2));
  const fretCount = Math.min(12, Math.max(1, Math.trunc(frame.frameFrets) || 1));
  const strings = Array.from({ length: stringCount }, (_, index) => stringCount - index);
  const gridStyle = { gridTemplateColumns: `2.5rem repeat(${stringCount}, minmax(2.25rem, 1fr))` };

  function setFret(string: number, fret: number) {
    const note = frame.frameNotes.find((entry) => entry.string === string && entry.fret === fret);
    if (note) {
      onNoteChange(string, undefined, fret);
      return;
    }
    const playedNote = frame.frameNotes.find((entry) => entry.string === string && !entry.barre);
    onNoteChange(string, { ...playedNote, string, fret });
  }

  return (
    <div className={styles.diagramViewport}>
      <div className={styles.diagramGrid} role="group" aria-label="Fret positions" style={gridStyle}>
        <span aria-hidden="true" />
        {strings.map((string) => (
          <span className={styles.stringLabel} key={string}>
            {string}
          </span>
        ))}
        <span className={styles.stateLabel}>State</span>
        {strings.map((string) => {
          const notes = frame.frameNotes.filter((entry) => entry.string === string);
          const openNote = notes.find((entry) => entry.fret === 0);
          return (
            <div className={styles.stringState} key={string}>
              <Button
                size="xs"
                shape="icon"
                variant="ghost"
                className={styles.stateButton}
                ariaLabel={`Set string ${string} to open`}
                active={openNote !== undefined}
                onClick={() => onNoteChange(string, openNote ? undefined : { string, fret: 0 }, openNote?.fret)}
              >
                O
              </Button>
              <Button
                size="xs"
                shape="icon"
                variant="ghost"
                className={styles.stateButton}
                ariaLabel={`Set string ${string} to unplayed`}
                active={notes.length === 0}
                onClick={() => onNoteChange(string, undefined)}
              >
                {frame.unplayed ?? "x"}
              </Button>
            </div>
          );
        })}
        {Array.from({ length: fretCount }, (_, index) => first + index).flatMap((fret, index) => [
          <span className={styles.fretLabel} key={`label-${fret}`}>
            {fret}
          </span>,
          ...strings.map((string) => {
            const selected = frame.frameNotes.some((entry) => entry.string === string && entry.fret === fret);
            return (
              <Button
                size="xs"
                shape="icon"
                variant="ghost"
                key={`${string}-${fret}`}
                className={`${styles.fretButton} ${first === 1 && index === 0 ? styles.nut : ""}`}
                ariaLabel={`Set string ${string} to fret ${fret}`}
                active={selected}
                onClick={() => setFret(string, fret)}
              >
                <span className={styles.fretDot} />
              </Button>
            );
          }),
        ])}
      </div>
    </div>
  );
}
