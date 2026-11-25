import { useEffect } from "react";
import type { DocumentStore } from "../store/documentStore";
import { useProjectFileSwitchStore } from "./projectFileSwitchStore";
import { switchProjectScore } from "./switchProjectScore";

export interface ProjectFileSwitchRegistration {
  store: DocumentStore;
  openProjectScore: (relativePath: string) => Promise<boolean>;
  save: () => Promise<void>;
}

/** Expose project score switching to header chrome without threading props through every mode. */
export function useProjectFileSwitchRegistration({ store, openProjectScore, save }: ProjectFileSwitchRegistration) {
  useEffect(() => {
    const { register, setSwitching } = useProjectFileSwitchStore.getState();
    register(async (relativePath) => {
      if (useProjectFileSwitchStore.getState().switching) return false;
      setSwitching(true);
      try {
        return await switchProjectScore({ store, relativePath, openProjectScore, save });
      } finally {
        setSwitching(false);
      }
    });
    return () => register(null);
  }, [store, openProjectScore, save]);
}
