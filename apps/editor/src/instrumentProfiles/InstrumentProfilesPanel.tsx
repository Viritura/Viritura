import { useEffect, useMemo } from "react";
import { closeProfileEditor, loadInstrumentProfiles, useInstrumentProfileStore } from "./instrumentProfileStore";
import { ProfileEditorView } from "./ProfileEditorView";
import { ProfileListView } from "./ProfileListView";
import { selectHostBridge, isDesktopHost } from "./profileHostBridge";
import { useScanFoldersStore } from "./scanFoldersStore";

/**
 * The Settings → Instrument Profiles panel.
 *
 * Two views in one pane: the profile list, and the editor for one profile.
 * Editing swaps the pane's contents rather than opening a dialog — the panel is
 * already inside the settings dialog, and stacking a second one over it would
 * bury the user two modal layers deep with two close buttons.
 */
export function InstrumentProfilesPanel() {
  const profiles = useInstrumentProfileStore((s) => s.profiles);
  const editingProfileId = useInstrumentProfileStore((s) => s.editingProfileId);
  const ensureSeeded = useScanFoldersStore((s) => s.ensureSeeded);
  const bridge = useMemo(() => selectHostBridge(), []);
  const desktop = isDesktopHost();

  useEffect(() => {
    void loadInstrumentProfiles();
    // Seed the plugin/script search folders with the platform defaults so the
    // Configure pickers find installed plugins on first run.
    void ensureSeeded();
  }, [ensureSeeded]);

  const editingProfile = profiles.find((profile) => profile.id === editingProfileId) ?? null;

  if (editingProfile) {
    return <ProfileEditorView profile={editingProfile} bridge={bridge} onBack={closeProfileEditor} />;
  }

  return <ProfileListView profiles={profiles} desktop={desktop} />;
}
