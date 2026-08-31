/**
 * VideoSyncProvider — mounts the picture surface and wires it to the transport.
 *
 * Deliberately thin: everything stateful lives in `VideoSyncController`, so this
 * file stays components-only (React Fast Refresh, and the
 * `react-refresh/only-export-components` rule) and the sync logic can be tested
 * without a renderer.
 *
 * The provider renders no context. Like `@viritura/playback`, consumers read
 * through the module-level store, which keeps the panel mountable in Storybook
 * with no provider in the tree.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { VideoSyncSettings } from "@viritura/core";
import type { TransportBridge } from "./types";
import { VideoSyncController } from "./videoSyncController";
import { resetVideoSyncState, setVideoSyncActions, useVideoSyncActions, useVideoSyncState } from "./videoSyncStore";
import { PictureSurface } from "./PictureSurface";
import { PictureWindow } from "./PictureWindow";
import { resolveHits } from "./resolveTimeline";
import { fps, frameRateById } from "./smpte";
import { VideoStage } from "./VideoStage";

export interface VideoSyncProviderProps {
  /** Bridge to Viritura's playback transport — the master clock. */
  readonly transport: TransportBridge;
  /** Settings from the open score's `_x.viritura.videoSync`. */
  readonly settings: VideoSyncSettings | undefined;
  /** Persist a settings change back into the score. */
  readonly onSettingsChange: (settings: VideoSyncSettings | undefined) => void;
  /** Stable across edits; changes only when a different document opens. */
  readonly documentToken?: unknown;
  /**
   * Changes identity whenever the playback timeline could have moved (a tempo,
   * meter, or measure-count edit). The picture re-anchors, because the same
   * musical position now falls at a different score time.
   */
  readonly timelineToken?: unknown;
  readonly children?: ReactNode;
}

export function VideoSyncProvider({
  transport,
  documentToken,
  settings,
  onSettingsChange,
  timelineToken,
  children,
}: VideoSyncProviderProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [controller, setController] = useState<VideoSyncController | null>(null);

  // Latest persistence callback, read without rebuilding the controller (which
  // would tear down an active PiP session on every parent render).
  const onSettingsChangeRef = useRef(onSettingsChange);
  useEffect(() => {
    onSettingsChangeRef.current = onSettingsChange;
  }, [onSettingsChange]);

  const transportRef = useRef(transport);
  useEffect(() => {
    transportRef.current = transport;
  }, [transport]);

  useEffect(() => {
    const instance = new VideoSyncController({
      transport: {
        getScoreTimeSeconds: () => transportRef.current.getScoreTimeSeconds(),
        getStatus: () => transportRef.current.getStatus(),
        play: (fromSeconds) => transportRef.current.play(fromSeconds),
        pause: () => transportRef.current.pause(),
        seekSeconds: (seconds) => transportRef.current.seekSeconds(seconds),
      },
      onSettingsChange: (next) => onSettingsChangeRef.current(next),
    });
    instance.setElement(videoRef.current);
    setVideoSyncActions(instance.actions());
    setController(instance);

    return () => {
      instance.dispose();
      resetVideoSyncState();
      setController(null);
    };
  }, []);

  useEffect(() => {
    if (!controller) return;
    // Keep these in one effect. Two documents can legitimately expose the
    // same settings identity (most often `undefined`); separate effects would
    // invalidate the old binding on the token change but skip reapplying the
    // new document's identical settings value, leaving the controller's
    // internal offset/rate/hits from the previous score.
    controller.setDocumentToken(documentToken);
    controller.applySettings(settings);
  }, [controller, documentToken, settings]);

  useEffect(() => {
    controller?.notifyTimelineChanged();
  }, [controller, timelineToken]);

  return (
    <>
      <VideoStageHost videoRef={videoRef} />
      {children}
    </>
  );
}

/**
 * Renders the picture surfaces from store state.
 *
 * The `<video>` element stays mounted and out of sight for the whole session —
 * it is the decoder, not the display. What the composer looks at is the pop-out,
 * which mirrors its frames and draws cues over them. Keeping the element in one
 * place means nothing ever re-parents it, so opening and closing the pop-out
 * cannot interrupt decoding or drop the object URL.
 */
function VideoStageHost({ videoRef }: { readonly videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const state = useVideoSyncState();
  const actions = useVideoSyncActions();
  const hits = useMemo(() => resolveHits(state.hitPoints), [state.hitPoints]);
  const frameRate = fps(frameRateById(state.frameRateId));
  const attached = state.attachment === "ready" || state.attachment === "loading";

  return (
    <>
      <VideoStage
        videoRef={videoRef}
        visible={attached && !state.pictureWindowOpen}
        attribution={state.attribution}
        attributionUrl={state.attributionUrl}
      />
      <PictureWindow
        open={state.pictureWindowOpen && attached}
        onClose={actions.togglePictureWindow}
        title={state.mediaName ?? "Picture"}
      >
        <PictureSurface
          videoRef={videoRef}
          hits={hits}
          pictureOffsetSeconds={state.pictureOffsetSeconds}
          streamerOptions={{ frameRate }}
          showStreamers={state.showStreamers}
        />
      </PictureWindow>
    </>
  );
}
