import { useEffect, useRef, useState } from "react";
import {
  createLayoutService,
  loadMusicFont,
  type DisplayList,
  type LayoutService,
  type ScoreInfo,
} from "@viritura/renderer";
import { applyUseWrittenOverride } from "./useDiffEngineHelpers";

interface DiffLayoutRequest {
  id: number;
  originalText: string;
  modifiedText: string;
  useWritten: boolean | undefined;
}

interface UseDiffLayoutsOptions {
  originalText: string;
  modifiedText: string;
  useWritten: boolean | undefined;
  oversized: boolean;
}

interface UseDiffLayoutsResult {
  ready: boolean;
  originalDl: DisplayList | null;
  modifiedDl: DisplayList | null;
}

async function computeLayout(service: LayoutService, json: string): Promise<DisplayList | null> {
  if (!json) return null;
  const info: ScoreInfo = await service.getScoreInfo(json);
  return info.partCount > 1
    ? service.engine.computeFullScoreLayout(json, 12, 0)
    : service.engine.computeLayout(json, 0, 12, 0);
}

/**
 * Runs Review's two full-score layouts off the UI thread. Requests are
 * latest-wins: one pair may be in flight and one newer pair may be pending,
 * preventing rapid history clicks from building an uncancellable worker queue.
 */
export function useDiffLayouts({
  originalText,
  modifiedText,
  useWritten,
  oversized,
}: UseDiffLayoutsOptions): UseDiffLayoutsResult {
  const [ready, setReady] = useState(false);
  const [originalDl, setOriginalDl] = useState<DisplayList | null>(null);
  const [modifiedDl, setModifiedDl] = useState<DisplayList | null>(null);
  const serviceRef = useRef<LayoutService | null>(null);
  const pendingRef = useRef<DiffLayoutRequest | null>(null);
  const runningRef = useRef(false);
  const requestIdRef = useRef(0);
  const drainRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let disposed = false;
    let service: LayoutService;
    try {
      service = createLayoutService(false);
    } catch (error) {
      console.error("Review layout worker could not be created:", error);
      return;
    }
    serviceRef.current = service;

    void Promise.all([service.ready, loadMusicFont()])
      .then(([workerReady]) => {
        if (disposed) return;
        if (!workerReady) throw new Error("Review layout worker did not initialize.");
        setReady(true);
        drainRef.current();
      })
      .catch((error: unknown) => {
        if (!disposed) console.error("Review layout initialization failed:", error);
      });

    const drain = async (): Promise<void> => {
      if (disposed || runningRef.current || !service.isReady()) return;
      const request = pendingRef.current;
      if (!request) return;
      pendingRef.current = null;
      runningRef.current = true;

      try {
        const originalJson =
          request.useWritten === undefined
            ? request.originalText
            : applyUseWrittenOverride(request.originalText, request.useWritten);
        const modifiedJson =
          request.useWritten === undefined
            ? request.modifiedText
            : applyUseWrittenOverride(request.modifiedText, request.useWritten);
        const nextOriginal = await computeLayout(service, originalJson);
        if (disposed || request.id !== requestIdRef.current) return;
        setOriginalDl(nextOriginal);
        const nextModified = await computeLayout(service, modifiedJson);
        if (disposed || request.id !== requestIdRef.current) return;
        setModifiedDl(nextModified);
      } catch (error) {
        if (!disposed && request.id === requestIdRef.current) {
          console.error("Review score layout failed:", error);
          setOriginalDl(null);
          setModifiedDl(null);
        }
      } finally {
        runningRef.current = false;
        if (!disposed && pendingRef.current) void drain();
      }
    };
    drainRef.current = () => void drain();

    return () => {
      disposed = true;
      pendingRef.current = null;
      drainRef.current = () => undefined;
      service.dispose();
      serviceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const id = ++requestIdRef.current;
    setOriginalDl(null);
    setModifiedDl(null);
    if (oversized) {
      pendingRef.current = null;
      return;
    }
    pendingRef.current = { id, originalText, modifiedText, useWritten };

    queueMicrotask(() => drainRef.current());
  }, [originalText, modifiedText, useWritten, oversized]);

  return { ready, originalDl, modifiedDl };
}
