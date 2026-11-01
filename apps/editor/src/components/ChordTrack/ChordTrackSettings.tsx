import { Select, SettingsRow, Switch } from "@viritura/ui";
import { useViewStateStore } from "../../store/viewStateStore";
import styles from "./ChordTrack.module.css";

const GRID_OPTIONS = [
  { value: "quarter", label: "Quarter" },
  { value: "eighth", label: "Eighths" },
  { value: "sixteenth", label: "Sixteenths" },
];

interface ChordTrackSettingsProps {
  panelId?: string;
  grid: "quarter" | "eighth" | "sixteenth";
  onGridChange: (grid: "quarter" | "eighth" | "sixteenth") => void;
  audition?: boolean;
  onAuditionChange?: (enabled: boolean) => void;
}

export function ChordTrackSettings({
  panelId = "chord-settings-panel",
  grid,
  onGridChange,
  audition = false,
  onAuditionChange,
}: ChordTrackSettingsProps) {
  return (
    <section id={panelId} className={styles.settingsContent} aria-label="Chord settings">
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
  return (
    <ChordTrackSettings
      panelId={panelId}
      grid={grid}
      onGridChange={setGrid}
      audition={audition}
      onAuditionChange={setAudition}
    />
  );
}
