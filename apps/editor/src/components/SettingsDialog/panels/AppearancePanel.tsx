import { Button, ButtonGroup, SettingsRow } from "@viritura/ui";
import { useThemeStore, setTheme, type Theme } from "../../../store/themeStore";
import { openDialog } from "../../../store/dialogStore";

const THEME_OPTIONS: Array<{ value: Theme; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "midnight", label: "Midnight" },
];

export function AppearancePanel() {
  const theme = useThemeStore((s) => s.theme);

  return (
    <>
      <SettingsRow
        layout="stacked"
        label="Theme"
        description="Applies immediately across the editor chrome and the score canvas."
      >
        {({ labelId, descriptionId }) => (
          <ButtonGroup
            options={THEME_OPTIONS}
            value={theme}
            onChange={(value) => setTheme(value)}
            ariaLabelledBy={labelId}
            ariaDescribedBy={descriptionId}
          />
        )}
      </SettingsRow>
      <SettingsRow
        label="Display calibration"
        description="Match physical score dimensions to this display for accurate actual-size preview."
      >
        {({ controlId, descriptionId }) => (
          <Button id={controlId} aria-describedby={descriptionId} onClick={() => openDialog("calibration")}>
            Calibrate display…
          </Button>
        )}
      </SettingsRow>
    </>
  );
}
