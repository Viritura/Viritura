# Note-scoped slide markings

MNX v46 defines `notes[].markings.slideIn` and `notes[].markings.slideOut`.
These annotations belong to an individual note, including a note inside a
chord; they are not event articulations and are not glissando/portamento spans.

| MNX property    | Values            | Notation meaning                                      |
| --------------- | ----------------- | ----------------------------------------------------- |
| `slideIn.type`  | `scoop`, `plop`   | Indeterminate slide into the note from below or above |
| `slideOut.type` | `falloff`, `doit` | Indeterminate slide downward or upward from the note  |

Viritura retains the nested global attributes (`id`, `_c`, and `_x`) and
serializes the markings natively, independently of vendor-extension settings.
The separate **Note markings** palette follows **Articulations**. The palette
and inspector update the selected noteheads only, so editing one chord member
does not change its neighbors. Slide-in and slide-out values can coexist and
can be removed independently.
Selections retain each tuplet's identity when applying markings across multiple
containers. Slide-in curves approach the notehead's left ink edge, and slide-out
curves start beyond its right ink edge rather than crossing the notehead.

MusicXML articulation elements `scoop`, `plop`, `falloff`, and `doit` are
converted on their originating XML note. MusicXML `<slide>` remains a
between-note span and is not converted into these note markings.

These are notation instructions only. MNX specifies no pitch-bend amount or
duration, so Viritura preserves and engraves them but does not alter playback
pitch or timing. The same layout paths are rendered through the existing
display list for Canvas, SVG, and PDF output.
