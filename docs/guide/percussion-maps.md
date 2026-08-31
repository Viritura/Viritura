# Percussion Maps

An unpitched percussion instrument needs more than a playback sound. Its
**percussion map** connects each playable sound to a staff position and
notehead, so the document can engrave and play the same musical intent.

## Open the percussion map

In **Setup → Instruments**, expand an unpitched percussion instrument and choose
**Edit Percussion Map…**.

Viritura may also open the map automatically:

- after adding a multi-piece percussion instrument;
- during MusicXML import when the source file does not identify every
  percussion sound with enough confidence.

The editor updates the percussion map stored on the instrument's MNX source
part. It does not change layout membership, create another source part, or
duplicate music.

## Understand the workbench

The workbench keeps three views of the same mapping together:

- The **engraved staff** shows the actual staff positions and noteheads.
- The **pad grid** gives every mapped sound a selectable, playable pad.
- The **inspector** edits the selected sound's name, playback sound, notehead,
  and staff position.

Selecting a notehead on the staff or a pad also auditions its assigned sound.
Use this to catch mappings that look correct but play the wrong instrument.

:::interactive id="editor.percussion-palette"
:::

## Start from a preset

Use **Load preset…** to replace the current mapping with:

- **Full Drum Kit** — kick, snare, hi-hats, toms, and crash;
- **Orchestral Percussion** — snare, bass drum, crash cymbals, tambourine, and
  triangle;
- **Minimal (Snare + Bass)** — a two-piece starting point.

Loading a preset is immediately reversible with **Undo**. Treat presets as
starting points: adapt their sounds, positions, and noteheads to the notation
practice expected by the performers.

## Select and audition a sound

Click a notehead on the engraved staff or click its pad. The selected sound
appears in the inspector and plays through the current percussion kit.

The pad shows its name, staff position, and notated glyph. Pad colors group
related drum families; they do not change the notation or playback mapping.

## Choose the playback sound

Open **Sound** in the inspector and search by a familiar name such as `snare`,
`gong`, or `crash`. You can also filter the catalog by kick, snare, hi-hat, tom,
cymbal, percussion, or world percussion.

Choosing an entry auditions and assigns it. Viritura handles the underlying
General MIDI key and any required GS drum-kit override; you do not need to enter
MIDI numbers manually.

## Set the notehead

Choose a notehead from the inspector's **Notehead** palette. Use notehead shape
to distinguish sounds that share or nearly share a staff position—for example,
closed and open hi-hat.

The engraved staff uses the same rendering engine as the score canvas, so the
preview is the notation that will appear in the score and instrumental part.

## Set the staff position

Move a sound in any of these ways:

- drag its notehead vertically on the engraved staff;
- enter a **Staff position** number;
- use the up and down stepper buttons.

Staff position `0` is the middle line. Even numbers are staff lines, odd
numbers are spaces, positive values move upward, and negative values move
downward.

Check ledger lines and collisions after moving a sound. A technically valid
position is not necessarily the clearest convention for performers.

## Add, rename, or remove a sound

- Click empty space on the engraved staff to add a sound at that position.
- Use the **+** pad to add a sound at a default position, then refine it in the
  inspector.
- Edit the name at the top of the inspector.
- Use the remove button in the inspector, or right-click a pad and choose
  **Delete**.
- Right-click a pad for a quick notehead change without opening the inspector
  palette.

A map must contain at least one sound before **Apply** is available.

## Review an imported map

MusicXML often identifies unpitched percussion by notation position without a
reliable sound identity. When Viritura asks for review:

1. Select and audition every uncertain entry.
2. Correct the playback sound first.
3. Confirm the performer-facing name.
4. Check the staff position and notehead against the source notation and your
   house practice.
5. Choose **Apply** only after the mapping sounds and reads correctly.

Recognized MusicXML instrument-sound mappings do not require manual review.

## Apply or cancel

Choose **Apply** to save the mapping into the document. Choose **Cancel** or
close the dialog to leave the existing mapping unchanged.

The percussion map is shared wherever that MNX source part appears. Updating it
therefore changes notation and playback consistently in the full score, section
scores, and the instrument's part extract.

For the distinction between an MNX source part and an instrumental part, see
[Scores, Parts & Layouts](/docs/instruments-and-scores#terminology). For
playback-channel controls, see
[Playback, Mixer & Piano Roll](/docs/playback-and-piano-roll).
