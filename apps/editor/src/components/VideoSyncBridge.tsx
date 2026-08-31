/**
 * VideoSyncBridge — connects `@viritura/video-sync` to the editor's document
 * and playback stores.
 *
 * Kept in the editor rather than inside the video package so `@viritura/video-sync`
 * stays free of any dependency on the document store, and so the transport seam
 * remains a narrow interface that Storybook and tests can stub.
 *
 * The bridge reads the transport non-reactively (`getPlaybackSnapshot`). The
 * synchronizer samples the playhead on its own animation-frame loop, so a React
 * subscription here would re-render at 60 Hz just to hand over a number.
 */

import { useCallback, useMemo } from "react";
import type { Score, VideoSyncSettings } from "@viritura/core";
import { getPlaybackSnapshot } from "@viritura/playback";
import { VideoSyncProvider, type TransportBridge } from "@viritura/video-sync";
import { useDocumentStore, useDocumentStoreApi } from "../store/DocumentContext";

/** Bridge the playback store to the video package's transport contract. */
function createTransportBridge(): TransportBridge {
  return {
    getScoreTimeSeconds: () => getPlaybackSnapshot().state.playheadPosition?.timeSeconds ?? 0,
    getStatus: () => getPlaybackSnapshot().state.status,
    play: (fromSeconds) => getPlaybackSnapshot().actions.play(fromSeconds),
    pause: () => getPlaybackSnapshot().actions.pause(),
    // `PlaybackActions.seek` takes score-time seconds despite its parameter name
    // (see PlaybackContext: it forwards straight to `PlaybackEngine.seek`).
    seekSeconds: (seconds) => getPlaybackSnapshot().actions.seek(seconds),
  };
}

export function VideoSyncBridge() {
  const score = useDocumentStore((state) => state.score);
  const documentGeneration = useDocumentStore((state) => state.documentGeneration);
  const storeApi = useDocumentStoreApi();

  const transport = useMemo(() => createTransportBridge(), []);

  const handleSettingsChange = useCallback(
    (settings: VideoSyncSettings | undefined) => {
      // Compose against `workingScore`, not the rendered `score`. An edit whose
      // layout is still in flight has already advanced the working model;
      // building from the published one would drop it.
      const { workingScore, updateScore } = storeApi.getState();
      if (!workingScore) return;
      if (settings === undefined && workingScore.videoSync === undefined) return;

      const { videoSync: _previous, ...rest } = workingScore;
      const next: Score = settings === undefined ? rest : { ...rest, videoSync: settings };
      // No `affectedMeasures`: nothing musical changed. This still takes the
      // full serialize + relayout path (a videoSync-only delta reports no
      // changed measures, which is not patch-eligible), which is acceptable
      // because these writes are user-initiated and rare — attach, relink,
      // offset commit, align, audio toggle — not per-keystroke.
      updateScore(next);
    },
    [storeApi],
  );

  return (
    <VideoSyncProvider
      transport={transport}
      documentToken={documentGeneration}
      settings={score?.videoSync}
      onSettingsChange={handleSettingsChange}
      // Score identity changes on every edit. That is a deliberate
      // over-approximation of "the timeline moved": a re-anchor costs one seek,
      // whereas missing one leaves the picture silently offset after a tempo or
      // measure-count change — the exact failure this feature exists to prevent.
      timelineToken={score}
    />
  );
}
