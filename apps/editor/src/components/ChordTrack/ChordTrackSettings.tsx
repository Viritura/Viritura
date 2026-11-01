import { Select, SettingsRow, Switch } from "@viritura/ui";
import { useViewStateStore } from "../../store/viewStateStore";
import styles from "./ChordTrack.module.css";

const GRID_OPTIONS = [
  { value: "quarter", label: "Quarter" },
  { value: "eighth", label: "Eighths" },
  { value: "sixteenth", label: "Sixteenths" },
];
const POSITION_OPTIONS = [
  { value: "above", label: "Above music" },
  { value: "below", label: "Below music" },
];

interface ChordTrackSettingsProps {
  panelId?: string;
  grid: "quarter" | "eighth" | "sixteenth";
  onGridChange: (grid: "quarter" | "eighth" | "sixteenth") => void;
  audition?: boolean;
  onAuditionChange?: (enabled: boolean) => void;
  sticky: boolean;
  onStickyChange?: (enabled: boolean) => void;
  position: "above" | "below";
  onPositionChange?: (position: "above" | "below") => void;
}

export function ChordTrackSettings({
  panelId = "chord-settings-panel",
  grid,
  onGridChange,
  audition = false,
  onAuditionChange,
  sticky,
  onStickyChange,
  position,
  onPositionChange,
}: ChordTrackSettingsProps) {
  return (
    <section id={panelId} className={styles.settingsContent} aria-label="Chord settings">
      <SettingsRow
        label="Sticky chord track"
        description="In Horizon, keep the whole track visible at the nearest vertical edge when it scrolls out of view."
      >
        {({ controlId, descriptionId }) => (
          <Switch
            id={controlId}
            aria-describedby={descriptionId}
            checked={sticky}
            disabled={!onStickyChange}
            onCheckedChange={(enabled) => onStickyChange?.(enabled)}
          />
        )}
      </SettingsRow>
      <SettingsRow label="Position" description="Natural track position above or below the music in Horizon.">
        {({ controlId, descriptionId }) => (
          <Select
            id={controlId}
            aria-label="Chord track position"
            aria-describedby={descriptionId}
            value={position}
            options={POSITION_OPTIONS}
            disabled={!onPositionChange}
            onValueChange={(value) => {
              if (value === "above" || value === "below") onPositionChange?.(value);
              else console.error("Unknown chord-track position", value);
            }}
          />
        )}
      </SettingsRow>
      <SettingsRow label="Entry grid" description="Hold Alt while dragging a chord to snap to sixteenth notes.">
        {({ controlId, descriptionId }) => (
          <Select
            id={controlId}
            aria-label="Chord entry grid"
            aria-describedby={descriptionId}
            value={grid}
            options={GRID_OPTIONS}
            onValueChange={(value) => {
              if (value === "quarter" || value === "eighth" || value === "sixteenth") onGridChange(value);
              else console.error("Unknown chord-track grid", value);
            }}
          />
        )}
      </SettingsRow>
      <SettingsRow
        label="Audition chords"
        description={
          onAuditionChange
            ? "Preview chord changes while playback is stopped. The Chords mixer channel controls sound and level."
            : "Audio audition is not connected in this mock."
        }
      >
        {({ controlId, descriptionId }) => (
          <Switch
            id={controlId}
            aria-describedby={descriptionId}
            checked={audition}
            disabled={!onAuditionChange}
            onCheckedChange={(enabled) => onAuditionChange?.(enabled)}
          />
        )}
      </SettingsRow>
    </section>
  );
}

export function ConnectedChordTrackSettings({ panelId }: { panelId?: string }) {
  const grid = useViewStateStore((state) => state.chordTrackGrid);
  const audition = useViewStateStore((state) => state.chordTrackAudition);
  const setGrid = useViewStateStore((state) => state.setChordTrackGrid);
  const setAudition = useViewStateStore((state) => state.setChordTrackAudition);
  const sticky = useViewStateStore((state) => state.chordTrackSticky);
  const setSticky = useViewStateStore((state) => state.setChordTrackSticky);
  const position = useViewStateStore((state) => state.chordTrackPosition);
  const setPosition = useViewStateStore((state) => state.setChordTrackPosition);
  return (
    <ChordTrackSettings
      panelId={panelId}
      grid={grid}
      onGridChange={setGrid}
      audition={audition}
      onAuditionChange={setAudition}
      sticky={sticky}
      onStickyChange={setSticky}
      position={position}
      onPositionChange={setPosition}
    />
  );
}
