import {
  useFollowActions,
  useFollowEnabled,
  useMetronomeSound,
  useMetronomeSoundActions,
  useTransportVisibilityActions,
  useTransportVisibilityPreferences,
} from "@viritura/playback";
import type { ClickSound } from "@viritura/audio";
import { ButtonGroup, SettingsRow, Switch } from "@viritura/ui";
import { useClickSettingsStore, type ClickFlashMode } from "../../../store/clickSettingsStore";

const CLICK_SOUND_OPTIONS: Array<{ value: ClickSound; label: string }> = [
  { value: "oscillator", label: "Oscillator" },
  { value: "tick", label: "Tick" },
  { value: "woodblock", label: "Woodblock" },
];

const CLICK_FLASH_OPTIONS: Array<{ value: ClickFlashMode; label: string }> = [
  { value: "beat", label: "Every beat" },
  { value: "measure", label: "Measure only" },
  { value: "off", label: "Off" },
];

export function PlaybackPanel() {
  const { showTimeDisplay, showFollow, showMetronome } = useTransportVisibilityPreferences();
  const { setVisibility } = useTransportVisibilityActions();
  const followEnabled = useFollowEnabled();
  const { setEnabled: setFollowEnabled } = useFollowActions();
  const sound = useMetronomeSound();
  const { setSound } = useMetronomeSoundActions();
  const flashMode = useClickSettingsStore((state) => state.flashMode);
  const setFlashMode = useClickSettingsStore((state) => state.setFlashMode);

  return (
    <>
      <SettingsRow label="Show time display" description="Show elapsed and total playback time in the transport bar.">
        {({ controlId, descriptionId }) => (
          <Switch
            id={controlId}
            aria-describedby={descriptionId}
            checked={showTimeDisplay}
            onCheckedChange={(checked) => setVisibility({ showTimeDisplay: checked })}
          />
        )}
      </SettingsRow>
      <SettingsRow
        label="Show follow-playback-head control"
        description="Show the transport control for keeping the score viewport with the playback head."
      >
        {({ controlId, descriptionId }) => (
          <Switch
            id={controlId}
            aria-describedby={descriptionId}
            checked={showFollow}
            onCheckedChange={(checked) => setVisibility({ showFollow: checked })}
          />
        )}
      </SettingsRow>
      <SettingsRow
        label="Follow playback head"
        description="Keep the score viewport following playback when follow is enabled."
      >
        {({ controlId, descriptionId }) => (
          <Switch
            id={controlId}
            aria-describedby={descriptionId}
            checked={followEnabled}
            onCheckedChange={setFollowEnabled}
          />
        )}
      </SettingsRow>
      <SettingsRow label="Show metronome control" description="Show the click-track toggle in the transport bar.">
        {({ controlId, descriptionId }) => (
          <Switch
            id={controlId}
            aria-describedby={descriptionId}
            checked={showMetronome}
            onCheckedChange={(checked) => setVisibility({ showMetronome: checked })}
          />
        )}
      </SettingsRow>
      <SettingsRow
        layout="stacked"
        label="Metronome sound"
        description="Choose the sound used by the metronome and Click activity."
      >
        {({ labelId, descriptionId }) => (
          <ButtonGroup
            options={CLICK_SOUND_OPTIONS}
            value={sound}
            onChange={setSound}
            ariaLabelledBy={labelId}
            ariaDescribedBy={descriptionId}
          />
        )}
      </SettingsRow>
      <SettingsRow
        layout="stacked"
        label="Click player flash"
        description="Flash on each beat or only on the first beat of each bar. Disabled when reduced motion is enabled."
      >
        {({ labelId, descriptionId }) => (
          <ButtonGroup
            options={CLICK_FLASH_OPTIONS}
            value={flashMode}
            onChange={setFlashMode}
            ariaLabelledBy={labelId}
            ariaDescribedBy={descriptionId}
          />
        )}
      </SettingsRow>
    </>
  );
}
