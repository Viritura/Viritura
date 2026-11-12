import { toast } from "sonner";
import { isIncidentReason, type MemoryReport } from "./recorder";

const CHECKPOINT_KEY = "viritura.memoryCheckpoint";
const INCIDENT_KEY = "viritura.memoryIncident";
const MAX_REPORT_CHARACTERS = 128 * 1024;
let storageWarningShown = false;

function storageFailure(error: unknown): void {
  console.warn("[MemoryDiagnostics] Local report storage is unavailable:", error);
  if (!storageWarningShown) {
    storageWarningShown = true;
    toast.warning("Memory diagnostics cannot be saved locally. You can still download the current report.");
  }
}

export function saveMemoryReport(report: MemoryReport): void {
  try {
    const text = JSON.stringify(report);
    if (text.length > MAX_REPORT_CHARACTERS) throw new Error("Memory report exceeded the local storage limit");
    localStorage.setItem(CHECKPOINT_KEY, text);
    if (isIncidentReason(report.reason)) {
      localStorage.setItem(INCIDENT_KEY, text);
    }
  } catch (error) {
    storageFailure(error);
  }
}

export function readSavedMemoryReport(kind: "incident" | "latest" = "latest"): string | null {
  try {
    const text =
      localStorage.getItem(INCIDENT_KEY) ?? (kind === "latest" ? localStorage.getItem(CHECKPOINT_KEY) : null);
    if (text !== null && text.length > MAX_REPORT_CHARACTERS) {
      throw new Error("Saved memory report exceeded the local storage limit");
    }
    return text;
  } catch (error) {
    storageFailure(error);
    return null;
  }
}

export function downloadMemoryReport(report: MemoryReport | string): void {
  try {
    const text = typeof report === "string" ? report : JSON.stringify(report, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "viritura-memory-diagnostics.json";
      document.body.appendChild(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    console.error("[MemoryDiagnostics] Report download failed:", error);
    toast.error("Could not download memory diagnostics. Please try again.");
  }
}
