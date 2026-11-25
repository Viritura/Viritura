# Click sessions (Click activity)

> **Status:** In progress, November 2026. The click-only audio engine and
> click session program compiler and the single-document **Click** activity are implemented
> (see [Implementation status](#implementation-status)); the setlist, detached
> controller window remain proposed. Confirmed requirements and proposed defaults are
> distinguished below.
>
> **Related:** [File format](../spec/file-format.md),
> [project format exploration](./project-format.md),
> [server-synchronized click experiment](../experiments/server-synchronized-click-track.md).

## Implementation status

Implemented:

- **Click activity** —
  [`ClickView`](../../apps/editor/src/click/ClickView.tsx) is an Activity Bar
  view in the editor that plays the open document, with a single Start/Stop
  button (also **Space**), a selectable one- or two-bar countoff preview
  and status, and a stopped-only session tempo percentage. Audio is created only
  from Start; opening the activity does not create click audio. Document,
  worklet, and context-interruption failures are visible. Session tempo and
  score view controls live in a compact settings bar. During playback (including
  countoff), the settings bar is hidden so the score fills the available height
  and height-fit zoom adapts. Stopping, finishing, or an audio interruption
  restores the bar and its settings. Document edits (for example from MCP or
  collaborators) interrupt an active or preparing take with a visible message;
  the updated document is adopted after stopping. The selected start bar is
  kept when it remains valid. With no document open, the activity shows an empty state.
- **Shared score surface and floating transport** — Click reuses the editor's
  already-mounted `ScoreCanvas`; score/part selection, view mode, bar taps, and
  click playhead overlays all use that surface rather than mounting a second
  score viewer. A playhead follows the click audio clock through
  countoff, tempo scaling, repeats, and partial-bar jumps; it does not schedule
  audio. Stopping selects the current performed bar visit using the audio
  thread's acknowledged position; the next Start plays a fresh countoff
  from that visit. The playhead rests at the visit's start.
  While stopped, both navigation dials are visible in the floating transport,
  alongside countoff and Start. During playback (including countoff), the
  transport shrinks to just the current bar number and Stop. Stopping, finishing,
  or an audio interruption restores the full transport. The Start/Stop button
  stays at the lower-right anchor in both modes, including narrow layouts;
  expansion grows above and to the left unless viewport bounds require a shift.
  Drag any non-interactive area with a
  mouse or touch, or focus the panel and use arrow keys
  (Shift for larger steps). Movement is bounded to the score viewport and
  re-clamped on resize. Score-load errors are visible without replacing the
  independent click engine. A detached PiP window remains future work.
- **Score navigation** — while stopped, drag the score with a mouse or touch
  to pan, or tap/click a bar to select its start and synchronize the dials.
  Dragging does not select a bar. Score hits account for zoom and scrolling,
  including part views. Repeated bars select the nearest full-bar visit to the
  current start (ties prefer the earlier visit); bars without a full visit
  report an error. Dragging and bar selection are disabled during playback.
- **Score view controls** — the top navigation selects authored score/part
  views, with read-only source-part views offered when extracts are absent.
  **View mode** offers **Page**, **Spread**, **Spread (H)** (horizontal
  spreads), and **Horizon**, matching the main app. Horizon remains the default.
  Score/part and view-mode selection do not change the click itinerary or
  initialize audio. The selected mode persists while the navigation is hidden
  during playback and across document edits.
  Engraving uses the MNX project score/part page-setup defaults and each authored
  score's overrides, resolved by the same helper as the main editor. Page size,
  margins, and staff size follow the selected view; source-part views use the
  project's part defaults. Viewer zoom changes display scale, not engraving sizes.
  Paginated modes use the authored margins; Horizon keeps its edge-to-edge strip.
  Zoom in/out and the current percentage sit beside **Fit**, which fits the
  staff height in Horizon or a complete page/two-page spread in paginated modes
  to the viewport. Switching view modes enables the corresponding fit.
  Paginated playhead following centers the whole page or paired spread and
  advances by whole frames, including backwards repeat/jump navigation.
  Spreads show the first recto/title page alone, then pair the following
  verso/recto pages (2–3, 4–5, and so on). Single opening and final unpaired
  pages are centered; page turns and backwards jumps use this same grouping.
  Frames adapt to viewport resize and navigation hiding without showing
  fragments of adjacent frames. Horizon retains continuous playhead scrolling.
  During playback, a recto page's halfway bar (unique written bars, rounded
  down, independent of tempo) replaces the left verso with the following
  verso. Entering that verso reveals its matching recto. In Page mode, the
  last system triggers a clipped top-half preview of the next page over the
  current top half; entering the next page restores its full display.
  Skip this preview if the active last system starts above the halfway line.
  The followed frame is painted before its preview is removed, avoiding a
  flash of the previous page. Stop restores normal pages. Previews reuse the existing layout and paint
  only when their page or scale changes, without another engraving/audio engine.
  Fit adapts to viewport and selected-score changes; manual zoom exits fit.
  Fit requests are reapplied after the shared canvas finishes layout, and the
  status percentage reports the canvas's actual zoom. Repeated Fit presses
  reapply the current frame even when fitting is already enabled.
  The shared canvas defaults to fit-height in Click mode.
- **Horizontal navigation dials** — choose a start from independently scrollable
  rehearsal and bar-number tracks with touch, scrolling, tapping, or keyboard.
  The upper track contains only rehearsal marks, so distant marks are adjacent;
  selecting one centers its bar in the lower track. Repeat visits are distinguished.
  A compact line below the dials shows the selected start's time signature and
  effective quarter-note tempo, including the session percentage.
  The countoff control shows the number of free clicks for the selected bar
  before playback.
  During playback the compact bar display follows the current performed bar without seeking or
  rescheduling audio.
- **Lazy activity and audio exclusivity** — the Click activity is a lazily
  loaded chunk (as are Play, Roll, Picture, and Review; see
  [`lazyActivities`](../../apps/editor/src/app/lazyActivities.tsx)), so its
  code downloads only when opened or when its Activity Bar entry is hovered or
  focused. Exclusivity is enforced at runtime instead of by a separate build:
  entering the activity, and every Start, awaits the editor's `releaseAudio()`
  before the click engine is created, and any editor transport start while the
  activity is open (MCP, selection playback) is released again. A high-priority
  **Space** binding drives the click transport so the editor's play/pause
  shortcut cannot start instrument playback. Explicit public `@viritura/audio/click`,
  `@viritura/playback/click`, and `@viritura/midi/timing` barrels avoid importing
  the broad package barrels in development as well as production; these are
  declared package exports, not access to private files.
- **Timing-only compilation** —
  [`compilePlaybackTiming`](../../packages/midi/src/playbackTiming/index.ts)
  reuses musical navigation, pickup/cadenza lengths, holds, and continuous tempo
  realization without generating instrument notes or dynamics. Its timing is
  regression-tested against score playback through pickups, holds, repeated
  ramps, and jumps.
- **Click-only engine** —
  [`ClickEngine`](../../packages/audio/src/clickEngine/ClickEngine.ts) runs a
  private AudioContext whose graph contains only the click worklet. The full
  program is transferred to the audio thread as sample frames (each rounded from
  its absolute time, so no drift), armed against one anchor frame, and rendered
  allocation-free in `process()`. Loads, starts, and stops are acknowledged;
  a start whose anchor has already passed, a missed onset, a worklet load
  failure, or an unacknowledged request is reported as an error and never falls
  back to the main-thread scheduler.
- **Staged worklet** — `viritura-click-processor.js` is generated by
  `stage-sounds` next to the SF2 processor because the production CSP forbids
  `blob:` worklets.
- **Click session program** —
  [`buildClickSessionProgram`](../../packages/playback/src/clickSession/clickSessionProgram.ts)
  compiles a start bar, a fresh one- or two-bar countoff in that bar's meter and tempo,
  existing irregular beat grouping, per-measure subdivision rules, and the session tempo percentage through the
  continuous tempo model. `describeClickCue` produces strings such as
  "Rehearsal O, 4 clicks free". The worklet receives the complete endpoint so
  playback includes the final beat's duration rather than ending at its onset.
- **Score audio release** — `PlaybackActions.releaseAudio()` stops playback,
  destroys samplers and SF2 synths, releases native hosts, and suspends the score
  AudioContext. `ClickSessionTransport` calls it before loading a program;
  Play restarts with the countoff and Resume continues without one.

Tempo markings now persist `clickSubdivision` (1-5), with inheritance and exact
mid-bar positions, through standard MNX tempo extensions and shared system
instructions. The tempo inspector edits **Clicks per beat**. The Click activity
uses these settings for score clicks and the starting countoff, including
source-position restoration on repeated visits and jumps.

Remaining: the project setlist picker, persisted session settings, the detached controller,
additional rehearsal navigation, and the release gates below.

Single-document smoke check: start the UI through `pnpm dev:stack up ui`, open
the editor origin from `pnpm dev:stack url`, open a score, choose **Click** in
the Activity Bar, then **Start**. The first bar is a
synthetic countoff before the selected bar; Stop then Start begins a fresh
countoff. This initial browser check is not
studio-output qualification or a hard real-time guarantee.

## Goal and confirmed requirements

Make Viritura useful as a click source for practice sessions and for external
DAW recording sessions. Viritura never records audio itself, so the surface is
named for what it plays — the **Click** activity — not for recording:

- Open one project folder containing multiple independent `.mnx` files.
- Use a global picker to choose the active file without repeatedly opening files.
- Treat those files as the session's track list; do not combine songs into one score.
- Program click resolution, including subdivisions, at tempo changes.
- Automatically play the selected one or two bars of countoff before each fresh
  start or restart (default: one bar).
- Apply one session-wide tempo percentage to every track.
- Output clicks only. Recording and audio capture happen in the external DAW.
- Provide a small movable controller, usable by touch during the session.
- Make selecting a start bar easy, with prominent rehearsal letters and an
  unambiguous countoff preview such as **4 clicks free**.
- Treat click accuracy as a release requirement: a dedicated click-only engine,
  no muted-score playback, and no dependence on UI timers to deliver each click.
  Run sessions in a Click activity that releases editor instrument audio.

Here, "clicks free" means the counted beats in the automatic countoff bar,
not extra silence, an additional pre-roll, or a free-time passage. Generate
one equivalent bar using the selected bar's effective tempo and meter.
Never play the preceding score bar: it may have a different tempo or meter.

This is a single-device wired click feed, not a revival of synchronized clicks
on multiple phones. DAW transport synchronization, audio capture, take management,
and network clock synchronization are outside this first delivery.

## Proposed user workflow

1. Choose **Open project folder** and grant access to the session folder.
2. Discover its immediate `.mnx` children. Display their names in an app-level
   **Track** picker beside the project name, available across editor modes.
3. Choose **Open click session**. Resolve pending edits through the existing
   save/discard/cancel workflow and hand off the MNX setlist
   (see [Click activity](#click-activity)), then
   switches to the **Click** activity, which shows:
   - Track picker, ordered track list, and **Previous** / **Next** actions.
   - A large **Start** / **Stop** control.
   - Current track, bar/beat, meter, written tempo, and effective tempo.
   - One clearly labeled **Session tempo %** control with **Reset to 100%**.
   - A visible countoff state and beat indicator.
   - Click volume and a table of tempo changes with click-resolution controls.
   - **Float controls**, a touch-friendly bar wheel, and an always-visible
     preview of the next start.
4. Select a track, adjust its click program, and press **Start**.
5. Hear the selected one or two bars of countoff, then the track's click program.
6. Stop automatically at the track end. Select another track or restart a take.

**Proposed defaults:** manual advancement, no automatic playback on selection,
no autoplay of the next track, and percentage changes only while stopped.
The user's request for a global picker replaces the need for a separate
playlist-only opening workflow. Ordered presentation still supports a setlist.
Autoplay and gaps between songs can be designed later if needed.

The global picker is a project capability, not a Click-only widget. With
one file it still identifies the active track; an empty folder offers **New
click track** and **Add MNX files**. Creating a click track produces an ordinary,
schema-valid MNX document with explicit meter, length, and tempo, using the
existing score-creation conventions.

## Click activity

Click sessions run in the editor's **Click** activity rather than on a
separate page. The original standalone `/click` page avoided loading the editor
at all, but it duplicated document opening, project access, and navigation, and
could not follow edits made in the editor. The activity instead reuses the open
document and keeps runtime isolation where it matters for timing:

- **Lazy loading.** The Click controller and audio code are a separate chunk
  loaded on first use, while its score uses Write's already-mounted canvas.
  Activities with separate surfaces (Play, Roll, Picture, Review) remain lazy
  so the initial editor load does not pay for them.
- **Exclusive audio.** The click engine owns a private AudioContext containing
  only the click worklet. Before the engine is created, the editor's
  `releaseAudio()` stops playback, disposes samplers and native hosts, and
  suspends the score context; editor playback started while the activity is
  open is released again.
- **MNX is the only track format.** The activity compiles the open document
  into transient click events and bar-wheel metadata before Start, using the
  timing-only compiler without instrument MIDI generation. Do not introduce
  prepared click files, exported event lists, or a second saved representation
  of musical timing. The same MNX works for practice and studio sessions.
- **Project access.** Track selection uses the editor's project folder and
  document switching rather than a second file-access path.
- **Limited editing.** The activity does not expose notation editing. Explicit
  subdivision changes are musical settings saved into the selected MNX through
  the normal document path. Session tempo percentage, click volume, and the last
  selected start are session/UI settings, not document edits.
- **Controller hosts.** The score is the main surface, with a movable,
  touch-first floating transport. Session tempo and the shared searchable
  score/part picker live in the app toolbar. View mode, zoom, and fit use the
  shared status-bar controls at the bottom, visible while stopped and clear of
  the transport's initial position. While playing, the activity covers the editor
  chrome so the score fills the screen; the transport keeps its on-screen
  position across that switch so Stop stays under the performer's finger.
  Document Picture-in-Picture remains proposed for keeping controls above a DAW.

The Click activity reconfigures the shared canvas for click navigation and
playhead overlays; it does not mount a second score viewer or engraving engine.
The editor's instrument context is suspended rather than closed.

## Movable session controller

Use one controller surface and one playback owner, with two presentation hosts:

| Host                        | Behavior                                                                                                                  | Limit                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document Picture-in-Picture | Arbitrary HTML controls in a user-movable, resizable, always-on-top window; suitable beside or above a DAW.               | Limited browser/host support; secure context and a user activation are required. The website cannot set screen coordinates, and the window cannot outlive its opener. |
| In-page floating panel      | The same controls in a movable, resizable panel. A manual Popover can put it in the document's top layer where supported. | Stays inside Viritura's viewport; cannot remain above another application. Popover does not provide dragging or resizing automatically.                               |

Do not use ordinary video PiP: it cannot host this arbitrary interactive UI.
Feature-detect Document PiP at runtime rather than hard-coding browser names.
In touch/mobile browsers or desktop webviews without it, keep the full workflow
available in-page and clearly explain that **Keep above other apps** is unavailable.
A native always-on-top desktop window is a separate future host, not a promise
of the web fallback.

There is already a closely related implementation in
[PictureWindow](../../packages/video-sync/src/PictureWindow.tsx) and its
[Document PiP adapter](../../packages/video-sync/src/documentPictureInPicture.ts).
Reuse that hosting approach; extract a neutral public UI/platform surface if
needed rather than making click playback depend on video synchronization or
deep-importing video internals. Do not copy its lifecycle blindly: request the
window directly from the opening user action, handle failure visibly, and use
the target document/window for focus, events, and portal-mounted menus.

Only one Document PiP window is available per tab. Coordinate ownership with
the existing picture window: explain the conflict and offer an explicit switch
or the in-page controller, rather than silently closing either surface.
Closing or changing the controller host must not restart/stop playback or lose
the selected start. Restore focus to the opener and retain access to **Stop** in
the main app. The opener owns audio, transport, selection, and scheduling;
the detached window only renders shared state and sends commands.

Provide a dedicated touch drag handle, pointer capture/cancellation, and
viewport clamping for the in-page host. Dragging must not compete with the bar
wheel, buttons, or page scrolling. Keep controls reachable after viewport changes,
and support keyboard move/reset actions rather than requiring dragging.
Use non-light-dismiss behavior for the persistent controller; an incidental tap
outside it must not make the transport disappear.

API references:
[Document PiP](https://developer.mozilla.org/en-US/docs/Web/API/Document_Picture-in-Picture_API),
[requestWindow](https://developer.mozilla.org/en-US/docs/Web/API/DocumentPictureInPicture/requestWindow),
and [Popover](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API).

## Touch bar wheel and start preview

The current selector has two independently scrollable horizontal tracks with
fixed center selection lines: rehearsal marks above and bar numbers below.
Rehearsals are adjacent entries regardless of the number of intervening bars.
Selecting a rehearsal jumps to its bar; selecting a bar highlights its preceding
rehearsal. Both tracks follow playback. Scores without rehearsal marks show only
the bar track. Rehearsal letters are never inferred from bar numbering.

- Swipe or scroll either track, or tap an entry to select it. Arrow keys step
  through the focused track; Home/End reach its first/last selectable entry.
- Planned: **Previous rehearsal** / **Next rehearsal** shortcut buttons and
  direct **Go to bar** entry.
- Use at least 44 by 44 CSS-pixel touch targets, high-contrast large text,
  visible keyboard focus, and reduced-motion support. Keep the start summary
  and primary transport visible while the bar list scrolls.
- Scrolling previews a candidate without moving a playing transport. Settle
  to one bar to commit the next start; disable Start while a gesture or inertial
  scroll is unresolved. Pressing Start must never race a moving wheel.
- During playback both tracks are read-only and follow the current bar. Stopping
  returns them to the selected start.
  Future browsing during a take must never seek, stop, or start sound implicitly.

The dial selects bar-boundary occurrences from the repeat/jump-expanded
itinerary rather than a rounded audio time or display number. Multiple visits
show their pass explicitly; partial visits beginning inside a bar are shown
but are not selectable starts. Persisted selections should identify the authored
bar by stable measure ID as well as the intended visit. If future rehearsal
marks can be placed inside a bar, label the offset and offer that bar's
beginning; exact intra-bar starts require the later intra-bar policy.

The floating transport shows the selected destination in its navigation button,
with expandable dials and a countoff cue beside the countoff control. A future
detached controller must preserve both:

```text
Track: Song 03
Rehearsal O | Bar 97
1 bar countoff | 4 clicks free
[ Start ]
```

In this example the authored tempo is quarter = 120. Secondary detail must
identify counted beats separately from subdivisions: four quarter-note counted
beats with eighth-note subdivision means eight audible ticks during the same
bar, not eight beats or two bars of countoff. For 6/8 grouped in two, show
**2 clicks free**, **2 dotted-quarter beats / 6 eighth-note ticks** when
subdivided. Irregular or partial pulse patterns need an exact meter/grouping
description rather than rounding a fractional count into a misleading integer.
The dials show the destination, so the countoff preview need not repeat it.
Default endpoint is the end of the track; any future range or loop must make
its endpoint explicit.
During pre-roll, show **Counting off 1 of 4** beside the countoff control.
The dials show the current location during playback. No extra audible cue is
implied by the descriptive text.

Derive the countoff preview and the scheduled start from the same resolved
start description: document revision, target measure/route, effective tempo,
meter, countoff pulse/subdivision events, and endpoint. Track/score/percentage
changes invalidate it. If the target is deleted, ambiguous, or cannot compile,
show a diagnostic and disable Start instead of retaining a plausible old preview.
Screen-reader status announces the committed selection, not every scroll frame.

## Existing implementation and required changes

| Area                 | Verified starting point                                                                                                                                  | Required work                                                                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project storage      | `GitProjectAdapter` accepts a `scorePath`, but `ProjectAdapter` exposes one active score and its history. `bootProjectFromHandle` opens a selected path. | Introduce folder-level file discovery and active-document selection without requiring a Git repository. Keep one selected score adapter rather than loading every score into editor state. |
| Click timing         | `buildClickTrack` uses the MIDI tempo model, expanded measure starts, and played spans.                                                                  | Reuse the musical timing model and route semantics, but compile to a dedicated click engine rather than the note scheduler.                                                                |
| Click delivery       | `Scheduler` fills an audio look-ahead window from a main-thread `setTimeout`; `scheduleClicks` drops events whose delivery time has passed.              | Preload a complete take into an AudioWorklet before starting. Neither main-thread timers nor per-click messages may determine onset delivery.                                              |
| Resolution           | `resolveMeter` resolves authored irregular grouping for the click compiler and countoff.                                                                 | Add persisted subdivision overrides, including changes inside a bar.                                                                                                                       |
| Countoff             | The current count-in creates quarter-note clicks before score time zero; startup applies it only when stopped at the beginning.                          | Use a meter-aware one- or two-bar pre-roll at each fresh start, not a loop over a potentially fractional quarter-note count.                                                               |
| Tempo adjustment     | `PlaybackEngine.setTempo` derives a scale from the first tempo-map entry.                                                                                | Expose percentage semantics explicitly and reapply the same scale whenever the active file changes.                                                                                        |
| Playback preparation | The provider normally builds instrument samplers and prepares native playback.                                                                           | Add a real click-only preparation path: no soundfont requirement, instrument notes, MIDI note output, or native VST start. Muting instruments after preparing them is insufficient.        |

Implementation anchors:
[project adapter](../../apps/editor/src/git/ProjectAdapter.ts),
[Git adapter](../../apps/editor/src/git/GitProjectAdapter.ts),
[project store](../../apps/editor/src/store/projectStore.ts),
[click generation](../../packages/playback/src/clickTrack.ts),
[playback provider](../../packages/playback/src/PlaybackContext.tsx),
[audio engine](../../packages/audio/src/PlaybackEngine.ts), and
[metronome](../../packages/audio/src/Metronome.ts).

## Dedicated click engine and timing guarantees

### Hard boundary: not a muted score

A click session must not merely set instrument gains to zero, pass empty sampler
maps to a full MIDI timeline, or keep the regular playback provider running behind
a smaller UI. Separate the shared musical timing compiler from instrument event
generation and audio rendering:

```text
Selected MNX + resolved start + session tempo %
  -> shared route/meter/tempo timing compiler
  -> compact click events + countoff + endpoint
  -> preloaded AudioWorklet
  -> click gain -> wired output

Controller <- low-rate position/status updates
```

Reuse tempo ramps, repeats/jumps, pickups, played spans, and hold interpretation.
Extract a timing-only path from the existing timeline pipeline where necessary;
do not generate every instrument's MIDI events and discard them afterwards.
Inspect musical events only where needed to determine timing, such as a pickup
or free-length measure. Keep one musical-time interpretation, not a second
approximate click tempo engine.

On entry, stop normal playback, invalidate pending sampler/preview/native
preparation, silence voices, and dispose the instrument graph through its owning
lifecycle. Release SF2 synth/worklet instances, soundfont buffer references,
reverb/convolution and spatial/mixer processing, note-preview handlers, and
instrument/MIDI/native-host playback resources. Preserve the user's routing and
mixer settings as data for lazy restoration, not as live muted DSP.
Do not close a shared context or unrelated native resource behind another owner's
back; separate ownership or suspend the score context while the click context is
active. Mere disconnection is not proof that a processor has stopped.

The Click activity must not mount the piano roll or video decoder, or create
instrument audio. Reuse the already-mounted `ScoreCanvas` and its layout/render
path; do not mount a second score viewer, engraving engine, or playback
scheduler. The Click playhead reads the click clock without driving audio.
Avoid automatic instrument preloads.
Retain unsaved document data and lightweight track/rehearsal metadata; do not
discard edits or clear shared caches indiscriminately. Load/compile only the
selected track, with no background preparation of the next score during a take.

### Audio-thread delivery

Proposed browser engine: one small AudioWorklet click processor, using preloaded
short click waveforms for downbeat, beat, and subdivision accents. The worklet
owns the entire finite take's event list and endpoint before audio is armed.
This is compact event data, not a full-length PCM audio buffer and not thousands
of independently allocated oscillators/audio nodes.

- Compile absolute event offsets to the actual AudioContext sample rate using
  rounding from absolute musical times, not repeated rounded intervals.
  Keep sample-frame values exact within JavaScript's safe integer range; reject
  oversized/dense inputs explicitly rather than truncating or wrapping offsets.
- Allocate/transfer buffers and warm the processor before readiness. Await an
  acknowledgment for the exact document revision/start description; Play cannot
  claim success while preparation is incomplete.
- Arm one future audio-frame anchor with positive preparation lead. Countoff
  and track events share that anchor and cross the boundary without a timer,
  message round trip, or separately started player. The worklet rejects stale
  or already-past anchors and returns a visible start failure, not late clicks.
- Render on the audio thread from frame indices and actual output-buffer lengths.
  Do not assume a fixed render quantum. Keep the processing callback bounded,
  with no per-block allocations, logging, fetches, promises, React updates,
  or main-thread refill dependency. Define deterministic bounded mixing for
  overlapping click tails at dense resolutions, without clipping.
- Readiness, progress, and errors can use messages; individual onsets cannot.
  UI progress may be throttled or briefly stale without changing the sound.
  Worker compilation is allowed, but a Worker timer is not an audio clock.
- Pause/resume retains the exact consumed frame offset. Stop/restart uses a
  generation-tagged command, clears remaining events/tails, and acknowledges
  cancellation before a new take can arm. Already buffered hardware audio cannot
  be recalled. Commands themselves can be delayed by a blocked UI thread;
  document that separately from autonomous click-onset accuracy.
- A take uses an immutable program. Edits or collaborator changes mark the next
  take as needing preparation and never rebuild/reload the running processor.
  Session percentage changes remain stopped-only.

Do not use the current main-thread look-ahead scheduler as the recording
fallback or label it equivalently reliable. Keep normal score playback unchanged.
If AudioWorklet initialization is unsupported or fails, show **Click unavailable** with recovery; do not silently substitute timer-driven playback.

### Operating limits and visible failures

Maintain a visible **Preparing** -> **Ready** -> **Counting off** -> **Playing**
lifecycle. Detect AudioContext state changes, worklet `processorerror`, device
route changes where observable, and opener/window lifecycle events. Surface a
recording interruption, invalidate readiness, and require an explicit fresh
start after recovery. Never silently resume mid-take or emit catch-up bursts.
On the audio side, latch termination if the engine observes an unexpected
render-frame discontinuity; do not bridge the gap with a newly shifted clock.
Diagnostics can remain visible after the UI becomes responsive again.

A browser may suspend/freeze a page or stop rendering without timely notification.
Not every hardware underrun is observable through browser APIs. AudioWorklet
removes the UI timer from onset delivery; it is not a hard real-time guarantee,
an independent hardware clock, or a cure for overloaded drivers/CPU. Do not
mislabel a low-latency hint or reported output latency as proof of accuracy.

Prefer a wired interface and a stable, tested output route; Bluetooth is not
the recording qualification target. Recommend preventing sleep and avoiding
output-device/sample-rate changes during a take. Test with the actual external
DAW recording and foregrounded, not just an idle browser. A native audio backend
can later implement the same compiled-click contract for stronger host control;
it still needs buffer/driver and physical-output qualification.

### Measurable release gates

These are proposed qualification workloads, not claims about current behavior:

- At 44.1, 48, and 96 kHz, captured generated PCM contains every expected click
  onset exactly once, within one sample frame of its quantized target. Compare
  against independently calculated timing fixtures, not the renderer's own
  event list alone. Verify countoff entry, tempo changes/ramps, subdivisions,
  repeated routes, and pause/resume.
- A 60-minute program at up to 32 click onsets per second preloads completely
  with bounded event storage, without allocating full-track PCM. Reject programs
  beyond validated limits before starting, with explicit diagnostics.
- Headed-browser stress tests inject repeated 2-second main-thread stalls,
  scroll the bar wheel, resize/close the controller, and trigger representative
  garbage-collection pressure. After preparation, rendered click events must
  remain complete and within one sample frame of their planned render positions.
  Use offline rendering for deterministic PCM tests and real-time capture for
  stall tests; an offline renderer alone cannot validate live resilience.
- Qualify continuous foreground, background-tab, and foreground-DAW recording
  runs on supported browser/OS/interface combinations. Capture electrical
  loopback where available and retain onset-interval, dropout, drift, and
  system-load evidence for at least 60 minutes. Proposed physical-output gate:
  no missing/duplicate clicks and no interval error above 1 ms after accounting
  for measurement uncertainty and independently measured clock-rate differences.
  Report raw results too; do not fit away intermittent timing errors or call
  relative loopback measurements absolute latency/DAW sample-lock proof.
- Instrumentation confirms one shared score surface, zero live instrument synth
  processors, no score note/control dispatch, and no soundfont fetch/decode
  during a click session. Qualify timing with shared-canvas scrolling and
  painting active. Heap snapshots should show released application-owned
  instrument buffers after collection; do not promise immediate OS memory return.
- Forced worklet failure, context suspension, denied audio startup, stale program
  acknowledgments, and device changes produce explicit non-ready/interrupted
  states. They cannot silently restart or report a successful uninterrupted take.

If a host cannot pass qualification, narrow the supported recording configuration
or retain an explicit unqualified status. Do not relax timing assertions merely
to ship. Final physical-output tolerances and supported configurations require
agreement before implementation is considered recording-ready.

Reference: [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)
executes on the Web Audio rendering thread, shared with other audio processing;
this is why eliminating unnecessary DSP matters as well as avoiding UI timers.

## Project folder and safe switching

Proposed first-version discovery is nonrecursive. Users should not accidentally
load fixture directories, exports, or unrelated nested projects. Show the filename
as identity and use the score title as optional supplementary text.

Keep the project root and active document separate:

- Folder scope owns discovered paths, ordering, and session settings.
- Document scope owns the selected MNX, its undo history, save target, disk
  baseline, and score-specific playback program.
- Existing standalone-file opening remains available and unchanged.
- Versioned folders retain path-correct save, history, review, and commit behavior.
  Switching tracks must not reinitialize a repository or automatically commit.

Switching must be transactional:

1. If transport is playing, paused, counting off, or preparing, require
   **Stop and switch** confirmation; **Cancel** preserves the current state.
2. Resolve unsaved edits through the existing save/discard/cancel workflow.
3. Read and validate the target file before replacing the current document.
4. Invalidate pending timeline/audio preparation from the old document and cancel
   already scheduled old clicks before a new track can become playable.
5. Publish the new document, save target, and playback state together. Reset its
   position to the beginning and retain the session percentage.

Rapid selections must not let an older async load replace a newer selection.
Missing, unreadable, invalid, or externally changed files need visible
diagnostics; never quietly skip a track or play the previously loaded one under
the new name. Provide **Refresh tracks** and **Locate file** recovery.

## Persistence boundary

Each `.mnx` remains independently openable and is the only saved track format.
Its existing meter, beat structure, tempo, ramps, and rehearsal marks already
describe the click's timing and navigation. Do not duplicate them in a click
file or store compiled timestamps.

Reuse `TimeSignature.beatStructure` and `resolveMeter` from the
[meter model](../../packages/core/src/model/time.ts) for the beat, including
irregular grouping. The only new musical metadata needed for this delivery is
an explicit click-subdivision override at a rhythmic location:

- Implemented tempo extension: `_x.viritura.clickSubdivision: 2`, alongside
  the existing tempo metadata (integer 1-5).
- With no override anywhere, click once per resolved meter beat.
- Omitted metadata inherits the preceding subdivision; `clickSubdivision: 1`
  explicitly returns to beat-only clicks.
- Allow an override at a ritardando's start, its end, or another rhythmic
  position without requiring a new BPM or a visible metronome marking. Finalize
  the positioned instruction representation during implementation; do not
  fabricate a tempo value just to carry click metadata.
- Do not add independent click beat/grouping definitions that could disagree
  with the existing meter.

The field is also supported directly on unified vendor tempo entries and
`systemText[].tempo`. Click-only system instructions do not fabricate BPM.
See [the extension contract](../spec/viritura-extensions.md#tempo-owned-click-subdivisions).

Use an optional, documented `session.viritura.json` sidecar in the folder for
session-only state: format version, ordered relative MNX paths, and
`tempoPercent`. Do not copy musical content or click programs into the sidecar.
It is a new session manifest, not the unshipped ZIP-container proposal.

Without a sidecar, derive a deterministic filename-sorted list and use 100%.
With a sidecar, preserve its order, append newly discovered files deterministically,
and show missing entries as unavailable rather than removing them silently.
Removing a track from the setlist must not delete its MNX file.
Store the active selection as local UI state, not shared musical content.

Reject paths escaping the approved folder and percentages outside 0–100% or
nonfinite percentages. A saved 0% is a stopped setting and cannot start playback.
Report malformed manifests and failed writes explicitly; never claim settings
were saved when they were not. A read-only folder can still play, but must show
unsaved session changes and offer an explicit download.

**Availability:** direct folder access depends on host support and permission.
Reuse supported storage abstractions; do not assume every browser implements a
directory picker. Offer multi-file selection as an in-memory session fallback,
with explicit manifest/MNX download and file-reassociation steps on reopening.
Do not make the ZIP-container project a prerequisite.

## Programmable resolution

The tempo table shows every actual tempo change, its bar/beat, written beat unit,
written BPM, and effective BPM. Each row has an explicit resolution override or
**Inherit**. Also allow a click-only change where no tempo change exists.

Default to one click at each beat boundary from `resolveMeter`, including
authored irregular grouping. Do not infer the beat from BPM or introduce a
second grouping control. The click session compiler uses the shared meter
resolver for both countoff and playback.

Proposed controls: **Inherit**, **On the beat**, or an explicit subdivision
(choices: 2, 3, 4, or 5 equally spaced clicks per resolved beat). Distinguish
bar downbeat, beat/group starts, and subdivisions with accents. Dividing unequal
groups equally per beat produces unequal tick spacing across groups; the UI
must describe this rather than implying a uniform denominator-note grid.

Examples:

| Location | Tempo / meter            | Override      | Result                          |
| -------- | ------------------------ | ------------- | ------------------------------- |
| Bar 1    | Quarter = 72, 4/4        | Subdivision 2 | Eighth-note clicks              |
| Bar 17   | Quarter = 120, 4/4       | On the beat   | Quarter-note clicks             |
| Bar 33   | Dotted quarter = 60, 6/8 | Subdivision 3 | Six eighth-note clicks per bar  |
| Bar 41   | Ritardando, 4/4          | Subdivision 2 | Eighth-note clicks through ramp |
| Bar 45   | End of ritardando, 4/4   | On the beat   | Return to quarter-note clicks   |

Resolve each pattern to rational musical positions, then use the existing tempo
model to obtain seconds. Anchor the grid to the bar; a mid-bar change applies at
its exact location and starts the new grid there until the next grouped-beat boundary. Assign a
boundary click to the new region exactly once. Never infer resolution from BPM.
Subdivision stays straight unless the author explicitly programs a different
pattern; score swing must not silently alter a recording click.

Repeat expansion, alternate endings, and jumps must restore the source-location
pattern on each visit. Tempo ramps continuously change timing, not click
resolution. BPM-free text or swing instructions must not reset BPM or interrupt
ramps. Define holds/fermatas through the existing performance-time model and test
them, rather than approximating their timing with a UI timer.

## Countoff and transport contract

| Action                        | Countoff                                                       |
| ----------------------------- | -------------------------------------------------------------- |
| Start from stopped            | Selected one or two bars                                       |
| Restart                       | Cancel pending audio, then a fresh selected countoff           |
| Fresh start from a chosen bar | Selected bars at that location's meter and instantaneous tempo |
| Choose a different track      | No sound until Start; Start receives the selected countoff     |
| Natural end                   | Stop; no next-track autoplay                                   |

Use a distinct `countingOff` transport phase. Pre-roll is not an inserted measure
and never changes saved bar numbers, notes, or duration. At the selected
location, freeze the effective tempo for the countoff, then enter the existing
tempo model exactly at the requested musical position.
Resolve tempo and meter at the selected bar's entry, including changes on its
downbeat. The countoff is synthetic: do not seek back one bar or replay the
preceding measure. A ramp within the selected bar begins with the track after
the frozen-tempo countoff, not during it.

Countoff uses the selected local click pattern, including meter grouping and
subdivision. Each 6/8 countoff bar occupies six eighths, not six quarters; each
5/8 countoff bar occupies five eighths even though that is 2.5 quarter notes.
The score entry must be exactly the selected number of notated bars after the
first countoff click, without a duplicate click at the transition.

Proposed first delivery offers bar-boundary start selection. For a pickup,
count the selected full bars of its governing meter and then play the authored pickup
without padding the score. Arbitrary intra-bar starts and free-meter countoffs
need explicit policies before enabling them; do not invent a 4/4 fallback.
Stop cancels countoff immediately; the next Start begins a fresh countoff.

## Session-wide tempo percentage

`effective BPM = written BPM * tempoPercent / 100`.

The same factor scales every tempo segment, ramp, countoff, and displayed
performed duration; changing tracks must not reset it. For example, 90% turns
quarter = 120 into quarter = 108 and dotted quarter = 60 into dotted quarter = 54.
Never rewrite authored tempo marks or store scaled BPM back into an MNX.

The session control ranges from 0% to 100% in 1% steps and is editable only
while stopped, not while paused or preparing. At 0%, show that the tempo must
be raised and disable Play; no finite click schedule exists at zero tempo.
At 1–100%, compile the corresponding tempo without rewriting the MNX.

## Delivery slices and acceptance

1. **Folder-backed multi-document projects.** Add discovery, picker, safe
   switching, and optional session manifest. Verify two MNX files in a plain
   folder and a Git folder; edits, history, and saves must address the selected
   file. Cancelled or failed switches preserve the original document.
2. **MNX subdivision metadata and timing.** Add schema/model round trips,
   editor controls, rational subdivision generation using existing grouping, and a distinct
   subdivision accent supported end-to-end by the click event/synth path.
   Test tempo-boundary changes, inheritance, repeats/jumps, and mid-bar changes.
3. **Recording engine and transport.** Extract timing-only compilation, add the
   preloaded click worklet and exclusive resource lifecycle, then wire explicit
   fresh-start semantics, meter-aware pre-roll, cancellation, and
   session percentage. Meet the deterministic audio and live-stall gates before
   treating the UI as recording-ready. Missing soundfonts and VST hosts cannot
   block click playback.
4. **Session surface and validation.** Add the lazily loaded Click activity
   with runtime audio exclusivity, open-document loading, the shared floating/Document
   PiP controller, touch bar wheel, rehearsal navigation, and countoff preview.
   Cover them in the composed app Storybook story, including narrow windows,
   missing PiP support, errors, and countoff state. Run wired-output manual
   checks and long-run foreground-DAW output qualification. Reuse existing
   transport shortcuts rather than global handlers that interfere with text inputs.

Focused automated acceptance cases:

- 4/4 at quarter = 120: four quarter clicks, exactly 2 seconds of countoff.
- 6/8 at dotted quarter = 60: two dotted-quarter pulses or six subdivided
  eighths, both exactly 2 seconds of countoff.
- 5/8 at quarter = 120: exactly 1.25 seconds of countoff.
- At 80%, the 4/4 case lasts 2.5 seconds; all track tempos and total performed
  durations use the same factor after a switch.
- Fresh start at a later bar uses that bar's tempo, meter, and click pattern;
  starting again after Stop always has a new countoff.
- Select Rehearsal O in 4/4 at quarter = 120 immediately after a 3/4 bar at
  quarter = 60. At 100%, the preview reports four counted beats and playback
  emits a two-second synthetic countoff, not the preceding three-second bar.
- At eighth-note subdivision, that preview distinguishes four counted beats
  from eight audible ticks; both UI and scheduler use the same start description.
- Touch scrolling across rehearsal marks never starts/seeks audio, and Start
  cannot consume an unsettled candidate. Test keyboard/direct-entry equivalents,
  duplicate rehearsal labels, repeat passes, and a deleted selected bar.
- Opening, moving, resizing, closing, and reopening the controller preserves
  playback and selection. PiP rejection gives visible recovery; an already-open
  picture window is not silently replaced. In-page fallback remains fully usable.
- A mid-bar resolution change emits no duplicate boundary event; generated
  timestamps are ordered and agree with the shared tempo model to within
  1 microsecond in deterministic unit tests.
- Stop/restart/switch during async preparation or scheduler look-ahead produces
  no old-track clicks after the cancellation boundary, apart from audio already
  delivered to the device buffer.
- Click-only playback works without loading instruments and emits no score
  notes. Returning to normal playback restores the user's prior playback mode
  and metronome/count-in preferences.
- Programs survive save/reopen and collaboration edits; folder order and session
  percentage survive a manifest round trip.

Run focused tests in the existing editor, playback, audio, MIDI, format, and
CRDT suites as each slice changes them. Physical output checks should compare
rendered/recorded click intervals and countoff entry on a wired interface.
UI animation is not evidence of audio accuracy; do not claim DAW sample lock or
an absolute latency guarantee from Web Audio scheduling alone.
