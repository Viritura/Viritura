import { PaletteButton } from "@viritura/ui";
import { useTextFrameEditing } from "./useTextFrameEditing";

export function PageTextFrameButton({
  getCurrentPageIndex,
  onCreated,
}: {
  getCurrentPageIndex?: () => number;
  onCreated?: () => void;
}) {
  const editing = useTextFrameEditing();
  return (
    <PaletteButton
      shape="wide"
      label="Page text frame"
      title="Page text frame"
      disabled={!editing.score?.scores?.[editing.scoreIndex]}
      onClick={() => {
        editing.createFrame({ type: "page", pageIndex: getCurrentPageIndex?.() ?? 0 });
        onCreated?.();
      }}
    />
  );
}
