/**
 * VideoPanel — controls for the attached picture.
 *
 * Deliberately small. Transport lives in the transport bar and the picture
 * itself lives in the browser's Picture-in-Picture window, so this panel only
 * owns what neither of those can express: which file is attached, where it sits
 * relative to score time, whether its production audio is audible, and the
 * escape hatches (re-sync, relink, remove).
 */

import { useCallback, useState } from "react";
import { Button, Collapsible, SectionLabel, SettingsRow, Switch, Tooltip } from "@viritura/ui";
import { AlertTriangle, PictureInPicture2, RefreshCw, Crosshair } from "lucide-react";
import { DEMO_VIDEO_SOURCES } from "./demoSources";
import { VIDEO_FILE_ACCEPT } from "./mediaBinding";
import { formatClockTime, parseClockTime } from "./timecode";
import { useVideoSyncActions, useVideoSyncState } from "./videoSyncStore";
import styles from "./VideoPanel.module.css";

export interface VideoPanelProps {
  /** Opens the host application's clip attachment and timing dialog. */
  readonly onConfigure?: () => void;
}

export function VideoPanel({ onConfigure }: VideoPanelProps) {
  const state = useVideoSyncState();
  const actions = useVideoSyncActions();

  const handleFile = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      // Clear the input so re-picking the same file still fires a change event
      // (the relink case: same name, possibly a new cut).
      event.currentTarget.value = "";
      if (file) void actions.attachFile(file);
    },
    [actions],
  );

  const hasMedia = state.attachment === "ready" || state.attachment === "loading";

  return (
    <div className={styles.panel}>
      <SectionLabel className={styles.sectionLabel} label="Video" />

      <StatusLine />

      <div className={styles.actions}>
        {hasMedia && <PictureWindowButton />}
        {onConfigure ? (
          <Button
            variant="default"
            size="sm"
            label={state.mediaName ? "Video settings…" : "Choose video…"}
            onClick={onConfigure}
          />
        ) : (
          <label className={styles.fileButton}>
            <input type="file" accept={VIDEO_FILE_ACCEPT} className={styles.fileInput} onChange={handleFile} />
            <span>{state.mediaName ? "Relink…" : "Attach video…"}</span>
          </label>
        )}

        {!onConfigure &&
          !state.mediaName &&
          DEMO_VIDEO_SOURCES.map((source) => (
            <Button
              key={source.id}
              variant="ghost"
              size="sm"
              label="Try demo clip"
              tooltip={`${source.title} — ${source.description}`}
              onClick={() => void actions.attachDemo(source)}
            />
          ))}

        {hasMedia && (
          <Button
            variant="ghost"
            size="sm"
            label="Remove"
            tooltip="Detach the picture from this score"
            onClick={actions.removeMedia}
          />
        )}
      </div>

      {hasMedia && <SyncControls />}
    </div>
  );
}

function StatusLine() {
  const { attachment, health, mediaName, errorMessage, identityMismatch, downloadProgress } = useVideoSyncState();

  return (
    <div className={styles.status}>
      <span className={styles.mediaName}>{mediaName ?? "No picture attached"}</span>
      {attachment === "loading" && downloadProgress !== null && (
        <span className={styles.health}>Downloading picture… {Math.round(downloadProgress * 100)}%</span>
      )}
      {attachment === "offline" && (
        <span className={styles.warning}>
          <AlertTriangle size={12} /> Offline on this device — relink to continue
        </span>
      )}
      {identityMismatch && (
        <span className={styles.warning}>
          <AlertTriangle size={12} /> This looks like a different cut; sync points may have moved
        </span>
      )}
      {errorMessage && <span className={styles.error}>{errorMessage}</span>}
      {attachment === "ready" && <span className={styles.health}>{HEALTH_LABEL[health]}</span>}
    </div>
  );
}

const HEALTH_LABEL: Record<string, string> = {
  locked: "In sync",
  correcting: "Re-syncing…",
  buffering: "Buffering…",
  idle: "Ready",
};

function PictureWindowButton() {
  const state = useVideoSyncState();
  const actions = useVideoSyncActions();

  return (
    <Tooltip content="Pop the picture out into its own always-on-top window, with streamers over it">
      <span>
        <Button
          variant={state.pictureWindowOpen ? "primary" : "default"}
          size="sm"
          label={state.pictureWindowOpen ? "Close picture" : "Open picture"}
          onClick={actions.togglePictureWindow}
        >
          <PictureInPicture2 size={14} />
          <span>{state.pictureWindowOpen ? "Close picture" : "Open picture"}</span>
        </Button>
      </span>
    </Tooltip>
  );
}

function SyncControls() {
  const state = useVideoSyncState();
  const actions = useVideoSyncActions();

  return (
    <Collapsible title="Sync controls" className={styles.advanced}>
      <div className={styles.controls}>
        <SettingsRow label="Streamers" description="Sweep and punch on marker frames.">
          <Switch
            checked={state.showStreamers}
            onCheckedChange={actions.setShowStreamers}
            aria-label="Show streamers and punches"
          />
        </SettingsRow>

        <OffsetField />

        <div className={styles.row}>
          <Switch
            size="sm"
            checked={state.pictureAudioEnabled}
            onCheckedChange={actions.setPictureAudioEnabled}
            label="Picture audio"
          />
        </div>

        <div className={styles.row}>
          <Button
            variant="ghost"
            size="sm"
            label="Align"
            tooltip="Set the offset so the frame shown now lands on the current playhead position"
            onClick={actions.alignToPlayhead}
          >
            <Crosshair size={14} />
            <span>Align</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            label="Re-sync"
            tooltip="Re-anchor the picture to the playhead"
            onClick={actions.resync}
          >
            <RefreshCw size={14} />
            <span>Re-sync</span>
          </Button>
        </div>
      </div>
    </Collapsible>
  );
}

/**
 * Offset entry.
 *
 * Held as local text while editing so a half-typed value ("00:0") never reaches
 * the score, and rejected outright when unparseable — silently falling back to
 * zero would put every cue at the wrong frame.
 */
function OffsetField() {
  const { pictureOffsetSeconds } = useVideoSyncState();
  const { setPictureOffset } = useVideoSyncActions();
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  const commit = useCallback(() => {
    if (draft === null) return;
    const parsed = parseClockTime(draft);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft(null);
    setPictureOffset(parsed);
  }, [draft, setPictureOffset]);

  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>Picture at score start</span>
      <input
        className={invalid ? styles.inputInvalid : styles.input}
        value={draft ?? formatClockTime(pictureOffsetSeconds)}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            setDraft(null);
            setInvalid(false);
          }
        }}
        aria-invalid={invalid}
        aria-label="Media time at score start"
        spellCheck={false}
      />
    </label>
  );
}
