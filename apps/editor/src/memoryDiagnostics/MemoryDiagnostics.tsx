import { useEffect } from "react";
import { toast } from "sonner";
import { subscribePlaybackStatus } from "@viritura/playback";
import { Button, SettingsRow } from "@viritura/ui";
import { useDocumentStoreApi } from "../store/DocumentContext";
import { readMemorySample } from "./browserSample";
import { MemoryRecorder, type MemoryReport } from "./recorder";
import { downloadMemoryReport, readSavedMemoryReport, saveMemoryReport } from "./reportStorage";

let activeRecorder: MemoryRecorder | null = null;

function notifyIncident(report: MemoryReport): void {
  // A string avoids retaining live score/renderer objects in an open DevTools console.
  console.warn("[MemoryDiagnostics] Memory pressure detected:", JSON.stringify(report));
  toast.warning("Viritura memory use is high or growing quickly. Save your work and download diagnostics.", {
    id: "memory-diagnostics",
    duration: Infinity,
    action: { label: "Download diagnostics", onClick: () => downloadMemoryReport(report) },
  });
}

export function MemoryDiagnostics(): null {
  const store = useDocumentStoreApi();
  useEffect(() => {
    const build =
      [...document.querySelectorAll<HTMLScriptElement>("script[src]")]
        .map((script) => new URL(script.src).pathname)
        .find((path) => /\/assets\/index-[^/]+\.js$/.test(path)) ?? "development";
    const recorder = new MemoryRecorder(build);
    activeRecorder = recorder;
    const previous = readSavedMemoryReport("incident");
    if (previous) {
      toast.info("A memory diagnostics report from an earlier session is available.", {
        id: "memory-diagnostics-previous",
        duration: 15000,
        action: { label: "Download saved report", onClick: () => downloadMemoryReport(previous) },
      });
    }
    let lastCheckpoint = Date.now();
    const sample = (): void => {
      const incident = recorder.sample(readMemorySample(store.getState()));
      if (incident) {
        saveMemoryReport(incident);
        notifyIncident(incident);
      } else if (Date.now() - lastCheckpoint >= 60000) {
        saveMemoryReport(recorder.report("checkpoint"));
        lastCheckpoint = Date.now();
      }
    };
    const checkpoint = (): void => {
      saveMemoryReport(recorder.report("checkpoint"));
    };
    const visibilityChanged = (): void => {
      recorder.mark(document.hidden ? "hidden" : "visible");
      checkpoint();
    };
    const unsubscribePlayback = subscribePlaybackStatus((status) => recorder.mark(status));
    sample();
    const timer = setInterval(sample, 10000);
    window.addEventListener("pagehide", checkpoint);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      clearInterval(timer);
      unsubscribePlayback();
      window.removeEventListener("pagehide", checkpoint);
      document.removeEventListener("visibilitychange", visibilityChanged);
      if (activeRecorder === recorder) activeRecorder = null;
    };
  }, [store]);
  return null;
}

export function MemoryDiagnosticsSettings() {
  return (
    <>
      <SettingsRow
        label="Memory diagnostics"
        description="Download a bounded history of memory estimates and editor counters, without score contents. Nothing is uploaded."
      >
        {({ controlId, descriptionId }) => (
          <Button
            id={controlId}
            aria-label="Download diagnostics"
            aria-describedby={descriptionId}
            onClick={() => {
              if (activeRecorder) downloadMemoryReport(activeRecorder.report("manual"));
              else toast.error("Memory diagnostics are not running.");
            }}
          >
            Download diagnostics
          </Button>
        )}
      </SettingsRow>
      <SettingsRow
        label="Saved memory report"
        description="Download the last warning report, or the latest periodic checkpoint if no warning was captured."
      >
        {({ controlId, descriptionId }) => (
          <Button
            id={controlId}
            aria-label="Download saved report"
            aria-describedby={descriptionId}
            onClick={() => {
              const saved = readSavedMemoryReport();
              if (saved) downloadMemoryReport(saved);
              else toast.info("No saved memory diagnostics report is available yet.");
            }}
          >
            Download saved report
          </Button>
        )}
      </SettingsRow>
    </>
  );
}
