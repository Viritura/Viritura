import type { CSSProperties } from "react";
import { Settings } from "lucide-react";
import { Button } from "@viritura/ui";
import { useViewStateStore } from "../../store/viewStateStore";
import styles from "./ChordTrack.module.css";
import type { ChordTrackProps, TrackSystem } from "./types";
import { trackHeaderGeometry } from "./trackHeaderGeometry";

interface SettingsButtonProps {
  firstBarX: number;
  railY: number;
  scale: number;
  expanded: boolean;
  onOpen: () => void;
  sticky?: boolean;
  leftInset?: number;
}

export function ChordTrackSettingsButton({
  firstBarX,
  railY,
  scale,
  expanded,
  onOpen,
  sticky = false,
  leftInset = 0,
}: SettingsButtonProps) {
  const geometry = trackHeaderGeometry(firstBarX, scale, sticky, leftInset);
  const style: CSSProperties = {
    left: geometry.left,
    top: railY,
    width: geometry.width,
    height: 76 * scale,
  };
  const rowStyle: CSSProperties = { left: 8 * scale, top: 24 * scale - geometry.buttonSize / 2, gap: 6 * scale };
  const labelStyle: CSSProperties = { fontSize: 12 * scale, width: 48 * scale };
  const buttonStyle: CSSProperties = { width: geometry.buttonSize, height: geometry.buttonSize };
  return (
    <div className={styles.trackHeader} style={style} data-sticky-chord-header={sticky}>
      <div className={styles.headerRow} style={rowStyle}>
        <span className={styles.headerLabel} style={labelStyle}>
          CHORDS
        </span>
        <Button
          className={styles.settingsButton}
          style={buttonStyle}
          shape="icon"
          variant="ghost"
          ariaLabel="Chord settings"
          tooltip="Chord settings"
          aria-expanded={expanded}
          aria-controls="chord-settings-panel"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onOpen}
        >
          <Settings size={18 * scale} aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

interface SettingsTriggerProps {
  system: TrackSystem | undefined;
  viewport: ChordTrackProps["viewport"];
  visible: boolean;
  railY: number;
  scale: number;
  leftInset?: number;
}

export function ChordTrackSettingsTrigger({
  system,
  viewport,
  visible,
  railY,
  scale,
  leftInset,
}: SettingsTriggerProps) {
  const open = useViewStateStore((state) => state.chordSettingsOpen);
  const first = system?.measures[0];
  if (!visible || !first) return null;
  return (
    <ChordTrackSettingsButton
      firstBarX={(first.x - viewport.scrollX) * viewport.zoom}
      railY={railY}
      scale={scale}
      expanded={open}
      sticky
      leftInset={leftInset}
      onOpen={() => useViewStateStore.getState().setChordSettingsOpen(true)}
    />
  );
}
