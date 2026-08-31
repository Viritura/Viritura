/**
 * TimecodePanel — current picture position and the timebase used to read it.
 *
 * Four concepts live here, but they are deliberately not presented as four
 * competing controls:
 *
 * - The large SMPTE value is the current position. Click it to jump.
 * - The timebase says how seconds map to frame labels. It is a summary until
 *   the composer asks to change it or metadata needs confirmation.
 * - The origin says what media frame zero is called.
 * - Frame-step buttons move the transport by one picture frame.
 *
 * Frame stepping goes through the transport rather than touching the video
 * element. The transport is the master clock; nudging the element directly
 * would leave the score playhead behind and the synchronizer would pull the
 * picture straight back.
 */

import { useCallback, useRef, useState, type RefObject } from "react";
import { Badge, Button, FormInput, SectionLabel, Select } from "@viritura/ui";
import { ChevronFirst, ChevronLast, CornerDownLeft, X } from "lucide-react";
import { usePlaybackActions, usePlaybackState } from "@viritura/playback";
import {
  FRAME_RATES,
  formatTimecode,
  frameDuration,
  frameForSeconds,
  frameRateById,
  parseFrameTimecode,
  parseTimecodeSeconds,
  secondsForFrame,
  useVideoSyncActions,
  useVideoSyncState,
  type FrameRateSpec,
  type VideoSyncState,
} from "@viritura/video-sync";
import {
  ORIGIN_FIELDS,
  originFieldsFromFrame,
  originPreset,
  originSecondsFromFields,
  sanitizeOriginField,
  stepOriginField,
  type OriginField,
  type OriginFieldValues,
} from "./timecodeOrigin";
import styles from "./TimecodePanel.module.css";

const FRAME_RATE_OPTIONS = FRAME_RATES.map((rate) => ({
  value: rate.id,
  label: rate.label,
}));
type OpenEditor = "position" | "timebase" | "origin" | null;

export interface TimecodePanelProps {
  readonly placement?: "panel" | "toolbar";
}

export function TimecodePanel({ placement = "panel" }: TimecodePanelProps) {
  const state = useVideoSyncState();
  const playback = usePlaybackState();
  const playbackActions = usePlaybackActions();
  const [openEditor, setOpenEditor] = useState<OpenEditor>(null);

  const rate = frameRateById(state.frameRateId);
  const scoreSeconds = playback.playheadPosition?.timeSeconds ?? 0;
  const pictureSeconds = scoreSeconds + state.pictureOffsetSeconds;
  const startFrames = Math.round(state.startTimecodeSeconds / frameDuration(rate));

  const step = useCallback(
    (frames: number) => {
      // A scrub can leave the playhead between frames. Snap first so repeated
      // stepping does not preserve that sub-frame remainder forever.
      const stepRate = frameRateById(state.frameRateId);
      const target = secondsForFrame(frameForSeconds(pictureSeconds, stepRate) + frames, stepRate);
      playbackActions.seek(Math.max(0, target - state.pictureOffsetSeconds));
    },
    [pictureSeconds, state.frameRateId, playbackActions, state.pictureOffsetSeconds],
  );

  const jumpToTimecode = useCallback(
    (seconds: number) => {
      playbackActions.seek(Math.max(0, seconds - startFrames * frameDuration(rate) - state.pictureOffsetSeconds));
    },
    [playbackActions, rate, startFrames, state.pictureOffsetSeconds],
  );

  return (
    <div className={placement === "toolbar" ? styles.toolbar : styles.panel} data-editing={openEditor === "position"}>
      {placement === "panel" && <SectionLabel className={styles.sectionLabel} label="Timecode" />}

      <CurrentPosition
        pictureSeconds={pictureSeconds}
        rate={rate}
        startFrames={startFrames}
        onJump={jumpToTimecode}
        onStep={step}
        editing={openEditor === "position"}
        onEditingChange={(editing) => setOpenEditor(editing ? "position" : null)}
      />
    </div>
  );
}

export interface PictureTimingSettingsProps {
  readonly onEditingChange?: (editing: boolean) => void;
}

/** Clip-specific timing controls, shown only while setting up the picture. */
export function PictureTimingSettings({ onEditingChange }: PictureTimingSettingsProps) {
  const state = useVideoSyncState();
  const actions = useVideoSyncActions();
  const [openEditor, setOpenEditor] = useState<Exclude<OpenEditor, "position">>(null);
  const rate = frameRateById(state.frameRateId);
  const startFrames = Math.round(state.startTimecodeSeconds / frameDuration(rate));
  const changeEditor = (editor: Exclude<OpenEditor, "position">) => {
    setOpenEditor(editor);
    onEditingChange?.(editor !== null);
  };

  return (
    <div className={styles.timingSettings}>
      <PictureTimebase
        state={state}
        selectedRate={rate}
        editing={openEditor === "timebase"}
        onEditingChange={(editing) => changeEditor(editing ? "timebase" : null)}
      />
      <TimecodeOrigin
        state={state}
        rate={rate}
        startFrames={startFrames}
        onChange={actions.setStartTimecode}
        editing={openEditor === "origin"}
        onEditingChange={(editing) => changeEditor(editing ? "origin" : null)}
      />
    </div>
  );
}

interface CurrentPositionProps {
  readonly pictureSeconds: number;
  readonly rate: FrameRateSpec;
  readonly startFrames: number;
  readonly onJump: (seconds: number) => void;
  readonly onStep: (frames: number) => void;
  readonly editing: boolean;
  readonly onEditingChange: (editing: boolean) => void;
}

function CurrentPosition({
  pictureSeconds,
  rate,
  startFrames,
  onJump,
  onStep,
  editing,
  onEditingChange,
}: CurrentPositionProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const display = formatTimecode(pictureSeconds, rate, startFrames);
  const close = () => {
    onEditingChange(false);
    restoreFocus(triggerRef);
  };

  return (
    <div className={styles.readout}>
      {editing ? (
        <InlineTimecodeEditor
          key={`${rate.id}:${startFrames}`}
          initialValue={display}
          rate={rate}
          actionLabel="Jump to timecode"
          onCommit={(seconds) => {
            onJump(seconds);
            close();
          }}
          onCancel={close}
        />
      ) : (
        <Button
          ref={triggerRef}
          variant="ghost"
          size="sm"
          className={styles.timecodeButton}
          tooltip="Go to timecode"
          onClick={() => onEditingChange(true)}
        >
          {display}
        </Button>
      )}
      <div className={styles.stepper}>
        <Button variant="ghost" size="sm" shape="icon" tooltip="Back one frame" onClick={() => onStep(-1)}>
          <ChevronFirst size={14} />
        </Button>
        <Button variant="ghost" size="sm" shape="icon" tooltip="Forward one frame" onClick={() => onStep(1)}>
          <ChevronLast size={14} />
        </Button>
      </div>
    </div>
  );
}

function PictureTimebase({
  state,
  selectedRate,
  editing,
  onEditingChange,
}: {
  readonly state: VideoSyncState;
  readonly selectedRate: FrameRateSpec;
  readonly editing: boolean;
  readonly onEditingChange: (editing: boolean) => void;
}) {
  const actions = useVideoSyncActions();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const metadata = state.mediaMetadata;
  const detected = metadata?.frameRate;
  const selectedMatches = detected ? matchesDetectedRate(selectedRate, state) : false;
  const numberingUnknown =
    !!detected && detected.suggestedFrameRateId === null && isNtscRate(detected.numerator, detected.denominator);
  const confirmedDetected =
    !!detected &&
    selectedMatches &&
    !numberingUnknown &&
    detected.confidence === "high" &&
    detected.mode === "constant";
  const sourceLabel = sourceLabelFor(state.frameRateSource, confirmedDetected);
  const close = () => {
    onEditingChange(false);
    restoreFocus(triggerRef);
  };

  return (
    <div className={styles.settingGroup}>
      <div className={styles.settingHeader}>
        <span className={styles.settingLabel}>Picture timebase</span>
        <Button
          ref={triggerRef}
          variant="link"
          size="sm"
          label={editing ? "Done" : "Change"}
          onClick={() => (editing ? close() : onEditingChange(true))}
        />
      </div>

      {editing ? (
        <Select
          value={selectedRate.id}
          options={FRAME_RATE_OPTIONS}
          onValueChange={(id) => {
            actions.setFrameRate(id);
            close();
          }}
          aria-label="Picture timebase"
        />
      ) : (
        <div className={styles.settingValueRow}>
          <span className={styles.settingValue}>{timebaseLabel(selectedRate)}</span>
          <Badge variant={sourceLabel === "Detected" ? "success" : "muted"}>{sourceLabel}</Badge>
        </div>
      )}

      <TimebaseEvidence
        state={state}
        selectedRate={selectedRate}
        selectedMatches={selectedMatches}
        numberingUnknown={numberingUnknown}
      />
    </div>
  );
}

function TimebaseEvidence({
  state,
  selectedRate,
  selectedMatches,
  numberingUnknown,
}: {
  readonly state: VideoSyncState;
  readonly selectedRate: FrameRateSpec;
  readonly selectedMatches: boolean;
  readonly numberingUnknown: boolean;
}) {
  const actions = useVideoSyncActions();
  const metadata = state.mediaMetadata;
  const detected = metadata?.frameRate;

  if (state.mediaMetadataStatus === "loading") {
    return <p className={styles.metadata}>Reading file metadata…</p>;
  }
  if (state.mediaMetadataStatus === "error") {
    return (
      <p className={styles.metadataWarning}>
        Metadata could not be read. Confirm the timebase from the delivery specification.
      </p>
    );
  }
  if (!detected) {
    return state.attachment === "empty" ? null : (
      <p className={styles.metadata}>No usable frame rate was found in the file.</p>
    );
  }
  if (detected.mode === "variable") {
    const range =
      detected.minimumFps !== null && detected.maximumFps !== null
        ? ` ${detected.minimumFps.toFixed(3)}–${detected.maximumFps.toFixed(3)} fps.`
        : "";
    return (
      <p className={styles.metadataWarning}>
        Variable frame rate detected.{range} Frame-accurate spotting requires a constant-rate reference.
      </p>
    );
  }
  const cadenceWarning =
    detected.mode === "unknown" ? (
      <p className={styles.metadataWarning}>
        File metadata does not confirm whether the cadence is constant. Confirm the delivery before frame-accurate
        spotting.
      </p>
    ) : null;

  const container = metadata.container ?? "File metadata";
  const exact = `${detected.numerator}/${detected.denominator}`;
  const suggestedId = detected.suggestedFrameRateId;

  if (numberingUnknown) {
    const nonDropId = detected.numerator === 60000 ? "59.94" : "29.97";
    const dropId = detected.numerator === 60000 ? "59.94df" : "29.97df";
    return (
      <>
        {cadenceWarning}
        <p className={styles.metadataWarning}>
          {container} reports {detected.fps.toFixed(3)} fps ({exact}) but does not declare DF/NDF.
        </p>
        <div className={styles.numberingChoice}>
          <Button
            variant="default"
            size="sm"
            active={selectedRate.id === nonDropId}
            label="Non-drop"
            onClick={() => actions.setFrameRate(nonDropId)}
          />
          <Button
            variant="default"
            size="sm"
            active={selectedRate.id === dropId}
            label="Drop-frame"
            onClick={() => actions.setFrameRate(dropId)}
          />
        </div>
      </>
    );
  }

  if (!selectedMatches) {
    return (
      <>
        {cadenceWarning}
        <div className={styles.mismatch}>
          <p className={styles.metadataWarning}>
            File reports {detected.fps.toFixed(3)} fps ({exact}).
          </p>
          {suggestedId && detected.mode === "constant" && (
            <Button variant="link" size="sm" label="Use detected" onClick={() => actions.setFrameRate(suggestedId)} />
          )}
        </div>
      </>
    );
  }

  if (cadenceWarning) return cadenceWarning;

  return (
    <p className={styles.metadata}>
      {container} · Constant frame rate · {exact}
    </p>
  );
}

function TimecodeOrigin({
  state,
  rate,
  startFrames,
  onChange,
  editing,
  onEditingChange,
}: {
  readonly state: VideoSyncState;
  readonly rate: FrameRateSpec;
  readonly startFrames: number;
  readonly onChange: (seconds: number) => void;
  readonly editing: boolean;
  readonly onEditingChange: (editing: boolean) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const display = formatTimecode(0, rate, startFrames);
  const detectedFirstFrame = state.mediaMetadata?.timecode.firstFrame;
  const detectedFrame = detectedFirstFrame ? parseFrameTimecode(detectedFirstFrame, rate) : null;
  const isDetected =
    detectedFrame !== null &&
    detectedFrame === startFrames &&
    (state.mediaMetadata?.timecode.dropFrame === null || state.mediaMetadata?.timecode.dropFrame === rate.dropFrame);
  const sourceLabel = sourceLabelFor(state.timecodeOriginSource, isDetected);
  const close = () => {
    onEditingChange(false);
    restoreFocus(triggerRef);
  };

  return (
    <div className={styles.settingGroup}>
      <div className={styles.settingHeader}>
        <span className={styles.settingLabel}>Timecode origin</span>
        <Button
          ref={triggerRef}
          variant="link"
          size="sm"
          label={editing ? "Cancel" : "Change"}
          onClick={() => (editing ? close() : onEditingChange(true))}
        />
      </div>
      {editing ? (
        <SegmentedOriginEditor
          key={`${rate.id}:${startFrames}`}
          initialFrame={startFrames}
          rate={rate}
          onCommit={(seconds) => {
            onChange(seconds);
            close();
          }}
          onCancel={close}
        />
      ) : (
        <div className={styles.settingValueRow}>
          <span className={styles.originValue}>{display}</span>
          <Badge variant={sourceLabel === "Detected" ? "success" : "muted"}>{sourceLabel}</Badge>
        </div>
      )}
      {!isDetected && detectedFirstFrame && <p className={styles.metadata}>File reports {detectedFirstFrame}.</p>}
    </div>
  );
}

interface SegmentedOriginEditorProps {
  readonly initialFrame: number;
  readonly rate: FrameRateSpec;
  readonly onCommit: (seconds: number) => void;
  readonly onCancel: () => void;
}

function SegmentedOriginEditor({ initialFrame, rate, onCommit, onCancel }: SegmentedOriginEditorProps) {
  const [fields, setFields] = useState<OriginFieldValues>(() => originFieldsFromFrame(initialFrame, rate));
  const [invalid, setInvalid] = useState(false);
  const refs = useRef<Record<OriginField, HTMLInputElement | null>>({
    hours: null,
    minutes: null,
    seconds: null,
    frames: null,
  });

  const submit = useCallback(() => {
    const seconds = originSecondsFromFields(fields, rate);
    if (seconds === null) {
      setInvalid(true);
      return;
    }
    onCommit(seconds);
  }, [fields, rate, onCommit]);

  const update = (field: OriginField, value: string) => {
    const sanitized = sanitizeOriginField(value);
    setFields((current) => ({ ...current, [field]: sanitized }));
    setInvalid(false);
    if (sanitized.length === 2) {
      const next = ORIGIN_FIELDS[ORIGIN_FIELDS.indexOf(field) + 1];
      if (next) {
        setTimeout(() => {
          refs.current[next]?.focus();
          refs.current[next]?.select();
        }, 0);
      }
    }
  };

  const segment = (field: OriginField, label: string, autoFocus = false) => (
    <FormInput
      ref={(element) => {
        refs.current[field] = element;
      }}
      autoFocus={autoFocus}
      className={styles.originSegment}
      value={fields[field]}
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={2}
      aria-label={label}
      aria-invalid={invalid}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => update(field, event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") submit();
        if (event.key === "Escape") onCancel();
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          setFields((current) => stepOriginField(current, field, event.key === "ArrowUp" ? 1 : -1, rate));
          setInvalid(false);
        }
      }}
    />
  );

  return (
    <div className={styles.originEditor}>
      <div className={styles.segmentedTimecode} role="group" aria-label="Timecode origin">
        {segment("hours", "Origin hours", true)}
        <span aria-hidden="true">:</span>
        {segment("minutes", "Origin minutes")}
        <span aria-hidden="true">:</span>
        {segment("seconds", "Origin seconds")}
        <span aria-hidden="true">{rate.dropFrame ? ";" : ":"}</span>
        {segment("frames", "Origin frames")}
        <Button variant="ghost" size="sm" shape="icon" tooltip="Set timecode origin" onClick={submit}>
          <CornerDownLeft size={13} />
        </Button>
        <Button variant="ghost" size="sm" shape="icon" tooltip="Cancel" onClick={onCancel}>
          <X size={13} />
        </Button>
      </div>
      <div className={styles.originPresets}>
        <span className={styles.presetLabel}>Common starts</span>
        {[0, 1, 10].map((hours) => (
          <Button
            key={hours}
            variant="ghost"
            size="sm"
            label={`${String(hours).padStart(2, "0")}:00`}
            onClick={() => {
              setFields(originPreset(hours));
              setInvalid(false);
            }}
          />
        ))}
      </div>
      {invalid && (
        <p className={styles.metadataWarning} role="alert">
          Enter a valid SMPTE label for this timebase.
        </p>
      )}
    </div>
  );
}

interface InlineTimecodeEditorProps {
  readonly initialValue: string;
  readonly rate: FrameRateSpec;
  readonly actionLabel: string;
  readonly onCommit: (seconds: number) => void;
  readonly onCancel: () => void;
}

function InlineTimecodeEditor({ initialValue, rate, actionLabel, onCommit, onCancel }: InlineTimecodeEditorProps) {
  const [text, setText] = useState(initialValue);
  const [invalid, setInvalid] = useState(false);

  const submit = useCallback(() => {
    const seconds = parseTimecodeSeconds(text, rate);
    if (seconds === null) {
      setInvalid(true);
      return;
    }
    onCommit(seconds);
  }, [text, rate, onCommit]);

  return (
    <div className={styles.inlineEditor}>
      <FormInput
        autoFocus
        value={text}
        aria-label={actionLabel}
        aria-invalid={invalid}
        onChange={(event) => {
          setText(event.currentTarget.value);
          setInvalid(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
          if (event.key === "Escape") onCancel();
        }}
      />
      <Button variant="ghost" size="sm" shape="icon" tooltip={actionLabel} onClick={submit}>
        <CornerDownLeft size={13} />
      </Button>
      <Button variant="ghost" size="sm" shape="icon" tooltip="Cancel" onClick={onCancel}>
        <X size={13} />
      </Button>
    </div>
  );
}

function matchesDetectedRate(selectedRate: FrameRateSpec, state: VideoSyncState): boolean {
  const detected = state.mediaMetadata?.frameRate;
  if (!detected) return false;
  return (
    selectedRate.numerator === detected.numerator &&
    selectedRate.denominator === detected.denominator &&
    (state.mediaMetadata?.timecode.dropFrame === null ||
      selectedRate.dropFrame === state.mediaMetadata?.timecode.dropFrame)
  );
}

function isNtscRate(numerator: number, denominator: number): boolean {
  return denominator === 1001 && (numerator === 30000 || numerator === 60000);
}

function timebaseLabel(rate: FrameRateSpec): string {
  const fps =
    rate.denominator === 1001
      ? (rate.numerator / rate.denominator).toFixed(3)
      : String(rate.numerator / rate.denominator);
  if (rate.numerator === 30000 || rate.numerator === 60000) {
    return `${fps} fps · ${rate.dropFrame ? "Drop-frame" : "Non-drop"}`;
  }
  return `${fps} fps`;
}

function sourceLabelFor(
  source: VideoSyncState["frameRateSource"],
  confirmedDetected: boolean,
): "Default" | "Detected" | "Selected" {
  if (confirmedDetected) return "Detected";
  if (source === "default") return "Default";
  return "Selected";
}

function restoreFocus(ref: RefObject<HTMLButtonElement | null>): void {
  // The editor can be in a background tab while picture is in Document PiP;
  // requestAnimationFrame may be suspended there, while a zero-delay task still
  // restores keyboard focus when the trigger remounts.
  setTimeout(() => ref.current?.focus(), 0);
}
