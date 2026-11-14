import { PaletteButton } from "@viritura/ui";
import { useLyricEntryCommand } from "../../../lyrics";
import { useDocumentStoreApi } from "../../../store/DocumentContext";
import { useNoteInputStore } from "../../../store/noteInputStore";
import { useOverlayStore } from "../../../store/overlayStore";
import { useSelection } from "../../../store/selectionStore";

export function LyricsButton({ onOpenProperties }: { onOpenProperties: () => void }) {
  const store = useDocumentStoreApi();
  const selection = useSelection();
  const noteInputActive = useNoteInputStore((state) => state.active);
  const { lyricMode, setLyricMode, setLyricState } = useOverlayStore();
  const startEntry = useLyricEntryCommand({
    store,
    selection,
    noteInputActive,
    lyricMode,
    setLyricMode,
    setLyricState,
    onOpenLyricsProperties: onOpenProperties,
    enabled: true,
  });
  return (
    <PaletteButton
      shape="wide"
      label="Lyrics"
      title="Lyrics"
      shortcut="Shift+W"
      active={lyricMode}
      onClick={startEntry}
    />
  );
}
