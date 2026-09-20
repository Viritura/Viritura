/**
 * Persisted visibility preferences for the shared transport bar.
 *
 * An explicit TransportBar prop always wins over these global preferences.
 * That lets a view remove a control that does not apply to its workflow
 * without changing the user's standard transport configuration.
 */

import { useMemo } from "react";
import { create } from "zustand";

const STORAGE_KEY = "viritura.transport.visibility";

export interface TransportVisibilityPreferences {
  readonly showTimeDisplay: boolean;
  readonly showFollow: boolean;
  readonly showMetronome: boolean;
}

const DEFAULT_PREFERENCES: TransportVisibilityPreferences = {
  showTimeDisplay: true,
  showFollow: true,
  showMetronome: true,
};

function loadPreferences(): TransportVisibilityPreferences {
  if (typeof localStorage === "undefined") return DEFAULT_PREFERENCES;
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (typeof stored !== "object" || stored === null) return DEFAULT_PREFERENCES;
    const values = stored as Partial<TransportVisibilityPreferences>;
    return {
      showTimeDisplay: values.showTimeDisplay ?? DEFAULT_PREFERENCES.showTimeDisplay,
      showFollow: values.showFollow ?? DEFAULT_PREFERENCES.showFollow,
      showMetronome: values.showMetronome ?? DEFAULT_PREFERENCES.showMetronome,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function persistPreferences(preferences: TransportVisibilityPreferences): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Storage can be unavailable in embedded or private browsing contexts.
  }
}

interface TransportSettingsStore extends TransportVisibilityPreferences {
  setVisibility: (visibility: Partial<TransportVisibilityPreferences>) => void;
}

const useTransportSettingsStore = create<TransportSettingsStore>()((set) => ({
  ...loadPreferences(),
  setVisibility: (visibility) =>
    set((current) => {
      const next: TransportVisibilityPreferences = {
        showTimeDisplay: visibility.showTimeDisplay ?? current.showTimeDisplay,
        showFollow: visibility.showFollow ?? current.showFollow,
        showMetronome: visibility.showMetronome ?? current.showMetronome,
      };
      persistPreferences(next);
      return next;
    }),
}));

/** Read persisted defaults for TransportBar controls. */
export function useTransportVisibilityPreferences(): TransportVisibilityPreferences {
  const showTimeDisplay = useTransportSettingsStore((state) => state.showTimeDisplay);
  const showFollow = useTransportSettingsStore((state) => state.showFollow);
  const showMetronome = useTransportSettingsStore((state) => state.showMetronome);
  return useMemo(() => ({ showTimeDisplay, showFollow, showMetronome }), [showTimeDisplay, showFollow, showMetronome]);
}

/** Update persisted defaults for TransportBar controls. */
export function useTransportVisibilityActions(): {
  setVisibility: (visibility: Partial<TransportVisibilityPreferences>) => void;
} {
  const setVisibility = useTransportSettingsStore((state) => state.setVisibility);
  return { setVisibility };
}
