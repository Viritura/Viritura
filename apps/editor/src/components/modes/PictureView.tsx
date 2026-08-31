/**
 * Picture mode — spotting and syncing the score to picture.
 *
 * The other activities are lenses on the score; this one is a lens on the
 * *relationship between musical time and picture time*. A composer spots a cue
 * by watching the film and marking the moments music has to land on, then works
 * out the bars, meters and tempi that get there. The video is the most visible
 * part of that, but the subject is the timing.
 *
 * The canvas is therefore a timeline rather than notation: a fixed picture ruler
 * with an elastic bar ruler beneath it, so bars visibly stretch and compress
 * against picture as the tempo map changes. That needs horizontal space
 * proportional to the clip's duration, which is why this cannot live in a
 * sidebar — see `docs/plans/video-sync.md`.
 *
 * The `<video>` element itself is owned by the always-mounted `VideoSyncBridge`
 * (see `main.tsx`), not by this view, so an open Picture-in-Picture session
 * survives switching modes.
 *
 * Panels live on the **left**. That is the workspace's primary side, and
 * everything here — the timebase, the picture, the hit list, the solver — is
 * what the composer is working *in*, not commentary on a selection. The right
 * side stays free for secondary information that has to be readable at the same
 * time as the left panel rather than instead of it.
 */

import { useCallback, useMemo, useState } from "react";
import { TransportBar, usePlaybackActions } from "@viritura/playback";
import {
  TimelineCanvas,
  VideoPanel,
  markerIntervalAt,
  markerIntervals,
  useVideoSyncActions,
  useVideoSyncState,
} from "@viritura/video-sync";
import type { Score } from "@viritura/core";
import { ToolbarPortal } from "../AppShell";
import { ViewLayout } from "../ViewLayout";
import { PictureSetupDialog } from "./picture/PictureSetupDialog";
import { SolvePanel } from "./picture/SolvePanel";
import { MarkerPanel } from "./picture/MarkerPanel";
import { TimecodePanel } from "./picture/TimecodePanel";
import { usePictureTiming } from "./picture/usePictureTiming";
import { usePictureShortcuts } from "./picture/usePictureShortcuts";
import styles from "./PictureView.module.css";

interface PictureViewProps {
  /** The current score, if available. */
  readonly score?: Score | null;
}

export function PictureView({ score }: PictureViewProps) {
  const timing = usePictureTiming(score ?? null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [selectedIntervalIds, setSelectedIntervalIds] = useState<{
    fromMarkerId: string;
    toMarkerId: string;
  } | null>(null);
  const [editMarkerRequest, setEditMarkerRequest] = useState<{ id: string; token: number } | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const actions = useVideoSyncActions();
  const intervals = useMemo(() => markerIntervals(timing.hits), [timing.hits]);
  const selectedInterval = useMemo(
    () =>
      selectedIntervalIds
        ? (intervals.find(
            (interval) =>
              interval.fromMarkerId === selectedIntervalIds.fromMarkerId &&
              interval.toMarkerId === selectedIntervalIds.toMarkerId,
          ) ?? null)
        : null,
    [intervals, selectedIntervalIds],
  );

  const addMarkerAtPlayhead = useCallback(() => {
    const id = actions.addHitPoint(timing.playheadSeconds ?? timing.pictureOffsetSeconds);
    setSelectedMarkerId(id);
  }, [actions, timing.pictureOffsetSeconds, timing.playheadSeconds]);

  usePictureShortcuts(addMarkerAtPlayhead);

  const panels = (
    <div className={styles.panels}>
      <VideoPanel onConfigure={() => setSetupOpen(true)} />
      <MarkerPanel onAddMarkerAtPlayhead={addMarkerAtPlayhead} editMarkerRequest={editMarkerRequest} />
      <SolvePanel
        score={score ?? null}
        bars={timing.bars}
        interval={selectedInterval}
        intervals={intervals}
        onSelectInterval={(interval) =>
          setSelectedIntervalIds(
            interval ? { fromMarkerId: interval.fromMarkerId, toMarkerId: interval.toMarkerId } : null,
          )
        }
        frameRate={timing.frameRate}
      />
    </div>
  );

  return (
    <>
      <ToolbarPortal>
        <div className={styles.pictureTransport} role="toolbar" aria-label="Picture transport">
          <TransportBar compact showTimeDisplay={false} showFollow={false} />
          <TimecodePanel placement="toolbar" />
        </div>
      </ToolbarPortal>
      <ViewLayout
        layoutId="picture-layout"
        leftPanel={{ content: panels, defaultSize: 320, minSize: 260, maxSize: 460 }}
        statusBar={score ? undefined : "no score loaded"}
      >
        {(insets) => (
          <div className={styles.canvasArea}>
            <PictureTimeline
              timing={timing}
              selectedMarkerId={selectedMarkerId}
              selectedInterval={selectedInterval}
              intervals={intervals}
              onSelectMarker={setSelectedMarkerId}
              onSelectInterval={(interval) =>
                setSelectedIntervalIds(
                  interval ? { fromMarkerId: interval.fromMarkerId, toMarkerId: interval.toMarkerId } : null,
                )
              }
              onEditMarker={(id) => {
                setSelectedMarkerId(id);
                setEditMarkerRequest((current) => ({ id, token: (current?.token ?? 0) + 1 }));
              }}
              // Same convention as Write: panel edge plus a little breathing
              // room, while the canvas itself remains full bleed underneath.
              safeAreaLeft={insets.left > 0 ? insets.left + 10 : 12}
            />
          </div>
        )}
      </ViewLayout>
      <PictureSetupDialog open={setupOpen} onClose={() => setSetupOpen(false)} />
    </>
  );
}

interface PictureTimelineProps {
  readonly timing: ReturnType<typeof usePictureTiming>;
  readonly selectedMarkerId: string | null;
  readonly selectedInterval: ReturnType<typeof markerIntervals>[number] | null;
  readonly intervals: ReturnType<typeof markerIntervals>;
  readonly onSelectMarker: (id: string | null) => void;
  readonly onSelectInterval: (interval: ReturnType<typeof markerIntervals>[number] | null) => void;
  readonly onEditMarker: (id: string) => void;
  readonly safeAreaLeft: number;
}

/**
 * The warping timeline.
 *
 * Bars are resolved through the playback timeline's own tempo model rather than
 * a second calculation, so what is drawn is exactly what will be played.
 *
 * Drawn flush with the workspace background rather than inside a glass card.
 * A card suits the piano roll, which is one view among several sharing the
 * workspace; this is the activity's entire subject, and framing it as a widget
 * floating on a surface would say otherwise.
 */
function PictureTimeline({
  timing,
  selectedMarkerId,
  selectedInterval,
  intervals,
  onSelectMarker,
  onSelectInterval,
  onEditMarker,
  safeAreaLeft,
}: PictureTimelineProps) {
  const state = useVideoSyncState();
  const actions = useVideoSyncActions();
  const playbackActions = usePlaybackActions();

  const handleScrub = useCallback(
    (pictureSeconds: number) => {
      // `seek` takes score-time seconds despite its parameter name.
      playbackActions.seek(Math.max(0, pictureSeconds - timing.pictureOffsetSeconds));
    },
    [playbackActions, timing.pictureOffsetSeconds],
  );

  const handlePick = useCallback(
    (pictureSeconds: number, markerId: string | null) => {
      onSelectMarker(markerId);
      if (!markerId) onSelectInterval(markerIntervalAt(pictureSeconds, intervals));
    },
    [intervals, onSelectInterval, onSelectMarker],
  );

  const handleAddMarker = useCallback(
    (pictureSeconds: number) => onSelectMarker(actions.addHitPoint(pictureSeconds)),
    [actions, onSelectMarker],
  );

  const handleMoveMarker = useCallback(
    (id: string, pictureSeconds: number) => {
      const snapped = Math.round(pictureSeconds * timing.frameRate) / timing.frameRate;
      actions.moveHitPoint(id, Math.min(timing.durationSeconds, Math.max(0, snapped)));
    },
    [actions, timing.durationSeconds, timing.frameRate],
  );

  return (
    <TimelineCanvas
      bars={timing.bars}
      hits={timing.hits}
      durationSeconds={timing.durationSeconds}
      playheadSeconds={timing.playheadSeconds}
      frameRate={timing.frameRate}
      safeAreaLeft={safeAreaLeft}
      selectedHitId={selectedMarkerId}
      selectedSpan={selectedInterval}
      waveform={state.waveform}
      mediaObjectUrl={state.mediaObjectUrl}
      onScrub={handleScrub}
      onPick={handlePick}
      onAddMarker={handleAddMarker}
      onMoveMarker={handleMoveMarker}
      onEditMarker={onEditMarker}
    />
  );
}
