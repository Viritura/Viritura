import { create } from "zustand";

type SwitchProjectScore = (relativePath: string) => Promise<boolean>;

interface ProjectFileSwitchState {
  /** Registered by the app shell, which owns document loading. */
  switchTo: SwitchProjectScore | null;
  /** True while a switch is resolving unsaved changes or loading. */
  switching: boolean;
  register(switchTo: SwitchProjectScore | null): void;
  setSwitching(switching: boolean): void;
}

export const useProjectFileSwitchStore = create<ProjectFileSwitchState>((set) => ({
  switchTo: null,
  switching: false,
  register: (switchTo) => set({ switchTo }),
  setSwitching: (switching) => set({ switching }),
}));
