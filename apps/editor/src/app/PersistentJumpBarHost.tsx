import { useEffect } from "react";
import { JumpBar } from "../components/JumpBar";
import { setJumpBarOpen, useOverlayStore } from "../store/overlayStore";
import { useJumpBarCatalogStore } from "../store/jumpBarStore";

/** App-shell Jump Bar host and opener; remains mounted in every activity. */
export function PersistentJumpBarHost() {
  const open = useOverlayStore((state) => state.jumpBarOpen);
  const actions = useJumpBarCatalogStore((state) => state.actions);
  const resolveQueryAction = useJumpBarCatalogStore((state) => state.resolveQueryAction);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.code !== "Space") return;
      event.preventDefault();
      event.stopPropagation();
      setJumpBarOpen(true);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  return (
    <JumpBar
      open={open}
      onClose={() => setJumpBarOpen(false)}
      actions={actions}
      resolveQueryAction={resolveQueryAction}
    />
  );
}
