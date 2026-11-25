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

const CLICK_SOUND_OPTIONS: Array<{ value: ClickSound; label: string }> = [
  { value: "tick", label: "Tick" },
  { value: "woodblock", label: "Woodblock" },
  { value: "beep", label: "Beep" },
];

export function PlaybackPanel() {
  const { showTimeDisplay, showFollow, showMetronome } = useTransportVisibilityPreferences();
  const { setVisibility } = useTransportVisibilityActions();
  const followEnabled = useFollowEnabled();
  const { setEnabled: setFollowEnabled } = useFollowActions();
  const sound = useMetronomeSound();
  const { setSound } = useMetronomeSoundActions();

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
    </>
  );
}
