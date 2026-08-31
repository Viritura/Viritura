import { SettingsRow, Switch } from "@viritura/ui";
import { useImportSettingsStore } from "../../../store/importSettingsStore";

export function ImportPanel() {
  const includeVendorExtensions = useImportSettingsStore((s) => s.includeVendorExtensions);
  const discardStemDirections = useImportSettingsStore((s) => s.discardStemDirections);
  const hideMetronomeWhenTempoText = useImportSettingsStore((s) => s.hideMetronomeWhenTempoText);
  const setIncludeVendorExtensions = useImportSettingsStore((s) => s.setIncludeVendorExtensions);
  const setDiscardStemDirections = useImportSettingsStore((s) => s.setDiscardStemDirections);
  const setHideMetronomeWhenTempoText = useImportSettingsStore((s) => s.setHideMetronomeWhenTempoText);

  return (
    <>
      <SettingsRow
        label="Preserve Viritura vendor extensions"
        description="Keep engraving data stored under _x.viritura when reading a file. Turn this off to import only what the MNX spec defines."
      >
        {({ controlId, descriptionId }) => (
          <Switch
            id={controlId}
            aria-describedby={descriptionId}
            checked={includeVendorExtensions}
            onCheckedChange={setIncludeVendorExtensions}
          />
        )}
      </SettingsRow>

      <SettingsRow
        label="Discard explicit stem directions"
        description="Ignore stem directions recorded in the file and let the engine choose them from context."
      >
        {({ controlId, descriptionId }) => (
          <Switch
            id={controlId}
            aria-describedby={descriptionId}
            checked={discardStemDirections}
            onCheckedChange={setDiscardStemDirections}
          />
        )}
      </SettingsRow>

      <SettingsRow
        label="Hide metronome mark when tempo text is present"
        description="Avoids printing both a worded tempo and its metronome equivalent above the same beat."
      >
        {({ controlId, descriptionId }) => (
          <Switch
            id={controlId}
            aria-describedby={descriptionId}
            checked={hideMetronomeWhenTempoText}
            onCheckedChange={setHideMetronomeWhenTempoText}
          />
        )}
      </SettingsRow>
    </>
  );
}
