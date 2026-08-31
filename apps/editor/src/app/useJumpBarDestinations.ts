import { useCallback, useEffect, useMemo, type RefObject } from "react";
import { availableCategories } from "../components/SettingsDialog";
import type { JumpBarAction } from "../components/JumpBar";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import { useDocumentStore } from "../store/DocumentContext";
import type { DocumentStore } from "../store/documentStore";
import { setJumpBarCatalog } from "../store/jumpBarStore";
import { buildScoreEntries } from "../scoreSwitcher/scoreEntries";
import { resolveJumpBarNavigationQuery, type JumpBarDestinations } from "../jumpBar";

/** Derive document- and host-specific Jump Bar destinations from their registries. */
export function useJumpBarDestinations(): JumpBarDestinations {
  const score = useDocumentStore((state) => state.score);
  const scoreEntries = useMemo(() => buildScoreEntries(score), [score]);
  const settings = useMemo(
    () =>
      availableCategories().map((category) => ({
        id: category.id,
        label: category.label,
        keywords: category.keywords,
      })),
    [],
  );
  return { scoreEntries, settings };
}

/** Publish the live command catalog to the persistent app-shell Jump Bar host. */
export function usePublishJumpBarCatalog(
  actions: JumpBarAction[],
  store: DocumentStore,
  canvasRef: RefObject<ScoreCanvasHandle | null>,
): void {
  const resolveQueryAction = useCallback(
    (query: string): JumpBarAction | null => {
      const target = resolveJumpBarNavigationQuery(query, store.getState().score);
      if (!target) return null;
      return {
        id: `navigation.measure.${target.measureIndex}`,
        label: target.label,
        category: "Navigation",
        execute: () => canvasRef.current?.scrollToMeasure(target.measureIndex),
      };
    },
    [canvasRef, store],
  );
  useEffect(() => setJumpBarCatalog(actions, resolveQueryAction), [actions, resolveQueryAction]);
}
