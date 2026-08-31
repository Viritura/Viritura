import type { BeforeMount } from "@monaco-editor/react";
import { configureMnxDiagnostics } from "../../mnx-schema";

export const PLAYGROUND_MODEL_PATH = "file:///playground.mnx";

export const configurePlaygroundEditor: BeforeMount = (monaco) => {
  configureMnxDiagnostics(monaco);
};

export function formatMnxSource(source: string): string {
  return JSON.stringify(JSON.parse(source) as unknown, null, 2);
}

export function downloadMnxSource(source: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([source], { type: "application/mnx+json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".mnx") ? filename : `${filename}.mnx`;
  link.click();
  URL.revokeObjectURL(url);
}
