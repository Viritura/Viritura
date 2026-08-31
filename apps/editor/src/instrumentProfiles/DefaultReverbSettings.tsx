import { useCallback, useState } from "react";
import { Button } from "@viritura/ui";
import { useDefaultReverbStore } from "./defaultReverbStore";
import { selectHostBridge } from "./profileHostBridge";
import { useDiscoveredPlugins } from "./useDiscovered";
import { SourcePickerDialog } from "./SourcePickerDialog";
import { FolderConfigDialog } from "./FolderConfigDialog";

function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/**
 * Desktop-only picker for the default reverb effect — the plugin used to seed a
 * fresh reverb FX chain (see `fxChainStore.ensureReverbSeeded`). Choosing one
 * here means new scores get a sensible reverb without hand-building the chain;
 * users who want something else edit the reverb chain on the mixer's FX page.
 */
export function DefaultReverbSettings() {
  const pluginName = useDefaultReverbStore((s) => s.pluginName);
  const setDefaultReverb = useDefaultReverbStore((s) => s.setDefaultReverb);
  const discovered = useDiscoveredPlugins();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(false);

  const pick = useCallback(
    (path: string) => {
      setDefaultReverb(path, fileNameOf(path));
      setPickerOpen(false);
    },
    [setDefaultReverb],
  );

  const browse = useCallback(async () => {
    setPickerOpen(false);
    const picked = await selectHostBridge().pickPlugin();
    if (picked) setDefaultReverb(picked.path, fileNameOf(picked.path));
  }, [setDefaultReverb]);

  return (
    <div>
      <div style={ROW_STYLE}>
        <span style={pluginName ? VALUE_STYLE : VALUE_UNSET_STYLE}>{pluginName ?? "None selected"}</span>
        <Button label="Choose…" size="sm" onClick={() => setPickerOpen(true)} />
        {pluginName ? (
          <Button label="Clear" variant="ghost" size="sm" onClick={() => setDefaultReverb(null, null)} />
        ) : null}
      </div>
      <p style={HINT_STYLE}>Seeds the reverb FX chain on the mixer when it&rsquo;s empty.</p>

      <SourcePickerDialog
        open={pickerOpen}
        title="Choose default reverb"
        entries={discovered.entries}
        loading={discovered.loading}
        currentPath={undefined}
        emptyHint="No plugins found in your search folders. Use Browse to pick a file, or add folders."
        onPick={pick}
        onBrowse={() => void browse()}
        onConfigureFolders={() => {
          setPickerOpen(false);
          setFoldersOpen(true);
        }}
        onClose={() => setPickerOpen(false)}
      />
      <FolderConfigDialog open={foldersOpen} onClose={() => setFoldersOpen(false)} />
    </div>
  );
}

const ROW_STYLE = { display: "flex", alignItems: "center", gap: 8 } as const;
const VALUE_STYLE = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;
const VALUE_UNSET_STYLE = { ...VALUE_STYLE, opacity: 0.6 } as const;
const HINT_STYLE = { marginTop: 8, fontSize: 12, opacity: 0.7, lineHeight: 1.4 } as const;
