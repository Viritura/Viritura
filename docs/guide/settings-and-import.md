# Settings & Import

Open **Settings** from the bottom of the Activity Bar or through the jump bar.
Categories are searchable and are grouped by general, audio, file, and advanced
concerns.

## Account

Account settings cover identity, connected sign-in providers, password and
email management, two-factor authentication, recovery codes, and account
management. Local files remain usable without signing in.

## Appearance

Choose the editor theme and contrast treatment. Appearance settings affect the
application chrome; score paper, notation, and publication styling are
controlled separately in Engrave.

## Instrument profiles and audio

Instrument Profiles choose the sound sources available for document playback.

> [!NOTE]
> **Availability: Desktop app only**
>
> Audio Output, VST3 profile management, and Default Reverb settings appear only
> when the native audio host is available.

## MIDI input

Open **Audio → MIDI Input** to connect a MIDI keyboard or control surface.

> [!NOTE]
> **Availability: Web MIDI hosts only**
>
> MIDI input requires a browser or desktop webview that exposes Web MIDI, plus
> permission to access connected devices. Current Chromium and Firefox releases
> can provide Web MIDI; Safari and desktop hosts without the API cannot.

Select inputs separately by role:

- **Performance input** sends profiled keyboard notes for audition and note
  entry.
- **Control input** sends transport and editor commands from a recognized
  controller profile.

Choose **Enable** the first time to grant access. Later visits reconnect to
previously selected inputs when the browser retains permission. The current
built-in profile covers the Akai MPK Mini IV. Unprofiled ports remain visible
in the input picker and diagnostics, but do not yet drive audition, note entry,
or mapped commands. A recognized profile shows its port roles and fixed
mappings; custom profile editing is not yet available.

Outside note input, a performance input auditions the preview sound defined by
its controller profile. During note input, it previews the current instrumental
part while capturing notes or chords.

Use **MIDI diagnostics** to inspect incoming bytes, channels, note messages,
control changes, pressure, program changes, and pitch bend. This is useful when
a device appears but a key, pad, knob, or pedal does not perform the expected
action.

## Import

Choose **File → Import**, the Start Center's **Import** tile, or drag a supported
file into the editor. Viritura accepts MusicXML (`.musicxml` or `.xml`),
compressed MusicXML (`.mxl`), and Finale (`.musx`) files and opens the converted
result as a standalone MNX document.

Finale MUSX conversion runs in a dedicated worker using the bundled Denigma
converter. MUSX files are limited to 64 MiB, and the resulting MNX is validated
before it opens. The editor reports conversion warnings when Finale-specific
details cannot be carried across.

Import settings control vendor extensions and MusicXML behavior that cannot be
inferred unambiguously from the source file. Finale import currently uses the
converter's standard settings, including Tempo Tool data.

MusicXML import may request review when percussion sounds cannot be identified
reliably. See
[Percussion Maps — Review an imported map](/docs/percussion-maps#review-an-imported-map).

## Rendering and layout diagnostics

Rendering and Layout Debug are advanced diagnostic categories. They expose
canvas, cache, hit-region, spacing, and placement overlays intended for
development and engraving investigation.

These settings can make the score canvas visually noisy and may affect performance.
Leave them off for ordinary writing, playback, and publication work.

For opening projects and standalone files, see
[Getting Started](/docs#open-or-create-work).
