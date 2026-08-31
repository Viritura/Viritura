/**
 * MarkerPanel — the picture marker list.
 *
 * The timeline is where hits are placed; this is where they are named, nudged to
 * an exact frame, locked, and removed. Both edit the same persisted list, so a
 * spotting session survives reload and travels with the score.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, FormInput, IconButton, SectionLabel } from "@viritura/ui";
import { ChevronLeft, ChevronRight, Lock, LockOpen, Trash2 } from "lucide-react";
import {
  formatShortClockTime,
  frameForSeconds,
  frameRateById,
  secondsForFrame,
  useVideoSyncActions,
  useVideoSyncState,
  type FrameRateSpec,
} from "@viritura/video-sync";
import { usePlaybackActions } from "@viritura/playback";
import styles from "./MarkerPanel.module.css";

export interface MarkerPanelProps {
  readonly onAddMarkerAtPlayhead: () => void;
  readonly editMarkerRequest: { readonly id: string; readonly token: number } | null;
}

export function MarkerPanel({ onAddMarkerAtPlayhead, editMarkerRequest }: MarkerPanelProps) {
  const state = useVideoSyncState();
  const playbackActions = usePlaybackActions();
  const frameRate = frameRateById(state.frameRateId);

  const goTo = useCallback(
    (seconds: number) => playbackActions.seek(Math.max(0, seconds - state.pictureOffsetSeconds)),
    [playbackActions, state.pictureOffsetSeconds],
  );

  return (
    <div className={styles.panel}>
      <SectionLabel className={styles.sectionLabel} label="Markers" />

      <div className={styles.actions}>
        <Button
          variant="default"
          size="sm"
          label="Add marker"
          tooltip="Add marker at playhead (M)"
          onClick={onAddMarkerAtPlayhead}
        >
          <span>Add marker</span>
        </Button>
      </div>

      {state.hitPoints.length === 0 ? (
        <p className={styles.empty}>No markers yet.</p>
      ) : (
        <ul className={styles.list}>
          {state.hitPoints.map((hit) => (
            <HitRow
              key={hit.id}
              id={hit.id}
              seconds={hit.pictureSeconds}
              label={hit.label}
              locked={hit.locked !== false}
              onGoTo={goTo}
              editRequestToken={editMarkerRequest?.id === hit.id ? editMarkerRequest.token : null}
              frameRate={frameRate}
              durationSeconds={state.mediaDurationSeconds}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface HitRowProps {
  readonly id: string;
  readonly seconds: number;
  readonly label: string | undefined;
  readonly locked: boolean;
  readonly onGoTo: (seconds: number) => void;
  readonly editRequestToken: number | null;
  readonly frameRate: FrameRateSpec;
  readonly durationSeconds: number | null;
}

function HitRow({ id, seconds, label, locked, onGoTo, editRequestToken, frameRate, durationSeconds }: HitRowProps) {
  const actions = useVideoSyncActions();
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editRequestToken === null) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editRequestToken]);

  const commit = useCallback(() => {
    if (draft !== null) actions.labelHitPoint(id, draft);
    setDraft(null);
  }, [actions, draft, id]);

  const nudge = useCallback(
    (frames: number) => {
      const target = secondsForFrame(frameForSeconds(seconds, frameRate) + frames, frameRate);
      actions.moveHitPoint(id, Math.min(durationSeconds ?? Number.POSITIVE_INFINITY, Math.max(0, target)));
    },
    [actions, durationSeconds, frameRate, id, seconds],
  );

  return (
    <li className={styles.row}>
      <Button
        variant="ghost"
        size="sm"
        className={styles.time}
        tooltip="Go to this frame"
        onClick={() => onGoTo(seconds)}
      >
        {formatShortClockTime(seconds)}
      </Button>
      <FormInput
        ref={inputRef}
        className={styles.label}
        value={draft ?? label ?? ""}
        placeholder="what happens here"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setDraft(null);
        }}
        aria-label="Marker label"
      />
      <span className={styles.rowActions}>
        <IconButton size="sm" tooltip="Move marker back one frame" onClick={() => nudge(-1)}>
          <ChevronLeft size={12} />
        </IconButton>
        <IconButton size="sm" tooltip="Move marker forward one frame" onClick={() => nudge(1)}>
          <ChevronRight size={12} />
        </IconButton>
        <IconButton
          size="sm"
          active={locked}
          onClick={() => actions.setHitPointLocked(id, !locked)}
          tooltip={locked ? "Locked: the solver must land a downbeat here" : "Unlocked: the solver may ignore this"}
        >
          {locked ? <Lock size={12} /> : <LockOpen size={12} />}
        </IconButton>
        <IconButton size="sm" tooltip="Remove this marker" onClick={() => actions.removeHitPoint(id)}>
          <Trash2 size={12} />
        </IconButton>
      </span>
    </li>
  );
}
