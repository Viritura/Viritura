# Video Sync and Scoring to Picture

> **Status: Video Reference shipped; Advanced Scoring to Picture proposed.**
> This plan separates a small, broadly useful **Video Reference** implementation
> (now built as [`@viritura/video-sync`](../../packages/video-sync/)) from an
> **Advanced Scoring to Picture** implementation for frame-critical film,
> television, and game work. Both use the same correct score-time mapping; the
> distinction is workflow depth and presentation precision, not intentionally
> degraded synchronization.
>
> **Primary UI direction:** use the browser's native video
> Picture-in-Picture (PiP) window so the user can move and resize picture
> independently of the score. Keep a compact inline fallback for browsers,
> permissions policies, and desktop webviews where PiP is unavailable.
>
> **Next structural step:** promote picture from a Play-mode sidebar to a
> dedicated **Picture activity**. See
> [Where this lives: the Picture activity](#where-this-lives-the-picture-activity).
>
> **Related:** [`spec/file-format.md`](../spec/file-format.md),
> [`spec/viritura-extensions.md`](../spec/viritura-extensions.md),
> [`plans/project-format.md`](project-format.md),
> [`packages/playback`](../../packages/playback/),
> [`packages/midi`](../../packages/midi/)

## What shipped (Video Reference)

`@viritura/video-sync` implements the basic tier described below:

| Piece                                                                        | Where                                                       |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Pure score-time ↔ media-time mapping (offset, clamping, count-in, alignment) | `scorePictureMap.ts`                                        |
| Clock-time formatting/parsing (`HH:MM:SS.mmm`, delivery start timecode)      | `timecode.ts`                                               |
| Drift policy — hold / bounded rate nudge / hard seek                         | `driftPolicy.ts`                                            |
| Transport↔element controller with commanded-vs-user event guards             | `videoSynchronizer.ts`                                      |
| Standard PiP capability detection + lifecycle                                | `pictureInPicture.ts`                                       |
| Object-URL lifecycle, sampled content hash, relink verification              | `mediaBinding.ts`                                           |
| Demo catalog (Caminandes 3, CC BY, downloaded from Wikimedia Commons)        | `demoSources.ts`                                            |
| Settings ↔ score persistence, attach/relink/remove, PiP toggling             | `videoSyncController.ts`                                    |
| React provider, floating picture surface, control panel                      | `VideoSyncProvider.tsx`, `VideoStage.tsx`, `VideoPanel.tsx` |
| Persistence (`_x.viritura.videoSync`)                                        | `@viritura/core` model + `@viritura/format` + JSON schema   |
| Editor wiring (Play view right panel + always-mounted bridge)                | `apps/editor/src/components/VideoSyncBridge.tsx`            |

The playback package gained one narrow public seam for this:
`getPlaybackSnapshot()`, a non-reactive read of transport state and actions. The
synchronizer samples the playhead on its own animation-frame loop, so a React
subscription would re-render a component at 60 Hz purely to read a number.

Advanced Scoring to Picture (hit points, streamers, frame stepping, rational
SMPTE, tempo fitting, reconforming) remains unbuilt and is specified below.

### Cross-origin isolation constrains how picture is loaded

The editor is served with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`, because the layout engine needs
`SharedArrayBuffer`. Under `require-corp` the browser refuses any cross-origin
subresource that was requested in no-cors mode and does not opt in with
`Cross-Origin-Resource-Policy` — including `<video src>`. A remote clip
therefore fails with
`ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep`,
which reaches the element as a bare `MediaError` and looks for all the world
like an unsupported codec.

Two things follow, and both are load-bearing rather than stylistic:

- The `<video>` carries `crossOrigin="anonymous"`, so media is requested in CORS
  mode. Without it, no cross-origin picture can ever load.
- Demo clips are **downloaded to a blob** with `fetch` before being handed to the
  element, rather than streamed by URL. That makes a transport failure a real
  HTTP error we can show (instead of a generic media error), gives the panel a
  download percentage, and — the reason that matters musically — serves the
  synchronizer's constant seeking from local bytes instead of a range request
  per scrub. A user-picked file already played from an object URL, so both paths
  now behave identically.

A picture that downloads but still fails is then genuinely a codec gap, and the
panel says so.

## Demo cue

`packages/format/fixtures/mnx/caminandes-llamigos-cue.mnx` is an original
symphonic cue written to the demo clip — 73 bars, 14 concert-pitch parts, 21
tempo sections. It exists so the feature can be demonstrated end to end: opening
it auto-attaches the picture (it carries `_x.viritura.videoSync` with
`media.demoSourceId`), and Play mode then rolls orchestra and picture together.

The cue is also the honest stress test of the timing contract. It was authored
before MNX schema 34 permitted fractional `bpm`, so bar count, meter and integer
BPM were chosen together to make accumulated score time land on each cut. Each
section was fitted against its **absolute** target rather than the previous
section's end, so rounding error never accumulates, and every downbeat lands
within one frame at 24 fps:

| Bar | Picture                       | Section                              |
| --- | ----------------------------- | ------------------------------------ |
| 1   | 0.00 s — fade up from black   | 1 × 2/4 at 60                        |
| 2   | 2.00 s — title card           | 2 × 4/4 at 120                       |
| 4   | 6.00 s — Koro on the ice      | 5 × 4/4 at 117                       |
| 9   | 16.25 s — belly flop          | 2 × 3/4 at 70                        |
| 11  | 21.39 s — standoff with Oti   | 3 × 4/4 + 2/4 at 95                  |
| 15  | 30.25 s — Koro realises       | 1 × 4/4 at 119                       |
| 16  | 32.25 s — the train           | 12 × 4/4 + 3/4 at 155                |
| 29  | 52.00 s — berry snatched      | 2 × 4/4 at 104                       |
| 31  | 56.60 s — into the tunnel     | 2 × 4/4 at 124                       |
| 33  | 60.50 s — Oti offers a berry  | 8 × 4/4 at 136                       |
| 41  | 74.60 s — head bonk           | 1 × 1/4 at 135                       |
| 42  | 75.05 s — second bonk         | 2 × 4/4 at 130                       |
| 44  | 78.75 s — burst into daylight | 1 × 4/4 at 159                       |
| 45  | 80.25 s — Koro launched       | 8 × 4/4 + 2/4 at 134                 |
| 54  | 95.50 s — landing impact      | 2 × 4/4 at 76                        |
| 56  | 101.80 s — defeated           | 4 × 3/4 at 72                        |
| 60  | 111.75 s — sunset, alone      | 2 × 3/4 at 69                        |
| 62  | 117.00 s — a berry falls      | 2 × 3/4 at 90                        |
| 64  | 121.00 s — the flock arrives  | 5 × 4/4 at 96 (the "Llamigos" theme) |
| 69  | 133.50 s — pull back          | 1 × 4/4 at 69                        |
| 70  | 137.00 s — credits            | 3 × 4/4 + 2/4 at 64                  |

`apps/editor/src/__tests__/caminandesCue.test.ts` asserts every row above
against the tempo model the audio engine actually plays from, plus the final
barline against the end of the clip. Edit the cue's tempo map and that test
tells you which hit you broke.

### Revising the cue against picture and a reference track

The first draft was written from a frame-by-frame read of the picture. Two later
passes — a closer frame review, and a DSP analysis of the film's own soundtrack
(RMS contour, transient detection on the percussive residue, per-section key
estimation) — found places where the music was fighting the picture:

- **Bar 33 (60.50 s) was mis-read.** The hit map called it "berry bonanza" and
  the cue played full tutti forte. On screen, Oti holds out a _single_ berry —
  a peace offering after a whole film spent fighting over one — and the wide
  shot of the mine at 62.25 s is quiet awe. The real bonanza is 65.8 s. Bars
  33–35 are now a solo clarinet, harp and muted strings, and the clarinet states
  the "Llamigos" theme there for the first time: the friendship theme belongs at
  the first act of friendship, not saved entirely for the finale.
- **Bar 64 (121.00 s) peaked too early.** The cue's loudest bar landed on the
  first frame of the flock's arrival. But Koro does not react until 123.5 s and
  the heaped berries do not fill frame until 125 s, so the music spent the moment
  before the picture finished making it. The finale is now a terraced build —
  `mp` → `mf` → `f` — cresting `ff` on the pull-back to the lighthouse at
  133.5 s, with timpani and trombone entering at the reaction rather than under
  the first frame.
- **The dynamics were flat.** 228 marks, every one `immediate`, 65 % at forte or
  above, and not one hairpin. The reference soundtrack spans 29 dB and sustains a
  ~14-second crescendo into its finale. The cue now uses all six levels with 36
  hairpins, and forte-and-above is down to 55 %.

Hairpins reference their end bar by id, so the global measures carry ids.

The music is original and ships under the repository's licence. The picture is
Caminandes 3: Llamigos, © Blender Foundation, CC BY 3.0 — the attribution the UI
shows comes from `demoSources.ts`.

## Product boundary

### Video Reference

The basic implementation should be good enough to compose against a reference
cut without learning a specialized film-scoring workflow:

- Attach or relink a local MP4/WebM file.
- Open the video in native Picture-in-Picture from an explicit user action.
- Play, pause, stop, and seek video with the shared Viritura transport.
- Keep video aligned through fixed and gradual tempo changes, meter changes,
  inserted or deleted measures, repeats, fermatas, and caesuras.
- Set a picture offset and optionally enter the video's starting timecode.
- Display current score time and formatted picture timecode in the transport.
- Toggle the video's production audio.
- Fall back to a small inline video surface when PiP is unsupported.

This implementation is allowed to inherit the seek granularity, codec support,
and frame-presentation behavior of the browser's `<video>` element. It is not
allowed to use a simplified tempo calculation that drifts from score playback.

### Advanced Scoring to Picture

The advanced implementation builds professional cue-design tools on the same
transport and mapping:

- Explicit frame-rate support: 23.976, 24, 25, 29.97 drop/non-drop, and 30 fps.
- Frame-step navigation and verified frame-boundary seeking.
- Picture-locked hit points, music-locked markers, cue ranges, and annotations.
- Streamers, punches, and overlays rendered onto picture.
- A score timecode ruler and go-to-timecode navigation.
- Tempo fitting: suggest a tempo or bounded tempo curve that lands selected
  musical events on hit points.
- Diagnostics when an edit causes a music-locked event to miss a hit point.
- Latency calibration for video presentation and attached picture audio.
- Revised-cut reconforming, preserving markers by frame/timecode where possible.
- Thumbnail strips, picture-audio waveform, and marker interchange.
- Desktop/native decoding or a WebCodecs-backed path if browser `<video>`
  cannot meet measured frame-accuracy requirements.

## Where this lives: the Picture activity

**Status: proposed. No implementation yet.**

Video Reference shipped as a panel in Play mode's right sidebar, on the reasoning
that attaching a reference cut is a once-per-project action afterwards driven
from the transport. That reasoning holds for _attaching_ and fails for
everything else.

Two problems surfaced immediately:

1. **It is undiscoverable.** The feature is invisible in Write mode — where a
   composer actually spends their time — and there is no menu entry, so a user
   who does not already know it exists will not find it.
2. **The Advanced tier has nowhere to go.** Every capability listed above
   (hit points, streamers, a timecode ruler, tempo fitting, reconforming) needs
   horizontal space proportional to the clip's duration. None of it fits in a
   280 px sidebar.

The proposal is to promote picture to its own activity, alongside Setup, Write,
Engrave, Play, Roll, Review and Publish.

### Why it qualifies

Each existing activity owns a distinct **verb** and a distinct **canvas**: Setup
configures, Write composes, Engrave refines appearance, Play balances sound, Roll
edits performance, Review compares, Publish exports.

The verb here is **spotting and syncing** — a named professional activity, not a
view of the score. In a spotting session a composer and director decide where
music starts and stops and what it must land on; the remaining work is solving
the timing. That is a mode of working on the _relationship between musical time
and picture time_, and the video is only its most visible artifact.

Name it **Picture** (or **Sync**), not **Video**. "Video" pulls the design toward
a media player with knobs, which is precisely the junk drawer to avoid.

### The canvas

The centre pane is a **warping timeline** with two rulers locked together:

````text
picture   00:00        00:30        01:00        01:30      <- fixed, absolute, frames
  [========== filmstrip thumbnails ==========]
  |     |    |        |  |       |                          <- markers
  ~~~~~~~ picture-audio waveform ~~~~~~~
  -----/```\---- tempo curve ----\___/--------
 |1  |2 |3|4  |5   |6 |7|8|9 |10 |11  |12|13|               <- elastic bars
music
````

The picture ruler never moves. The musical ruler **stretches and compresses** as
tempo is edited. Watching bars breathe against fixed picture is the mental model
of scoring to film, and it is the specific thing a sidebar cannot express.

This is a real canvas, peer to the piano roll — which is what settles the
question.

Like Write mode, it is **full bleed beneath floating panels**. The left panel
does not truncate the canvas; its right edge plus 10 px is passed as a safe
area. Fit and maximum zoom-out use only the unobscured width, placing media time
zero at the safe edge and the clip end at the canvas edge. Panning can still move
content underneath the panel, and resizing the panel keeps the same picture time
anchored at the new safe edge without changing zoom.

Picture timecode and frame stepping sit beside the primary transport in the
global header. The left panel stays task-focused: clip/open controls, markers,
and the selected solve region. Infrequent synchronization and detailed tempo-fit
controls remain available through collapsed disclosures rather than occupying
the panel continuously.

Tempo solving targets an explicitly selected interval between consecutive locked
markers. Clicking a region gives it a distinct full-height tint and emphasized
marker boundaries; the playhead remains an independent navigation control and
does not silently change the solve target.

### The capability that justifies it

**Interactive tempo fitting.** MNX schema 34 permits fractional `bpm`, so each
candidate bar-and-meter structure can take the exact tempo its duration implies.
The solver ranks those exact candidates by distance from the preferred tempo and
penalizes an extra closing meter, leaving meter and bar count as musical choices
instead of workarounds for integer rounding.

In this activity that becomes: select two locked markers, choose the musical
bar-and-meter plan between them, and apply the exact derived tempo, with a
warning when a downstream picture-locked hit would break.

### Boundaries

The risk with a workshop activity is that it accretes. Explicit limits:

- **One picture per score.** Reels (a feature in 20-minute chunks) and cues (a
  feature score is 40–90 numbered cues) are document-model questions, not picture
  questions; see [`plans/project-format.md`](project-format.md). Alternate cuts
  are reconforming, already scoped to the Advanced tier. Do not admit a media
  library early.
- **Click track splits by concern.** Its _definition_ — which bars click,
  subdivisions, streamers and punches, count-in bars — is timing and lives here.
  Its _audio_ — sound, level, routing — stays in Play with the rest of the mixer.
  Keeping that seam clean avoids forking the mixer.
- **Always present, honest when empty.** Most users never score to picture, and
  an activity slot is permanent. Hiding the activity until a picture is attached
  would recreate the discoverability bug it exists to fix, so it stays visible
  and says so when empty.

### What already supports this

- `TempoModel` is the single source of timing truth, so the timeline is a **view**
  rather than a second calculation — the rule that has governed this feature from
  the start.
- `VideoStage` is mounted globally by `VideoSyncBridge` and never reparented, so
  a PiP session already survives mode switches. The activity does not need to own
  the element; it only offers a better surface for it.
- The MCP `score.get_timeline` tool returns this activity's data model — measure
  start times, tempo regions, duration. Both are the same underlying task of
  exposing the timing model.

### Staging

1. **Move, do not build.** Introduce the activity hosting today's `VideoPanel`
   plus a read-only timeline (filmstrip, bar ruler, playhead). No engine work: it
   is a view over `TempoModel`. This alone fixes discoverability and proves
   whether the warping ruler reads as intended.
2. **Spotting.** Hit points as first-class marks, picture-locked versus
   music-locked, with diagnostics when an edit makes a locked hit miss. First
   real schema work.
3. **Tempo fitting.** The payoff. By then the timeline can already display the
   error, so the solver has somewhere to render its answer.

Reconforming and frame-accurate WebCodecs decoding stay where the Advanced tier
puts them — later, and only if measurement shows browser `<video>` is not good
enough.

### What the activity now holds

All three stages above have landed, plus streamers, which moved forward from the
Advanced tier once Document PiP made an overlay surface available at no engine
cost. Concretely:

- **Timeline.** `timelineGeometry` (pure, tested), `timelineRenderer` (painter),
  `TimelineCanvas` (input and DPR only). Bars come from `resolveTimeline`, which
  is the single place the tempo model is read for the timeline.
- **Filmstrip.** A detached decoder on the same object URL, seeks serialised,
  whole frames tiled edge-to-edge and decimated as the view zooms out.
- **Waveform.** `decodeAudioData` on the already-downloaded blob, reduced to a
  min/max envelope in a worker. No new dependency, no second download.
- **SMPTE.** Rational frame rates, real drop-frame, frame stepping through the
  transport, go-to-timecode. MediaInfo reads the selected file's timing and
  timecode metadata; the composer confirms ambiguous DF/NDF or VFR deliveries.
- **Solving.** `spanPlan` states what the music is between two hits; the tempo
  is derived. `planPatches` turns that into score edits, splitting tempo (always
  applied, reversible) from structure (opt-in, with a count of the written bars
  at risk).
- **Picture window.** Document PiP where available, a draggable/resizable
  floating panel where not, both rendering the same surface with streamers and
  punches composited over a mirrored frame.

### Frame rate comes from the file, with manual confirmation where needed

Native browser media APIs remain the wrong source:
`MediaTrackSettings.frameRate` describes a captured `MediaStreamTrack`, and
reading it via `captureStream()` on a known 24 fps clip returns 30 — the capture
rate, not the file's. `requestVideoFrameCallback` measures presented cadence,
which requires playback and can be affected by dropped frames.

Instead, a lazy MediaInfo worker reads byte ranges from the selected Blob and
reports the container rational (`FrameRate_Num`/`FrameRate_Den`), CFR/VFR mode,
minimum/maximum cadence, QuickTime start timecode and the `tmcd` drop-frame flag
where present. The WASM is fetched only after a picture is attached and parsing
never blocks the timeline.

High-confidence standard CFR metadata is adopted when the score has no declared
rate. VFR is warned and never auto-adopted. `30000/1001` and `60000/1001` without
an explicit DF/NDF flag are also left for confirmation: the rational determines
frame duration, but not how SMPTE labels are numbered. Manual selection remains
the durable value in the score.

Supported reference containers are QuickTime MOV, MP4/M4V and WebM. Supporting a
container means its metadata can be inspected; playback still depends on the
codec the browser can decode. A ProRes or DNx MOV can therefore yield exact
timecode while still requiring an H.264 proxy for playback.

The panel keeps four related concepts visually distinct:

- The large SMPTE value is the **current picture position** and becomes a
  go-to-timecode input when clicked.
- **Picture timebase** is a compact summary (`24 fps`, `29.970 fps ·
Drop-frame`) with a source badge. The full selector appears only on Change;
  ambiguous NTSC metadata shows focused DF/NDF choices instead.
- **Timecode origin** separately names media frame zero and uses constrained
  `HH:MM:SS:FF` segments, rate-aware frame bounds, DF validation and common
  00/01/10-hour presets. Editing it never moves the playhead.
- Previous/next-frame controls move the transport; there is no separate
  unlabeled Go row.

Normal metadata is supporting evidence (`MPEG-4 · Constant frame rate ·
30000/1001`), not a second copy of the selected value. Only exception states
receive emphasis: VFR, a selected/detected mismatch, unreadable metadata, or
missing DF/NDF.

## One timeline, two coordinate systems

The score and picture must remain separate coordinate systems:

```text
score position (measure + beat)
  -> global quarter-note beat
  -> TempoModel.timeAtBeat(...)
  -> score time in seconds
  -> score time + picture offset
  -> media time / SMPTE frame
```

The inverse supports video scrubbing and timecode navigation:

```text
media time - picture offset
  -> score time
  -> TempoModel.beatAtTime(...)
  -> measure + beat
```

`@viritura/midi` already provides the continuous, invertible `TempoModel` used
by playback. It integrates fixed tempo regions, gradual tempo curves, and point
time insertions. The video synchronizer must consume this same model rather
than construct a second tempo map.

Time-signature changes and measure insertion affect the score-position to
global-beat axis. They do not mutate picture time. After a score edit, the
timeline is regenerated and every picture-locked marker resolves to its new
musical location.

Repeats require the expanded playback sequence. A written measure can occur
more than once in performance time, so an advanced marker must identify an
expanded occurrence when that distinction matters.

## Clock and synchronization policy

Viritura's playback transport is the authority. The video is a synchronized
consumer, not a second transport competing to own time.

- On play, seek video to the mapped media time and start it with score playback.
- On pause or stop, apply the same operation to video.
- On score seek, map the new score time to `video.currentTime`.
- On user interaction with native PiP controls, translate video play/pause
  events back into Viritura transport actions.
- Guard programmatic media events so they do not feed back into duplicate
  transport commands.
- During playback, compare expected media time with presented media time.
  Ignore small jitter, apply bounded playback-rate correction for moderate
  drift, and hard-seek only when drift exceeds a measured threshold.
- Re-anchor after tab suspension, device changes, buffering, visibility
  changes, and score timeline regeneration.

`timeupdate` is too coarse to drive synchronization. Use the playback engine's
clock for expected time and `requestVideoFrameCallback` where available to
observe presented video frames. A basic fallback may sample
`video.currentTime` from `requestAnimationFrame`.

Picture audio is optional and follows the video element. The initial
implementation should default it to muted to avoid surprising double audio,
then persist the user's choice. Advanced latency calibration may route picture
audio through Web Audio where platform and source restrictions permit.

## Picture-in-Picture UI

### Chosen basic experience

Viritura should not build a draggable video gadget inside the editor as the
primary experience. Native video PiP already provides the behavior composers
need most:

- an always-on-top window;
- OS-managed movement and resizing;
- visibility while working elsewhere;
- browser-owned play/pause controls;
- no editor layout or canvas occlusion logic.

The editor still needs a small **Video** popover or transport menu containing:

- Attach / Relink / Remove video
- Open / Close Picture-in-Picture
- Picture offset
- Starting timecode
- Picture-audio mute
- Sync status and a corrective **Re-sync** action

The `<video>` element remains mounted in the editor document while PiP is
active. The browser moves its presentation into the PiP window; Viritura
continues controlling the same element.

Entering PiP must be initiated by a user gesture, and the UI must test
`document.pictureInPictureEnabled` plus
`HTMLVideoElement.requestPictureInPicture` before offering the action. It must
also handle the user closing the PiP window independently.

### What native video PiP does not provide, and why it was replaced

Standard video PiP displays only the video element. Nothing can be drawn over
it, its controls are browser-owned, and there is nowhere to put a streamer or a
timecode readout.

For Video Reference that limitation was desirable: transport stayed in Viritura
and the picture window stayed simple.

For scoring to picture it is disqualifying, because the overlay _is_ the
feature. The plan above hedged on Document PiP ("a progressive enhancement; do
not make it a requirement"). In practice the hedge was unnecessary, because the
fallback is not a lesser experience:

- Where Document PiP exists, the surface goes into a real always-on-top OS
  window hosting our own DOM.
- Where it does not, the identical surface is portalled to `document.body` as a
  draggable, resizable floating panel, bound to the viewport rather than to any
  activity.

One surface, two hosts, no second player implementation — which is what made it
safe to drop native video PiP entirely rather than keep both. Two mechanisms
driving the same element would eventually fight over it.

The frame is **mirrored onto a canvas** rather than the `<video>` being moved
into the pop-out. Moving it is what the platform's own examples do, but this
element is bound to the synchronizer and rendered by React, and re-parenting it
out from under both invites a torn-down media session or a portal that recreates
the node and drops the object URL. Mirroring costs one `drawImage` per presented
frame at pop-out size — pulled through `requestVideoFrameCallback` where it
exists, so it advances with the video's frames rather than the display's refresh
— and buys a surface the cues composite into directly.

A dedicated always-on-top native window in the desktop shell remains the escape
hatch if webview frame accuracy proves inadequate.

## Data ownership and persistence

The media binary is not embedded in canonical MNX. Portable synchronization
metadata lives in `_x.viritura.videoSync`, and the file is treated as a
relinkable project asset. The shipped shape (see
[`spec/viritura-extensions.md`](../spec/viritura-extensions.md)):

```jsonc
{
  "_x": {
    "viritura": {
      "videoSync": {
        "version": 1,
        "pictureOffsetSeconds": 120,
        "pictureAudioEnabled": false,
        // Display-only; never affects the media time we seek to.
        "startTimecodeSeconds": 3600,
        // Declared, not detected: NTSC rates are rational (23.976 is exactly
        // 24000/1001) and drop-frame is a labelling convention rather than a
        // speed, so the id carries both.
        "frameRate": "23.976",
        "hitPoints": [{ "id": "h1", "pictureSeconds": 12.5, "label": "door slams", "locked": true }],
        "media": {
          "displayName": "picture-lock-v12.mp4",
          // Local file: verifies a relink is the same cut.
          "contentHash": "sha256:...",
          // Demo clip instead: streams from a public URL, no relink needed.
          // "demoSourceId": "caminandes-llamigos",
          "durationSeconds": 150.5,
        },
      },
    },
  },
}
```

Streamer preferences are deliberately _not_ persisted here: how a conductor
likes their cues is a property of the session and the room, not of the score.

Absolute local paths are never persisted. Browser file handles and desktop paths
are device-local bindings keyed by project plus content hash. When the binding is
unavailable the panel shows **Offline on this device — relink to continue**,
without blocking score editing or playback. Relinking a file whose hash differs
from the remembered one raises _"This looks like a different cut; sync points may
have moved"_ rather than silently accepting it.

Removing a picture keeps the offset and audio preference: they describe how the
composer works with the cue, not which file it used, and re-entering them after a
relink is exactly the busywork video sync exists to remove. Conversely, a score
that never used the feature never gets an inert `videoSync` block, so MNX diffs
stay clean for everyone else.

A future `.viritura` container may optionally carry a documented `media/`
asset, but external media must remain first-class because picture files can be
large and are commonly revised independently of the score.

Markers need explicit attachment semantics:

- **Picture-locked:** absolute media frame/time; score edits change the
  corresponding musical location.
- **Music-locked:** stable score element or measure/beat identity; score edits
  change the corresponding picture time.

Basic Video Reference ships no marker editor, and deliberately no bookmark
concept either — an unlabelled bookmark whose lock semantics were never decided
would have to be migrated once the distinction above becomes real.

## Module boundaries

`@viritura/video-sync` owns this rather than the already-large playback provider:

```text
packages/video-sync/src/
  index.ts                 public barrel
  types.ts                 persisted and runtime contracts
  scorePictureMap.ts       score time <-> media time
  timecode.ts              rational frame/timecode conversion
  videoSynchronizer.ts     drift and transport coordination
  pictureInPicture.ts      capability and lifecycle adapter
```

The package consumes public contracts from `@viritura/midi` and
`@viritura/playback`. The editor owns attachment/relink UI and fallback panel.
Advanced overlays and marker editing should be separate feature folders that
consume the package barrel.

The playback package will likely need a narrow public transport-clock contract:

- current score time in seconds;
- status changes;
- seek-by-seconds as well as seek-by-global-beat;
- access to the current `TempoModel` or a public time/position mapper;
- timeline-regenerated notification.

Expose those intentionally rather than reading private refs from
`PlaybackContext`.

## Implementation sequence

### Stage 1 - Timing contract

- Extract a read-only playback clock and score-position mapping contract.
- Add score-time/media-time mapping with offset and clamping.
- Test fixed tempo, mid-measure tempo, gradual tempo, meter changes, holds,
  inserted measures, and expanded repeats.
- Keep all conversion math independent of React and `<video>`.

### Stage 2 - Video Reference

- Attach local media with `File` plus `URL.createObjectURL`.
- Add the video-sync controller and shared transport event guards.
- Add native PiP capability detection and lifecycle handling.
- Add the compact inline fallback.
- Add offset, starting-timecode display, audio mute, relink, and re-sync UI.
- Persist sync metadata and device-local media bindings separately.
- Add a composed app Storybook story using a small repository-owned fixture.

### Stage 3 - Reliability hardening

- Measure drift and seek behavior in supported Chromium, Safari, Firefox, and
  the Tauri webview; document the actual capability matrix.
- Use `requestVideoFrameCallback` where available.
- Cover buffering, suspend/resume, visibility changes, count-in, looping,
  playback from the middle, score edits during playback, and missing media.
- Establish measurable drift and recovery acceptance criteria from real media.

### Stage 4 - Advanced Scoring to Picture

- Implement rational SMPTE conversion and drop-frame formatting.
- Add picture-locked and music-locked markers, hit-point capture, ruler, and
  diagnostics.
- Add frame stepping, streamers, punches, and tempo-fitting tools.
- Add revised-cut reconforming and marker interchange.
- Decide between browser video, WebCodecs, and native desktop decoding only
  after the Stage 3 measurements identify a concrete limitation.

## Acceptance criteria

### Video Reference

- Tempo, meter, hold, repeat, and measure edits use the same timing result as
  audio playback.
- Play, pause, stop, score seek, PiP play/pause, and close-PiP transitions do
  not create feedback loops or duplicate playback.
- The user can freely move and resize picture through native PiP where
  supported.
- Unsupported PiP degrades to the inline panel without losing synchronization.
- A missing local video produces a visible relink state and never blocks score
  access.
- No absolute local path is serialized into MNX.

### Advanced Scoring to Picture

- Frame/timecode conversions are deterministic at every supported frame rate,
  including drop-frame minute boundaries. **Met** — round-tripped in tests
  across drop-frame boundaries and the ten-minute exception.
- Picture-locked markers remain on their frame after score structure or tempo
  changes. **Met** — hits are stored in picture time and never touched by score
  edits.
- Music-locked markers remain on their score identity and visibly report their
  changed picture time. **Not yet** — every hit is currently picture-locked;
  `locked` distinguishes "the solver must land here" from "note to self", which
  is a different axis.
- Frame-accuracy and drift tolerances are measured and documented per runtime;
  no runtime is described as frame-accurate without passing those tests.
  **Outstanding, and deliberately so.** Frame stepping snaps to the frame grid
  and seeks the transport, which is correct arithmetic; whether the element
  actually presents that frame is a per-runtime question that has not been
  measured. Nothing here claims frame accuracy until it has been.

## Open questions

1. Should Video Reference expose production audio immediately, or remain muted
   until the user explicitly enables it?
2. Should the basic implementation include simple picture bookmarks, or defer
   all marker concepts to Advanced Scoring to Picture?
3. Is a media file external-only for the first release, or should `.viritura`
   embedding arrive alongside it?
4. Which browser/runtime matrix is required for launch versus supported through
   the inline fallback?
5. For desktop, does the current webview's native video PiP behave reliably
   enough, or should the shell own an always-on-top video window from the start?
6. Should a hit be able to lock to _music_ rather than picture — "this bar line,
   wherever the cut moves it" — for reconforming? That is the natural home for
   the music-locked marker the acceptance criteria describe.
7. Streamer length is fixed at the two-second convention. Is per-hit length
   worth the UI, or does one global preference cover real use?

## Browser references

- [W3C Picture-in-Picture API](https://w3c.github.io/picture-in-picture/)
- [Document Picture-in-Picture](https://developer.chrome.com/docs/web-platform/document-picture-in-picture/)
- [`requestVideoFrameCallback`](https://developer.mozilla.org/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)
