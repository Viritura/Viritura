import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import type { Score } from "@viritura/core";
import { PlaybackProvider, TransportBar } from "@viritura/playback";
import { ScoreViewer, type ScoreViewerScoreOption } from "@viritura/score-viewer-react";
import { Button, TooltipPrimitives } from "@viritura/ui";
import { Toaster } from "sonner";
import { loadGistMnx, readGistShareLocation, type LoadedGistMnx } from "../gistShare";
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
      <PlaybackProvider score={publication.score}>
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
          <div className={styles.notice}>
            Read-only preview hosted on GitHub Gist. Secret Gists are unlisted, not private.
          </div>
          <section className={styles.viewer} aria-label="Shared score">
            <ScoreViewer
              mnx={publication.mnx}
              scoreOptions={scoreOptions}
              defaultFitMode="width"
              defaultViewMode="page"
              controls={{ score: true, viewMode: true, zoom: true, fit: true }}
              viewportClassName={styles.viewport}
            />
          </section>
        </main>
        <Toaster position="bottom-right" richColors closeButton />
      </PlaybackProvider>
    </TooltipPrimitives.Provider>
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
