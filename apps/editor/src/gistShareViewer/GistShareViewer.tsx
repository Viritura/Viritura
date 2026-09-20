import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Volume2, X } from "lucide-react";
import {
  defaultPageSetupForScore,
  formatStaffSizeLabel,
  PAGE_SIZE_PRESETS,
  RASTRAL_SPATIUM_MM,
  type LayoutContent,
  type Score,
} from "@viritura/core";
import { PlaybackProvider, TransportBar, usePlaybackActions, usePlaybackState } from "@viritura/playback";
import {
  ScoreView,
  ScoreViewer,
  type ScoreViewerPageSizeOption,
  type ScoreViewerScoreOption,
  type ScoreViewerStaffSizeOption,
} from "@viritura/score-viewer-react";
import { Button, IconButton, Slider, TooltipPrimitives } from "@viritura/ui";
import { Toaster } from "sonner";
import { loadGistMnx, readGistShareLocation, type LoadedGistMnx } from "../gistShare";
import { getDesktopSoundfontLoader } from "../desktopAudio";
import styles from "./GistShareViewer.module.css";

type ViewerState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly publication: LoadedGistMnx }
  | { readonly status: "error"; readonly message: string };

export function GistShareViewer() {
  const [state, setState] = useState<ViewerState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const location = readGistShareLocation(window.location);
        const publication = await loadGistMnx(location);
        if (!cancelled) setState({ status: "loaded", publication });
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "The shared score could not be loaded.",
          });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <ShareStatus title="Loading shared score" detail="Fetching the MNX document from GitHub Gist." />;
  }
  if (state.status === "error") {
    return <ShareStatus title="Shared score unavailable" detail={state.message} />;
  }
  return <LoadedShare publication={state.publication} />;
}

function LoadedShare({ publication }: { readonly publication: LoadedGistMnx }) {
  const title = publication.score.metadata?.title?.trim() || publication.fileName;
  const composer = publication.score.metadata?.composer?.trim();
  const scoreOptions = useMemo(() => buildScoreOptions(publication.score), [publication.score]);
  const [scoreIndex, setScoreIndex] = useState(0);
  const [staffSize, setStaffSize] = useState(() => defaultStaffSizeForScore(publication.score, 0));
  const [noticeVisible, setNoticeVisible] = useState(true);
  const visiblePartIds = useMemo(
    () => visiblePartIdsForScore(publication.score, scoreIndex),
    [publication.score, scoreIndex],
  );

  const handleScoreIndexChange = (nextScoreIndex: number) => {
    setScoreIndex(nextScoreIndex);
    setStaffSize(defaultStaffSizeForScore(publication.score, nextScoreIndex));
  };

  useEffect(() => {
    document.title = `${title} — Viritura`;
  }, [title]);

  const handleDownload = () => {
    const blob = new Blob([publication.mnx], { type: "application/mnx+json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = publication.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <TooltipPrimitives.Provider delayDuration={400} skipDelayDuration={100}>
      <PlaybackProvider
        score={publication.score}
        visiblePartIds={visiblePartIds}
        soundfontLoader={getDesktopSoundfontLoader()}
      >
        <main className={styles.root}>
          <header className={styles.header}>
            <div className={styles.identity}>
              <a className={styles.brand} href="/" aria-label="Open Viritura">
                Viritura
              </a>
              <div>
                <h1 className={styles.title}>{title}</h1>
                {composer && <p className={styles.composer}>{composer}</p>}
              </div>
            </div>
            <div className={styles.actions}>
              <TransportBar showFollow={false} compact />
              <ShareVolumeControl />
              <Button size="sm" className={styles.actionButton} onClick={handleDownload}>
                <Download size={15} aria-hidden="true" />
                Download MNX
              </Button>
              <a className={styles.actionButton} href={publication.gistUrl} target="_blank" rel="noreferrer">
                View Gist
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            </div>
          </header>
          {noticeVisible && (
            <div className={styles.notice}>
              <span>Read-only preview hosted on GitHub Gist. Secret Gists are unlisted, not private.</span>
              <IconButton
                size="sm"
                variant="ghost"
                className={styles.noticeClose}
                tooltip="Dismiss preview notice"
                aria-label="Dismiss preview notice"
                onClick={() => setNoticeVisible(false)}
              >
                <X size={14} aria-hidden="true" />
              </IconButton>
            </div>
          )}
          <section className={styles.viewer} aria-label="Shared score">
            <ScoreViewer
              mnx={publication.mnx}
              scoreIndex={scoreIndex}
              onScoreIndexChange={handleScoreIndexChange}
              scoreOptions={scoreOptions}
              defaultFitMode="none"
              defaultViewMode="horizon"
              defaultZoom={1}
              viewportClassName={styles.viewport}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              defaultPageSizeId="A4"
              staffSizeOptions={STAFF_SIZE_OPTIONS}
              staffSize={staffSize}
              onStaffSizeChange={setStaffSize}
              controls={{ score: true, viewMode: true, zoom: true, fit: true, pageSize: true, staffSize: true }}
            >
              <SharedScorePlayhead />
            </ScoreViewer>
          </section>
        </main>
        <Toaster position="bottom-right" richColors closeButton />
      </PlaybackProvider>
    </TooltipPrimitives.Provider>
  );
}

const PAGE_SCALE = 800 / PAGE_SIZE_PRESETS.A4!.width;
const PAGE_SIZE_OPTIONS: readonly ScoreViewerPageSizeOption[] = Object.entries(PAGE_SIZE_PRESETS).map(
  ([id, dimensions]) => ({
    id,
    label: id,
    width: dimensions.width * PAGE_SCALE,
    height: dimensions.height * PAGE_SCALE,
  }),
);
const STAFF_SIZE_OPTIONS: readonly ScoreViewerStaffSizeOption[] = RASTRAL_SPATIUM_MM.map((spatiumMm, index) => ({
  label: `Rastral ${index} · ${formatStaffSizeLabel(spatiumMm)}`,
  spatium: spatiumMm * PAGE_SCALE,
}));

function defaultStaffSizeForScore(score: Score, scoreIndex: number): number {
  return defaultPageSetupForScore(score.scores, scoreIndex, score.layouts, score.parts.length).spatiumMm * PAGE_SCALE;
}

function collectPartIds(content: readonly LayoutContent[], result: Set<string>): void {
  for (const node of content) {
    if (node.type === "staff") {
      for (const source of node.sources) result.add(source.part);
    } else {
      collectPartIds(node.content, result);
    }
  }
}

function visiblePartIdsForScore(score: Score, scoreIndex: number): string[] {
  if (scoreIndex === 0) return [];
  const scoreDefinition = score.scores?.[scoreIndex];
  const layout = score.layouts?.find((candidate) => candidate.id === scoreDefinition?.layout);
  if (!layout) return [];
  const partIds = new Set<string>();
  collectPartIds(layout.content, partIds);
  return [...partIds];
}

function SharedScorePlayhead() {
  const playback = usePlaybackState();
  if (playback.status !== "playing" || !playback.playheadPosition) return null;
  return <ScoreView.Playhead position={playback.playheadPosition} />;
}

function ShareVolumeControl() {
  const { volume } = usePlaybackState();
  const { setVolume } = usePlaybackActions();
  const percentage = Math.round(volume * 100);

  return (
    <div className={styles.volumeControl}>
      <Volume2 size={15} aria-hidden="true" />
      <Slider
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={setVolume}
        ariaLabel={`Master volume ${percentage}%`}
        width={80}
      />
      <span className={styles.volumeValue} aria-hidden="true">
        {percentage}%
      </span>
    </div>
  );
}

function ShareStatus({ title, detail }: { readonly title: string; readonly detail: string }) {
  return (
    <main className={styles.statusRoot}>
      <div className={styles.statusCard}>
        <a className={styles.brand} href="/">
          Viritura
        </a>
        <h1>{title}</h1>
        <p>{detail}</p>
      </div>
    </main>
  );
}

function buildScoreOptions(score: Score): readonly ScoreViewerScoreOption[] {
  return (score.scores ?? []).map((scoreDefinition, index) => ({
    index,
    label: scoreDefinition.name?.trim() || (index === 0 ? "Full Score" : `Score ${index + 1}`),
  }));
}
