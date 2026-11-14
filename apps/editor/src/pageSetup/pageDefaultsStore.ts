import { create } from "zustand";
import { toast } from "sonner";
import { type PageSetup, type PageSetupDefaults, type PageSetupRole } from "@viritura/core";

const STORAGE_KEY = "viritura.pageSetupDefaults";

function isPageSetup(value: unknown): value is PageSetup {
  if (!value || typeof value !== "object") return false;
  const setup = value as Record<string, unknown>;
  if (
    !["width", "height", "spatiumMm"].every(
      (key) => typeof setup[key] === "number" && Number.isFinite(setup[key]) && setup[key] > 0,
    )
  )
    return false;
  if (setup["orientation"] !== "portrait" && setup["orientation"] !== "landscape") return false;
  const margins = setup["margins"];
  if (!margins || typeof margins !== "object") return false;
  const edges = margins as Record<string, unknown>;
  return ["top", "right", "bottom", "left"].every(
    (key) => typeof edges[key] === "number" && Number.isFinite(edges[key]) && edges[key] >= 0,
  );
}

function loadDefaults(): PageSetupDefaults {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") throw new Error("Invalid page defaults");
    const stored = value as Record<string, unknown>;
    const defaults: PageSetupDefaults = {};
    for (const role of ["score", "part"] as const) {
      if (stored[role] === undefined) continue;
      if (!isPageSetup(stored[role])) throw new Error(`Invalid ${role} page defaults`);
      defaults[role] = stored[role];
    }
    return defaults;
  } catch (error) {
    console.warn("Unable to load user page defaults:", error);
    return {};
  }
}

interface PageDefaultsState {
  defaults: PageSetupDefaults;
  setDefault: (role: PageSetupRole, setup: PageSetup | undefined) => void;
}

export const usePageDefaultsStore = create<PageDefaultsState>()((set, get) => ({
  defaults: loadDefaults(),
  setDefault: (role, setup) => {
    const defaults = structuredClone(get().defaults);
    if (setup) defaults[role] = structuredClone(setup);
    else delete defaults[role];
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
    } catch (error) {
      console.warn("Unable to save user page defaults:", error);
      toast.error("Could not save page defaults. Check that browser storage is available.");
      return;
    }
    set({ defaults });
  },
}));
