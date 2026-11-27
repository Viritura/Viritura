import { useState } from "react";
import { validateFretboard, type Fretboard, type FretboardNote } from "@viritura/core";
import { Button, FormInput, Select } from "@viritura/ui";
import { labelStyle } from "../types";

interface Props {
  partId: string;
  value?: Fretboard;
  onChange: (frame: Fretboard | undefined) => void;
}

export function FretboardEditor({ partId, value, onChange }: Props) {
  const [draft, setDraft] = useState<Fretboard>(value ?? { partId, frameStrings: 6, frameFrets: 5, frameNotes: [] });
  const [editing, setEditing] = useState(Boolean(value));
  if (!editing) return <Button onClick={() => setEditing(true)}>Add chord diagram</Button>;

  const errors = validateFretboard(draft);
  const first = draft.firstFret?.fret ?? 1;
  const stringCount = Math.min(12, Math.max(2, Math.trunc(draft.frameStrings) || 2));
  const fretCount = Math.min(12, Math.max(1, Math.trunc(draft.frameFrets) || 1));
  function updateNote(string: number, note: FretboardNote | undefined) {
    setDraft({
      ...draft,
      frameNotes: [...draft.frameNotes.filter((entry) => entry.string !== string), ...(note ? [note] : [])],
    });
  }
  return (
    <fieldset>
      <legend>Chord diagram</legend>
      <p>String 1 is the rightmost string. Fingerings are authored, not generated from the chord name.</p>
      <label style={labelStyle}>
        String count
        <FormInput
          type="number"
          min={2}
          max={12}
          value={draft.frameStrings}
          onChange={(event) => setDraft({ ...draft, frameStrings: Number(event.target.value) })}
        />
      </label>
      <label style={labelStyle}>
        Displayed frets
        <FormInput
          type="number"
          min={1}
          max={12}
          value={draft.frameFrets}
          onChange={(event) => setDraft({ ...draft, frameFrets: Number(event.target.value) })}
        />
      </label>
      <label style={labelStyle}>
        First fret
        <FormInput
          type="number"
          min={1}
          max={36}
          value={first}
          onChange={(event) =>
            setDraft({ ...draft, firstFret: { ...draft.firstFret, fret: Number(event.target.value) } })
          }
        />
      </label>
      <label style={labelStyle}>
        First-fret label
        <FormInput
          maxLength={16}
          value={draft.firstFret?.text ?? ""}
          onChange={(event) =>
            setDraft({
              ...draft,
              firstFret: { ...draft.firstFret, fret: first, text: event.target.value || undefined },
            })
          }
        />
      </label>
      <label style={labelStyle}>
        Label side
        <Select
          value={draft.firstFret?.location ?? "left"}
          options={[
            { value: "left", label: "Left" },
            { value: "right", label: "Right" },
          ]}
          onValueChange={(location) =>
            setDraft({
              ...draft,
              firstFret: { ...draft.firstFret, fret: first, location: location === "right" ? "right" : "left" },
            })
          }
        />
      </label>
      <label style={labelStyle}>
        Unplayed-string indicator
        <FormInput
          maxLength={8}
          value={draft.unplayed ?? "x"}
          onChange={(event) => setDraft({ ...draft, unplayed: event.target.value })}
        />
      </label>
      {Array.from({ length: stringCount }, (_, index) => stringCount - index).map((string) => {
        const note = draft.frameNotes.find((entry) => entry.string === string);
        const options = [
          { value: "", label: "Unplayed" },
          { value: "0", label: "Open" },
          ...Array.from({ length: fretCount }, (_, index) => ({
            value: String(first + index),
            label: `Fret ${first + index}`,
          })),
        ];
        return (
          <fieldset key={string}>
            <legend>String {string}</legend>
            <label style={labelStyle}>
              Position
              <Select
                value={note ? String(note.fret) : ""}
                options={options}
                onValueChange={(fret) =>
                  updateNote(
                    string,
                    fret === ""
                      ? undefined
                      : {
                          ...note,
                          string,
                          fret: Number(fret),
                          ...(fret === "0" ? { barre: undefined } : {}),
                        },
                  )
                }
              />
            </label>
            {note && (
              <>
                <label style={labelStyle}>
                  Fingering
                  <FormInput
                    maxLength={8}
                    value={note.fingering ?? ""}
                    onChange={(event) => updateNote(string, { ...note, fingering: event.target.value || undefined })}
                  />
                </label>
                {note.fret > 0 && (
                  <label style={labelStyle}>
                    Barre endpoint
                    <Select
                      value={note.barre ?? ""}
                      options={[
                        { value: "", label: "None" },
                        { value: "start", label: "Start" },
                        { value: "stop", label: "Stop" },
                      ]}
                      onValueChange={(barre) =>
                        updateNote(string, {
                          ...note,
                          barre: barre === "start" ? "start" : barre === "stop" ? "stop" : undefined,
                        })
                      }
                    />
                  </label>
                )}
              </>
            )}
          </fieldset>
        );
      })}
      {errors.length > 0 && <p role="alert">{[...new Set(errors)].join(" ")}</p>}
      <Button disabled={errors.length > 0} onClick={() => onChange(draft)}>
        Apply diagram
      </Button>
      <Button
        onClick={() => {
          onChange(undefined);
          setEditing(false);
        }}
      >
        Remove diagram
      </Button>
    </fieldset>
  );
}
