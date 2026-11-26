# Click sessions (Click activity)

The **Click** activity turns the open score into a click-only feed for practice
and for recording in an external DAW. Viritura never records audio; it plays
clicks through a dedicated engine and leaves capture to the DAW.

**Related:** [Viritura extensions](viritura-extensions.md#tempo-owned-click-subdivisions),
[file format](file-format.md),
[server-synchronized click experiment](../experiments/server-synchronized-click-track.md).

## Scope

- One device, one wired output. Synchronized clicks across devices, DAW
  transport sync, audio capture, and take management are out of scope.
- MNX is the only track format. Meter, beat grouping, tempo, ramps, holds,
  repeats, and rehearsal marks already describe the click; no click file,
  manifest, or compiled timestamps are stored.
- Setlists are plain folders or Gists of `.mnx` files, ordered by filename.
  Rename files (for example with a numeric prefix) to reorder them.
- Session settings (tempo percentage, countoff length, selected start) are
  in-memory UI state. They are never written to a score or shared source.

## Activity surface

[`ClickView`](../../apps/editor/src/click/ClickView.tsx) is a lazily loaded
Activity Bar view (see
[`lazyActivities`](../../apps/editor/src/app/lazyActivities.tsx)). It reuses the
editor's mounted `ScoreCanvas` for score/part selection, view mode, bar taps,
and the playhead; it never mounts a second viewer, engraving engine, or
scheduler. Opening the activity creates no audio.

**Stopped:**

- The toolbar holds the searchable score/part picker and **Session tempo %**
  (0 to 100% in 1% steps; 0% disables Start).
- The status bar is shared with Write: Concert/Written, view mode (**Page**,
  **Spread**, **Spread (H)**, **Horizon**), zoom, the percentage (click to
  restore calibrated 100%), and **Fit**. Click defaults to fit-height Horizon.
  In Click the status bar collapses to one row on narrow screens.
- The floating transport shows two horizontal dials, a one- or two-bar
  countoff selector with its cue (for example "4 clicks free"), **Keep above
  other apps**, and **Start** (also **Space**).
- Drag the score to pan; tap a bar to select its start. Repeated bars select the
  nearest full-bar visit (ties prefer the earlier one).

**Playing (including countoff):**

- The app header and activity rail disappear and the score auto-fits the
  expanded viewport. Stop, natural end, or an audio interruption restores the
  layout and previous zoom.
- The transport becomes a compact panel with the position and **Stop**, keeping
  its screen edge so Stop lands where Start was.
- Countoff shows remaining scheduled clicks as negative numbers (`-8` through
  `-1`), then `bar:beat`. Beats follow the meter's main groups; subdivisions do
  not advance the beat.
- An accent-colored outline and glow pulse on each beat (stronger on downbeats)
  from the audio clock. **Settings > Playback** offers every beat, downbeats
  only, or off; reduced motion disables it.
- Stopping selects the current performed bar visit from the audio thread's
  acknowledged position. The next Start plays a fresh countoff from there.
- Document edits (MCP, collaborators) interrupt an active or preparing take with
  a visible message. The new document is adopted after Stop, and the selected
  start is kept when still valid.

**Paginated following:** the playhead centers the whole page or spread and turns
by whole frames, including backwards repeats and jumps. Spreads pair 2 and 3,
4 and 5, and so on after a lone first page. Past a recto's halfway bar, the
following verso replaces the left page; in Page mode the last system triggers a
clipped top-half preview of the next page. Horizon scrolls continuously.

### Navigation dials

- The upper dial lists rehearsal marks and named tempo changes (tempo markings
  with visible text; rit., accel., and text-free metronome marks are excluded),
  adjacent regardless of distance. The lower dial lists bars, distinguishing
  repeat visits. Rehearsal letters are never inferred from bar numbers.
- Selecting an upper entry centers its bar below; selecting a bar highlights
  its preceding entry. Scores without entries show only the bar dial.
- The selected start's time signature sits left of the upper dial and its
  effective quarter-note tempo (including the session percentage) left of the
  lower dial, both drawn with SMuFL glyphs.
- Swipe, scroll, tap, arrow keys, and Home/End work. Start is disabled until a
  gesture settles, so Start never consumes a moving candidate.
- Partial visits (starting inside a bar) are shown but are not selectable.
  Screen readers hear the committed selection, not each scroll frame or beat.

### Movable controller

| Host                        | Behavior                                                                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-page floating panel      | Drag any non-interactive area by mouse or touch, or focus it and use arrow keys (Shift for larger steps). Bounded to the score viewport and re-clamped on resize. |
| Document Picture-in-Picture | **Keep above other apps** (while stopped) moves the controls into an always-on-top window beside a DAW.                                                           |

The opener owns audio, selection, and scheduling; the picture window only
renders the shared controls and sends commands (Space works there too). The
in-page panel then shows position, Start/Stop, and **Return controls**; the
picture window relies on its own close button. Detaching, returning, or closing
never interrupts a take, and closing restores focus to the editor.

Controls keep their designed size. The window opens at the in-page controls'
measured size, shrinks to the compact panel on Start, and restores its stopped
size on Stop. Browsers allow resizing only during user activation, so when a
take ends on its own or is stopped from the opener the window keeps its size.

Support is feature-detected; without it the transport stays in-page with an
explanation. A tab has one Document PiP window: if the Picture activity owns
it, the controller offers **Replace picture window** rather than closing it
silently. The shared adapter is
[`documentPictureInPicture`](../../packages/ui/src/pictureInPicture/documentPictureInPicture.ts).
Avoid tooltips and portal menus inside the window; they portal into the opener.

### Click sound

**Settings > Playback** offers **Oscillator** (default), tick, or woodblock for
both the Click activity and the editor metronome. Voices are generated up front
and selected on the audio thread without moving scheduled frames.

- Oscillator: 880 Hz, 50 ms accent at gain 0.8; 440 Hz, 30 ms beat at gain
  0.4; 440 Hz subdivision at gain 0.2; each decays exponentially to 0.001.
- Tick and woodblock: the accent sits a fifth above the beat and the
  subdivision a fourth below; lower levels ring shorter and darker, so levels
  differ by pitch and timbre, not only loudness.

## Click program

[`buildClickSessionProgram`](../../packages/playback/src/clickSession/clickSessionProgram.ts)
compiles the start bar, countoff, beat grouping, subdivisions, holds, and tempo
percentage. Timing comes from
[`compilePlaybackTiming`](../../packages/midi/src/playbackTiming/index.ts),
which reuses navigation, pickup/cadenza lengths, holds, and continuous tempo
realization without generating instrument notes. The editor metronome and
count-in use the same compiler.

### Resolution

- One click per beat from `resolveMeter`, including authored irregular grouping
  (10/8 as `3+2+2+3` gives four beat clicks). Resolution is never inferred
  from BPM.
- Tempo markings carry `_x.viritura.clickSubdivision` (1 to 5), edited as
  **Clicks per beat** in the tempo inspector. Omitted means 1: a subdivision
  lasts until the next tempo and never carries over. Click-only instructions,
  including mid-bar positions and `systemText[].tempo`, store an explicit value
  without fabricating BPM.
- Subdivisions divide each resolved beat equally; unequal groups therefore give
  unequal tick spacing. A boundary click belongs to the new region exactly
  once. Subdivisions stay straight; score swing never alters a click.
- Repeats, endings, and jumps restore the source location's pattern. Ramps
  change timing, not resolution. BPM-free text and swing instructions do not
  reset BPM or interrupt ramps.
- Global fermatas either silence clicks or keep the active subdivision through
  the hold; caesura gaps are silent.

### Countoff

| Action           | Countoff                                                          |
| ---------------- | ----------------------------------------------------------------- |
| Start or restart | Fresh one or two bars (default one)                               |
| Start at any bar | That bar's meter and instantaneous tempo, frozen for the countoff |
| Switch track     | Silent until Start                                                |
| Natural end      | Stop; no autoplay of the next track                               |

The countoff is synthetic: it never replays the preceding bar, which may differ
in tempo or meter, and never changes bar numbers or durations. It uses the
start's local pattern, so each 6/8 countoff bar spans six eighths and each 5/8
bar five eighths. A ramp inside the start bar begins after the countoff. A
pickup counts full bars of its governing meter and then plays the authored
pickup unpadded. Starts are bar boundaries only.

"Clicks free" counts the counted beats in the countoff, distinct from audible
subdivision ticks. The cue and the scheduler derive from one start description,
so a deleted or uncompilable target disables Start with a diagnostic.

### Tempo percentage

`effective BPM = written BPM * tempoPercent / 100`, applied to every segment,
ramp, countoff, and displayed duration. It is editable only while stopped,
survives track switches, and never rewrites the MNX.

## Engine and timing guarantees

A click session is not a muted score. Entering the activity, and every Start,
awaits `PlaybackActions.releaseAudio()`, which stops playback, destroys samplers
and SF2 synths, releases native hosts, and suspends the score AudioContext. Any
editor transport start while the activity is open is released again. A
high-priority **Space** binding keeps the editor shortcut from starting
instrument playback. Missing soundfonts or VST hosts never block clicks. Click
code is reached through the `@viritura/audio/click`, `@viritura/playback/click`,
and `@viritura/midi/timing` package exports to avoid the broad barrels.

[`ClickEngine`](../../packages/audio/src/clickEngine/ClickEngine.ts) runs a
private AudioContext containing only `viritura-click-processor.js` (staged by
`stage-sounds`, since the production CSP forbids `blob:` worklets):

- The complete program, including the endpoint after the final beat, is
  transferred before arming as sample frames rounded from absolute times, so
  rounding never accumulates.
- Countoff and track share one future anchor frame. A stale or past anchor, a
  missed onset, a render-frame discontinuity, or a worklet failure is reported
  as an error; there is no fallback to the main-thread scheduler.
- `process()` is allocation-free and independent of render-quantum size.
  Messages carry readiness, progress, and errors, never individual onsets.
- Loads, starts, and stops are acknowledged and generation-tagged. A running
  take's program is immutable.
- Programs above 115,200 clicks (60 minutes at 32 clicks per second) are
  rejected before playback. Storage is 9 bytes per click; no full-track PCM.

AudioWorklet removes UI timers from onset delivery. It is not a hard real-time
guarantee, an independent hardware clock, DAW sample lock, or an absolute
latency figure. Prefer a wired interface, prevent sleep, avoid other audio on
the output, and avoid device or sample-rate changes during a take.

### Qualification

Automated gates in [`e2e/click-qualification/`](../../e2e/click-qualification/)
compare captured worklet PCM with clicks planned by an independent analytic
fixture (`timingFixture.ts`), not the compiler's own events:

- **Offline PCM (always run):** 44.1 kHz oscillator, 48 kHz tick, and 96 kHz
  woodblock renders cover countoff entry, 3/4 subdivisions, a tempo change to
  triplets, a 137 to 72 ramp, a repeat, 6/8, and pause/resume. Every click
  appears once at its frame (residual below 1e-5); a one-frame mutation must fail.
- **Program limit and live stall (`VIRITURA_CLICK_QUALIFICATION=1`):** a
  maximum-density 60-minute program preloads and renders completely. Beethoven 5
  through the Click UI in headed Chromium with repeated 2-second main-thread
  stalls, forced garbage collection, wheel scrolling, and resizing rendered
  every click at its planned frame with no discontinuities.
- **60-minute output take (November 2026, host harness):** headed Edge through a
  Focusrite USB interface at 44.1 kHz, captured by WASAPI loopback, with stalls,
  garbage collection, scrolling, and resizing every 5 minutes. 7,200 of 7,204
  clicks matched bit-exact at their planned frames with zero drift; the other
  four overlapped a system notification chime and still aligned at offset 0.

WASAPI loopback captures the software mix, not an electrical loopback.
Background-tab, foreground-DAW, Bluetooth, and other browser or OS runs are
unqualified.

## Projects and track switching

- Open a folder to discover its immediate `.mnx` children (nonrecursive),
  listed by filename in the toolbar picker, including in Click. Opening the
  picker refreshes the list.
- A folder without Git opens as-is or with **Initialize Git project**.
  Versioned folders keep path-correct save, history, and review. If other
  changes are already staged, the score saves but its automatic commit is
  blocked with a warning.
- Switching resolves unsaved changes through save/discard/cancel, validates the
  target before replacing the document, cancels old clicks, and starts the new
  file at its first bar. Switching is disabled during live sessions. A newer
  selection always wins over an older async load.
- Recents list each project folder once and reopen its last selected file.
  Standalone files remain separate recents.

## Gist setlists

A secret GitHub Gist of several `.mnx` files is a link-only setlist for players
without repository access.

- The Share dialog creates a secret Gist through Viritura's API or converts an
  existing Gist URL. Project sharing includes nested MNX files and the open
  score's unsaved edits; it fails above 50 files, 512 MiB of MNX, or 64 MiB
  stored. Files over 8 MiB are stored as base64 gzip (`.mnx.gz.b64`) because
  GitHub serves raw Gist files only up to 10 MB. The GitHub App needs
  **Gists: Read and write**.
- `/?open=gist-setlist#id=<gist>` (optional `revision` to pin) opens the first
  file in Click. The ID stays in the fragment so Viritura servers never see it.
  The Gist is fetched once per load; switching tracks uses the in-memory files
  without prompting. The standalone single-score `/s/gist` viewer is separate.
- **Read-only:** score edits (including undo, MCP proposals, and measure
  repair) are rejected with an explanation, and live collaboration cannot
  start. Save and Save As write a detached local copy. Playback, Concert/Written,
  zoom, and Click session settings remain available because they never modify
  the shared score. Opening any other document clears the restriction.
- The dialog states that a secret Gist is unlisted, not private: anyone with
  the link can open or forward it, the owner's username and history are
  visible, and access cannot be revoked per person. Anonymous GitHub requests
  are limited to 60 per hour per IP, shared on rehearsal Wi-Fi.

Not supported: updating an existing Gist from Viritura, opening a setlist link
from inside the app, and revocable Viritura-hosted links (see
[read-only sharing](../plans/read-only-sharing.md)).
