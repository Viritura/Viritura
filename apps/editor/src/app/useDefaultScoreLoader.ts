import { useCallback, useEffect } from "react";
import { parseMnx } from "@viritura/format";
import { toast } from "sonner";
import { buildBlankScore } from "../score/ScoreBuilder";
import { createPlayer, renumberPlayers } from "../score/InstrumentCatalog";
import type { useDocumentStoreApi } from "../store/DocumentContext";
import type { OpenFileResult } from "../commands/fileCommands";
import type { Score } from "@viritura/core";
import { openPercussionReviewForParts } from "../store/drumKitTargetStore";
import { DEFAULT_SCORE_SAMPLE, type ScoreSample } from "../scoreSamples";

export function formatOpenedFileError(filename: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const technicalDetails = stack && stack !== detail ? `${detail}\n\nStack trace:\n${stack}` : detail;
  return `Could not open "${filename}".\n${technicalDetails}\n\nPlease include these details when reporting the issue.`;
}

interface UseDefaultScoreLoaderArgs {
  store: ReturnType<typeof useDocumentStoreApi>;
  loadScore: (score: Score, fileName?: string, mnxJson?: string) => void;
  resetHistory: (mnxJson: string) => void;
  openedFile: OpenFileResult | null;
  setSelectedScoreIndex: (idx: number) => void;
  setFileHandle: (handle: FileSystemFileHandle | null) => void;
  setFileError: (error: string | null) => void;
}

export interface DefaultScoreLoader {
  loadDefaultScore: () => void;
  loadSampleScore: (sample: ScoreSample) => Promise<boolean>;
}

export function useDefaultScoreLoader({
  store,
  loadScore,
  resetHistory,
  openedFile,
  setSelectedScoreIndex,
  setFileHandle,
  setFileError,
}: UseDefaultScoreLoaderArgs): DefaultScoreLoader {
  const loadBundledScore = useCallback(
    async (sample: ScoreSample) => {
      const response = await fetch(`${import.meta.env.BASE_URL}scores/${sample.file}`);
      if (!response.ok) throw new Error(`Failed to load ${sample.title} (${response.status})`);
      const json = await response.text();
      const parsed = parseMnx(JSON.parse(json));
      setSelectedScoreIndex(0);
      setFileHandle(null);
      loadScore(parsed, sample.title);
      resetHistory(store.getState().mnxJson || json);
    },
    [loadScore, resetHistory, setFileHandle, setSelectedScoreIndex, store],
  );

  const loadSampleScore = useCallback(
    async (sample: ScoreSample) => {
      try {
        await loadBundledScore(sample);
        return true;
      } catch (error) {
        console.error(`Failed to load sample score "${sample.title}":`, error);
        toast.error(`Failed to load ${sample.title}`);
        return false;
      }
    },
    [loadBundledScore],
  );

  const loadDefaultScore = useCallback(() => {
    void loadBundledScore(DEFAULT_SCORE_SAMPLE).catch(() => {
      // Fallback to blank score
      const json = buildBlankScore({
        title: "Untitled",
        players: renumberPlayers([createPlayer("piano")]),
        time: { count: 4, unit: 4 },
        keyFifths: 0,
        measureCount: 8,
        tempoBpm: 120,
      });
      try {
        const parsed = parseMnx(JSON.parse(json));
        loadScore(parsed, "Untitled");
        resetHistory(store.getState().mnxJson || json);
      } catch {
        /* ignore */
      }
    });
  }, [loadBundledScore, loadScore, resetHistory, store]);

  // Load opened file into document context
  useEffect(() => {
    if (!openedFile) return;
    try {
      const parsed = parseMnx(JSON.parse(openedFile.mnxJson));
      setSelectedScoreIndex(0);
      loadScore(parsed, openedFile.filename);
      resetHistory(store.getState().mnxJson || openedFile.mnxJson);
      setFileHandle(openedFile.fileHandle);
      setFileError(null);
      if (openedFile.percussionReviewPartIndices?.length) {
        toast.warning(
          `Review ${openedFile.percussionReviewPartIndices.length} percussion ${openedFile.percussionReviewPartIndices.length === 1 ? "map" : "maps"}: MusicXML did not identify every sound.`,
          { description: openedFile.percussionReviewReasons?.join("\n") },
        );
        openPercussionReviewForParts(openedFile.percussionReviewPartIndices, openedFile.percussionReviewReasons);
      }
    } catch (err) {
      console.error("Failed to load opened file:", err);
      setFileError(formatOpenedFileError(openedFile.filename, err));
      toast.error(`Failed to open ${openedFile.filename}`);
    }
  }, [openedFile, loadScore, resetHistory, store, setSelectedScoreIndex, setFileHandle, setFileError]);

  return { loadDefaultScore, loadSampleScore };
}
