/**
 * Storybook story for video sync (basic "Video Reference" tier).
 *
 * Runs against a stub transport rather than the audio engine so the story
 * demonstrates the part that is hard to see otherwise: the picture following
 * score time through the offset, and native Picture-in-Picture handing transport
 * control back to Viritura.
 *
 * The demo clip streams from Wikimedia Commons under CC BY, so the story needs
 * network access but no checked-in media.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import type { VideoSyncSettings } from "@viritura/core";
import { VideoPanel, VideoSyncProvider, type TransportBridge, type TransportStatus } from "@viritura/video-sync";

const PAGE_STYLE: CSSProperties = {
  display: "flex",
  gap: 24,
  padding: 24,
  minHeight: "100vh",
  background: "var(--bg)",
  color: "var(--text)",
};
const PANEL_STYLE: CSSProperties = {
  width: 300,
  border: "1px solid var(--border)",
  borderRadius: 10,
  background: "var(--surface)",
};
const NOTES_STYLE: CSSProperties = {
  maxWidth: 460,
  fontSize: "var(--type-small-size)",
  lineHeight: 1.6,
  color: "var(--text-muted)",
};
const READOUT_STYLE: CSSProperties = {
  fontFamily: "monospace",
  fontSize: "var(--type-small-size)",
  marginBottom: 12,
};
const BUTTON_ROW_STYLE: CSSProperties = { display: "flex", gap: 8, marginBottom: 16 };

/**
 * A transport stub that advances score time on a real clock.
 *
 * Enough to exercise the synchronizer end to end: it owns the clock, reports a
 * status, and accepts play/pause/seek — the same contract the editor satisfies
 * with `@viritura/playback`.
 */
function useStubTransport() {
  const stateRef = useRef({ status: "stopped" as TransportStatus, scoreTime: 0, startedAt: 0 });
  const [, forceRender] = useState(0);

  const read = useCallback(() => {
    const s = stateRef.current;
    return s.status === "playing" ? s.scoreTime + (performance.now() - s.startedAt) / 1000 : s.scoreTime;
  }, []);

  const bridge = useMemo<TransportBridge>(
    () => ({
      getScoreTimeSeconds: read,
      getStatus: () => stateRef.current.status,
      play: (fromSeconds) => {
        const s = stateRef.current;
        if (fromSeconds !== undefined) s.scoreTime = fromSeconds;
        s.startedAt = performance.now();
        s.status = "playing";
        forceRender((n) => n + 1);
      },
      pause: () => {
        const s = stateRef.current;
        s.scoreTime = read();
        s.status = "paused";
        forceRender((n) => n + 1);
      },
      seekSeconds: (seconds) => {
        const s = stateRef.current;
        s.scoreTime = seconds;
        s.startedAt = performance.now();
        forceRender((n) => n + 1);
      },
    }),
    [read],
  );

  return { bridge, read, stateRef, forceRender };
}

function VideoSyncDemo() {
  const [settings, setSettings] = useState<VideoSyncSettings | undefined>(undefined);
  const { bridge, read, forceRender } = useStubTransport();

  return (
    <VideoSyncProvider transport={bridge} settings={settings} onSettingsChange={setSettings}>
      <div style={PAGE_STYLE}>
        <div style={PANEL_STYLE}>
          <VideoPanel />
        </div>
        <div style={NOTES_STYLE}>
          <div style={READOUT_STYLE}>
            score time: {read().toFixed(2)}s · status: {bridge.getStatus()}
          </div>
          <div style={BUTTON_ROW_STYLE}>
            <button onClick={() => bridge.play()}>Play</button>
            <button onClick={() => bridge.pause()}>Pause</button>
            <button onClick={() => bridge.seekSeconds(30)}>Seek to 30s</button>
            <button onClick={() => forceRender((n) => n + 1)}>Refresh readout</button>
          </div>
          <p>
            Press <strong>Try demo clip</strong> to stream Caminandes 3: Llamigos (Blender Foundation, CC BY), then
            drive playback from the buttons above. The picture follows score time through the offset.
          </p>
          <p>
            <strong>Open picture window</strong> hands the clip to the browser&rsquo;s Picture-in-Picture window, which
            the composer can move and resize across monitors. Its play/pause controls act on the same element, so
            pressing them there drives this transport too.
          </p>
          <p>
            Where Picture-in-Picture is unavailable, the floating card bottom-right is the fallback and behaves
            identically — it is the same element and the same synchronizer.
          </p>
          <p>
            <strong>Picture at score start</strong> is the one number that matters: the media time that lines up with
            score time zero. <strong>Align to playhead</strong> derives it from wherever the picture currently sits.
          </p>
        </div>
      </div>
    </VideoSyncProvider>
  );
}

const meta: Meta = {
  title: "App/Video Sync",
  component: VideoSyncDemo,
  parameters: { layout: "fullscreen" },
};

export default meta;

/** Attach a clip, offset it, and drive it from a stub transport. */
export const Default: StoryObj = {
  render: () => <VideoSyncDemo />,
  name: "Video Reference",
};
