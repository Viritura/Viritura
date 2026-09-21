/**
 * TransportBar — compact playback transport controls.
 *
 * Contains: PlayPauseButton, StopButton, MetronomeToggle, and TimeDisplay.
 * Shared between editor and play modes.
 *
 * Wired to PlaybackContext for state.
 */

import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import {
  Play as PlayIcon,
  Pause,
  Square,
  Loader2,
  Metronome,
  ArrowRightToLine,
  SkipBack,
  ListMusic,
} from "lucide-react";
import { Badge, Tooltip } from "@viritura/ui";
import { usePlaybackActions, usePlaybackState } from "./usePlayback";
import { useFollowEnabled, useFollowActions } from "./followStore";
import { useTransportVisibilityPreferences } from "./transportSettingsStore";
import type { PlayheadPosition } from "./playbackReducer";
import { selectionPlaybackStatus } from "./selectionPlaybackStatus";

// ═══════════════════════════════════════════
// TransportBar (container)
// ═══════════════════════════════════════════

export interface TransportBarProps {
  /** Per-view override; otherwise the persisted transport preference is used. */
  readonly showTimeDisplay?: boolean;
  /** Per-view override; otherwise the persisted transport preference is used. */
  readonly showFollow?: boolean;
  /** Per-view override; otherwise the persisted transport preference is used. */
  readonly showMetronome?: boolean;
  readonly compact?: boolean;
}

export function TransportBar({
  showTimeDisplay: showTimeDisplayOverride,
  showFollow: showFollowOverride,
  showMetronome: showMetronomeOverride,
  compact = false,
}: TransportBarProps = {}) {
  const preferences = useTransportVisibilityPreferences();
  const showTimeDisplay = showTimeDisplayOverride ?? preferences.showTimeDisplay;
  const showFollow = showFollowOverride ?? preferences.showFollow;
  const showMetronome = showMetronomeOverride ?? preferences.showMetronome;

  return (
    <div style={compact ? compactBarStyle : barStyle}>
      <div style={groupStyle}>
        <BackToStartButton />
        <PlayPauseButton />
        <StopButton />
      </div>
      <SelectionPlaybackBadge />
      {showTimeDisplay && <TimeDisplay />}
      {showFollow && <FollowToggle />}
      {showMetronome && <MetronomeToggle />}
    </div>
  );
}

// ═══════════════════════════════════════════
// SelectionPlaybackBadge
// ═══════════════════════════════════════════

function SelectionPlaybackBadge() {
  const { selectionStaffCount } = usePlaybackState();
  const status = selectionPlaybackStatus(selectionStaffCount);
  const initialStaffCountRef = useRef(selectionStaffCount);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (selectionStaffCount === initialStaffCountRef.current) return;
    initialStaffCountRef.current = selectionStaffCount;
    setAnnouncement(
      selectionPlaybackStatus(selectionStaffCount)?.accessibleDescription ?? "Playback filtering cleared.",
    );
  }, [selectionStaffCount]);

  return (
    <>
      {status && (
        <span aria-label={status.accessibleDescription}>
          <Badge variant="accent" testId="selection-playback-badge">
            <ListMusic size={14} strokeWidth={1.75} aria-hidden="true" />
            <span style={selectionBadgeTextStyle}>{status.badgeText}</span>
          </Badge>
        </span>
      )}
      <span aria-live="polite" style={screenReaderOnlyStyle}>
        {announcement}
      </span>
    </>
  );
}

// ═══════════════════════════════════════════
// BackToStartButton
// ═══════════════════════════════════════════

function BackToStartButton() {
  const { status } = usePlaybackState();
  const { seek } = usePlaybackActions();

  return (
    <Tooltip content="Back to start">
      <button
        style={stopButtonStyle(status === "playing" || status === "paused")}
        onClick={() => seek(0)}
        disabled={status === "loading"}
        aria-label="Back to start"
      >
        <SkipBack size={16} />
      </button>
    </Tooltip>
  );
}

// ═══════════════════════════════════════════
// PlayPauseButton
// ═══════════════════════════════════════════

function PlayPauseButton() {
  const { status } = usePlaybackState();
  const { play, pause } = usePlaybackActions();

  const handleClick = useCallback(() => {
    if (status === "playing") {
      pause();
    } else {
      play();
    }
  }, [status, play, pause]);

  const isLoading = status === "loading";

  return (
    <Tooltip content={status === "playing" ? "Pause (Space)" : "Play (Space)"}>
      <button
        style={playButtonStyle()}
        onClick={handleClick}
        disabled={isLoading}
        aria-label={status === "playing" ? "Pause" : "Play"}
      >
        {isLoading ? (
          <Loader2 size={20} style={SPIN_ICON_STYLE} />
        ) : status === "playing" ? (
          <Pause size={20} />
        ) : (
          <PlayIcon size={20} />
        )}
      </button>
    </Tooltip>
  );
}

// ═══════════════════════════════════════════
// StopButton
// ═══════════════════════════════════════════

function StopButton() {
  const { status } = usePlaybackState();
  const { stop } = usePlaybackActions();

  const isActive = status === "playing" || status === "paused";
  const isLoading = status === "loading";

  return (
    <Tooltip content="Stop (Escape)">
      <button style={stopButtonStyle(isActive)} onClick={stop} disabled={!isActive || isLoading} aria-label="Stop">
        <Square size={16} />
      </button>
    </Tooltip>
  );
}

// ═══════════════════════════════════════════
// MetronomeToggle
// ═══════════════════════════════════════════

function MetronomeToggle() {
  const { metronomeEnabled } = usePlaybackState();
  const { toggleMetronome } = usePlaybackActions();

  return (
    <Tooltip content={`Metronome ${metronomeEnabled ? "On" : "Off"} (Ctrl+M)`}>
      <button
        style={metronomeButtonStyle(metronomeEnabled)}
        onClick={toggleMetronome}
        aria-label={`Metronome ${metronomeEnabled ? "on" : "off"}`}
        aria-pressed={metronomeEnabled}
      >
        {/* Metronome icon (lucide) */}
        <Metronome size={14} strokeWidth={1.5} />
      </button>
    </Tooltip>
  );
}

// ═══════════════════════════════════════════
// FollowToggle
// ═══════════════════════════════════════════

function FollowToggle() {
  const enabled = useFollowEnabled();
  const { toggle } = useFollowActions();

  return (
    <Tooltip content={`Follow playhead ${enabled ? "On" : "Off"}`}>
      <button
        style={metronomeButtonStyle(enabled)}
        onClick={toggle}
        aria-label={`Follow playhead ${enabled ? "on" : "off"}`}
        aria-pressed={enabled}
      >
        <ArrowRightToLine size={14} strokeWidth={1.5} />
      </button>
    </Tooltip>
  );
}

// ═══════════════════════════════════════════
// TimeDisplay
// ═══════════════════════════════════════════

type TimeDisplayMode = "time" | "measure";

const TIME_DISPLAY_MODE_KEY = "viritura.transport.timeDisplayMode";

function loadTimeDisplayMode(): TimeDisplayMode {
  if (typeof localStorage === "undefined") return "time";
  return localStorage.getItem(TIME_DISPLAY_MODE_KEY) === "measure" ? "measure" : "time";
}

function TimeDisplay() {
  const { playheadPosition, duration } = usePlaybackState();
  const [mode, setMode] = useState<TimeDisplayMode>(loadTimeDisplayMode);

  const toggleMode = useCallback(() => {
    setMode((prev) => {
      const next: TimeDisplayMode = prev === "time" ? "measure" : "time";
      if (typeof localStorage !== "undefined") localStorage.setItem(TIME_DISPLAY_MODE_KEY, next);
      return next;
    });
  }, []);

  const tooltip = mode === "time" ? "Showing time — click for measure:beat" : "Showing measure:beat — click for time";

  return (
    <Tooltip content={tooltip}>
      <button type="button" style={timeContainerStyle} onClick={toggleMode} aria-label={tooltip}>
        {mode === "time" ? (
          <>
            <span style={timeCurrentStyle}>{formatTime(playheadPosition?.timeSeconds ?? 0)}</span>
            <span style={timeSepStyle}>/</span>
            <span style={timeTotalStyle}>{formatTime(duration)}</span>
          </>
        ) : (
          <span style={timeCurrentStyle}>{formatMeasureBeat(playheadPosition)}</span>
        )}
      </button>
    </Tooltip>
  );
}

function formatTime(seconds: number): string {
  // Guard against a slightly-negative clock (lead-in / humanized early
  // onsets) so the readout never shows "-1:-1".
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Format the playhead as 1-based `measure:beat` (e.g. "5:3"). */
function formatMeasureBeat(position: PlayheadPosition | null): string {
  if (!position) return "1:1";
  const measure = position.measureIndex + 1;
  const beat = Math.floor(position.beat) + 1;
  return `${measure}:${beat}`;
}

// ═══════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════

const barStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 12px",
  height: "100%",
  marginLeft: "auto",
  flexShrink: 0,
};

const compactBarStyle: CSSProperties = {
  ...barStyle,
  gap: 4,
  padding: "0 2px",
};

const groupStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
};

const selectionBadgeTextStyle: CSSProperties = {
  marginLeft: 4,
};

const screenReaderOnlyStyle: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

const transportBtnStyle: CSSProperties = {
  width: 36,
  height: 36,
  border: "none",
  borderRadius: 8,
  background: "var(--surface-raised)",
  boxShadow: "var(--elevation-0)",
  color: "var(--text)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "box-shadow 0.15s, opacity 0.15s",
};

const transportBtnSmStyle: CSSProperties = {
  width: 30,
  height: 30,
  border: "none",
  borderRadius: 6,
  background: "var(--surface-raised)",
  boxShadow: "var(--elevation-0)",
  color: "var(--text-muted)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "box-shadow 0.15s, color 0.15s, background 0.15s",
};

// Time display styles
const timeContainerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 10px",
  border: "none",
  borderRadius: 6,
  background: "var(--surface-raised)",
  boxShadow: "var(--inset-soft)",
  fontFamily: "monospace",
  fontSize: "0.85rem",
  userSelect: "none",
  cursor: "pointer",
};

const timeCurrentStyle: CSSProperties = {
  color: "var(--text)",
  fontWeight: 600,
  minWidth: 32,
  textAlign: "right",
};

const timeSepStyle: CSSProperties = {
  color: "var(--text-muted)",
};

const timeTotalStyle: CSSProperties = {
  color: "var(--text-muted)",
  minWidth: 32,
};

const SPIN_ICON_STYLE: CSSProperties = { animation: "spin 1s linear infinite" };
function playButtonStyle(): CSSProperties {
  return {
    ...transportBtnStyle,
    background: "var(--accent)",
    color: "#fff",
    boxShadow: "var(--elevation-1)",
  };
}
function stopButtonStyle(isActive: boolean): CSSProperties {
  return { ...transportBtnStyle, opacity: isActive ? 1 : 0.5 };
}
function metronomeButtonStyle(enabled: boolean): CSSProperties {
  return enabled
    ? { ...transportBtnSmStyle, background: "var(--accent)", color: "#fff", boxShadow: "var(--inset-soft)" }
    : transportBtnSmStyle;
}
