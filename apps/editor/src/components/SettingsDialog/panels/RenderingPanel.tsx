import { SettingsRow, Switch } from "@viritura/ui";
import { useDebugSettingsStore } from "../../../store/debugSettingsStore";

export function RenderingPanel() {
  const performanceOverlay = useDebugSettingsStore((s) => s.performanceOverlay);
  const hitboxOverlay = useDebugSettingsStore((s) => s.hitboxOverlay);
  const tileCacheDisabled = useDebugSettingsStore((s) => s.tileCacheDisabled);
  const setPerformanceOverlay = useDebugSettingsStore((s) => s.setPerformanceOverlay);
  const setHitboxOverlay = useDebugSettingsStore((s) => s.setHitboxOverlay);
  const setTileCacheDisabled = useDebugSettingsStore((s) => s.setTileCacheDisabled);

  return (
    <>
      <SettingsRow
        label="Performance overlay"
        description="Show frame timing and layout cost on top of the score while it renders."
      >
        {({ controlId, descriptionId }) => (
          <Switch
            id={controlId}
            aria-describedby={descriptionId}
            checked={performanceOverlay}
            onCheckedChange={setPerformanceOverlay}
          />
        )}
      </SettingsRow>

      <SettingsRow label="Hitbox overlay" description="Outline the region each element responds to when clicked.">
        {({ controlId, descriptionId }) => (
          <Switch
            id={controlId}
            aria-describedby={descriptionId}
            checked={hitboxOverlay}
            onCheckedChange={setHitboxOverlay}
          />
        )}
      </SettingsRow>

      <SettingsRow
        label="Bypass tile cache"
        description="Repaint every tile on each frame instead of reusing cached ones. Slower, but shows stale-tile bugs."
      >
        {({ controlId, descriptionId }) => (
          <Switch
            id={controlId}
            aria-describedby={descriptionId}
            checked={tileCacheDisabled}
            onCheckedChange={setTileCacheDisabled}
          />
        )}
      </SettingsRow>
    </>
  );
}
