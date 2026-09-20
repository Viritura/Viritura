import {
  useFollowActions,
  useFollowEnabled,
  useTransportVisibilityActions,
  useTransportVisibilityPreferences,
} from "@viritura/playback";
import { SettingsRow, Switch } from "@viritura/ui";

export function PlaybackPanel() {
  const { showTimeDisplay, showFollow, showMetronome } = useTransportVisibilityPreferences();
  const { setVisibility } = useTransportVisibilityActions();
  const followEnabled = useFollowEnabled();
  const { setEnabled: setFollowEnabled } = useFollowActions();

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
    </>
  );
}
