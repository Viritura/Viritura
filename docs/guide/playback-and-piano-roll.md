# Playback, Mixer & Piano Roll

Playback is available throughout the editor. The **Play** activity adds the
mixer, sound assignment, and spatial stage; **Roll** provides a performance
visualization of the same playback timeline.

## Transport

Press `Space` to play or pause. Playback begins at the current selection when
one is available, otherwise at the start of the score. Use the transport bar to
seek, control following, and monitor the playhead.

Playback follows tempo, dynamics, articulations, repeats, and the document's
sound assignments. Unpitched percussion uses its instrument's percussion map.

## Mixer

The mixer has one channel for each instrument. Use it to adjust:

- output level;
- mute and solo state;
- stereo position;
- reverb send;
- the sound source assigned to the instrument.

Mute and solo remain active when you switch away from Play because they belong
to the playback engine, not just the visible mixer.

## Sound assignments

Open a channel's sound picker to choose the playback source for that instrument.
Browser playback uses the available sampler and SoundFont sources. Instrument
profiles keep sound assignments associated with the document.

> [!NOTE]
> **Availability: Desktop app only**
>
> VST3 instruments, native audio output, and effect chains require the desktop
> audio host. Browser playback uses web audio and sampler-based sound sources.

## Spatial stage

The center of Play shows the ensemble on a stage. Drag instruments to change
their stereo and depth placement. Viritura seeds conventional orchestral
positions, but the arrangement can be customized and is stored with the
document.

Repeated or layered instruments may appear as grouped or child sources so the
spatial view matches what the audio engine is actually rendering.

## Piano Roll

The **Roll** activity is a read-only falling-note visualization: notes approach
a full piano keyboard while sounding keys light in their instrument-family
colors.

Roll uses the same transport and playback timeline as the notation view. It is
useful for checking register, density, entrances, and harmonic motion, but note
editing is not currently wired from the piano roll. Make changes in **Write**.

For score navigation and playback following, see
[Viewing & Review](/docs/viewing-and-review). For percussion sound assignments,
see [Scores, Parts & Layouts](/docs/instruments-and-scores#percussion-maps).
