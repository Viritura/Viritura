import { useEffect, useEffectEvent } from "react";

const PANEL_TOGGLE_EVENT = "viritura:toggle-panels";

export function requestPanelToggle(): void {
  window.dispatchEvent(new Event(PANEL_TOGGLE_EVENT));
}

export function usePanelToggleRequest(enabled: boolean, onToggle: () => void): void {
  const handleToggle = useEffectEvent(onToggle);

  useEffect(() => {
    if (!enabled) return;
    const onRequest = () => handleToggle();
    window.addEventListener(PANEL_TOGGLE_EVENT, onRequest);
    return () => window.removeEventListener(PANEL_TOGGLE_EVENT, onRequest);
  }, [enabled]);
}
