import { useEffect } from "react";
import { keyboardRegistry, type KeyboardRegistry } from "../../../keyboard/KeyboardRegistry";

export function registerPictureShortcuts(
  onAddMarkerAtPlayhead: () => void,
  registry: KeyboardRegistry = keyboardRegistry,
): () => void {
  return registry.register({
    id: "picture.addMarkerAtPlayhead",
    key: "M",
    context: "global",
    handler: (event) => {
      if (event.repeat) return false;
      onAddMarkerAtPlayhead();
    },
  });
}

/** Register shortcuts only for the lifetime of the mounted Picture activity. */
export function usePictureShortcuts(onAddMarkerAtPlayhead: () => void): void {
  useEffect(() => registerPictureShortcuts(onAddMarkerAtPlayhead), [onAddMarkerAtPlayhead]);
}
