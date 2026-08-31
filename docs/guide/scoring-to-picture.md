# Scoring to Picture

The **Picture** activity relates musical time to picture time. Attach a local
video, spot important frames, and use the elastic bar timeline to see how meter
and tempo carry the music between hit points.

## Attach a video

Open Picture and choose **Configure** in the Video panel:

1. Choose a local video file, or try the bundled demo clip.
2. Set the clip's frame rate and timecode origin.
3. Confirm the picture offset that aligns score time with picture time.
4. Select **Done**.

The local file is not uploaded as part of this workflow. The document stores its
timing relationship and attachment metadata; after moving the project or
returning on another device, use **Relink…** when prompted.

## Work with timecode

The Picture toolbar displays picture timecode instead of only musical
measure-and-beat position. Use the configured SMPTE frame rate when checking
delivery notes or spotting against an external edit.

Scrubbing the timeline seeks the shared playback transport. The fixed picture
ruler and elastic bar ruler stay aligned as tempo changes.

## Add and edit markers

Markers represent moments the music should acknowledge:

- press `M` to add a marker at the current picture playhead;
- Shift-click the timeline to add a marker at a specific frame;
- drag a marker to move it, with frame snapping;
- double-click a marker to edit its label.

Name markers by dramatic purpose—such as “door closes” or “reveal”—rather than
only by timestamp. This keeps the spotting intent understandable when the edit
changes.

## Solve an interval

Select the region between two markers to send it to the Solve panel. The panel
compares the available bars, meters, and tempi for reaching the second hit from
the first.

Treat a solve as a compositional starting point, not an instruction to flatten
the entire cue to one tempo. After applying a solution, listen through the
approach and inspect the resulting bar lengths on the timeline.

## Video window

The video panel can move into the browser or desktop host's picture-in-picture
window. The video element remains active when you switch activities, so you can
watch the scene while editing notation in Write or Engrave.

For transport controls, see
[Playback, Mixer & Piano Roll](/docs/playback-and-piano-roll). Picture-specific
mouse and keyboard commands are listed in
[Keyboard & Mouse](/docs/keyboard-shortcuts#picture).
