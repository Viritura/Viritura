import { useCallback, useEffect, useMemo, useState } from "react";
import { convertMusicXmlToMnx, convertMxlToMnx, DiagnosticCollector } from "@viritura/musicxml";
import type { MnxDocument, ConvertOptions } from "@viritura/musicxml";
import { buildHandoffUrl } from "@viritura/core";
import { parseMnx } from "@viritura/format";
import { preloadWasmEngine } from "./preloadWasmEngine";
import { type ConvertedFile, links } from "./converterTypes";

export function usePreloadOnInteraction(): void {
  useEffect(() => {
    const handler = () => {
      preloadWasmEngine();
      window.removeEventListener("click", handler);
      window.removeEventListener("dragover", handler);
      window.removeEventListener("keydown", handler);
    };
    window.addEventListener("click", handler, { once: true });
    window.addEventListener("dragover", handler, { once: true });
    window.addEventListener("keydown", handler, { once: true });
    return () => {
      window.removeEventListener("click", handler);
      window.removeEventListener("dragover", handler);
      window.removeEventListener("keydown", handler);
    };
  }, []);
}

function isValidExtension(name: string): boolean {
  const ext = name.toLowerCase();
  return ext.endsWith(".musicxml") || ext.endsWith(".xml") || ext.endsWith(".mxl");
}

/** Whether a converted file's cached options match the current toggle state. */
function optionsMatch(f: ConvertedFile, vendorExt: boolean, discardStems: boolean, hideMetronome: boolean): boolean {
  return f.vendorExtUsed === vendorExt && f.discardStemsUsed === discardStems && f.hideMetronomeUsed === hideMetronome;
}

async function convertOneFile(file: File, opts: ConvertOptions): Promise<MnxDocument> {
  if (file.name.toLowerCase().endsWith(".mxl")) {
    const buffer = await file.arrayBuffer();
    // Pre-validate ZIP magic bytes (PK\003\004) so a misnamed text file
    // surfaces a clear error rather than a noisy JSZip stack trace.
    if (buffer.byteLength < 4) {
      throw new Error("File is too small to be a valid .mxl archive.");
    }
    const head = new Uint8Array(buffer, 0, 4);
    if (!(head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07))) {
      throw new Error(
        "Not a valid .mxl archive (missing ZIP signature). " +
          "If this is uncompressed MusicXML, rename the file to .musicxml.",
      );
    }
    return await convertMxlToMnx(buffer, opts);
  }
  const text = await file.text();
  return convertMusicXmlToMnx(text, opts);
}

// eslint-disable-next-line max-lines-per-function -- single cohesive orchestration surface (file state + conversion + staleness + download/handoff); no sub-concept seam splits cleanly without container/presenter ceremony
export function useConverterFiles() {
  const [files, setFiles] = useState<ConvertedFile[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [converting, setConverting] = useState(false);
  const [includeVendorExt, setIncludeVendorExt] = useState(false);
  const [discardStems, setDiscardStems] = useState(false);
  const [hideMetronome, setHideMetronome] = useState(false);
  /** One-off message shown in the page (e.g. a handoff that had to fall back
   *  to a download). Cleared on the next successful handoff. */
  const [notice, setNotice] = useState<string | null>(null);

  const processFile = useCallback(
    async (file: File): Promise<ConvertedFile> => {
      const dx = new DiagnosticCollector();
      const entry: ConvertedFile = {
        source: file,
        name: file.name,
        size: file.size,
        result: null,
        error: null,
        status: "converting",
        diagnostics: [],
        vendorExtUsed: includeVendorExt,
        discardStemsUsed: discardStems,
        hideMetronomeUsed: hideMetronome,
      };
      try {
        const result = await convertOneFile(file, {
          includeVendorExtensions: includeVendorExt,
          discardStemDirections: discardStems,
          hideMetronomeWhenTempoText: hideMetronome,
          diagnostics: dx,
        });
        return { ...entry, result, status: "success", diagnostics: dx.all() };
      } catch (err) {
        return {
          ...entry,
          error: err instanceof Error ? err.message : String(err),
          status: "error",
          diagnostics: dx.all(),
        };
      }
    },
    [includeVendorExt, discardStems, hideMetronome],
  );

  const handleFiles = useCallback(
    async (incoming: FileList | File[]) => {
      const validFiles = Array.from(incoming).filter((f) => isValidExtension(f.name));
      if (validFiles.length === 0) return;

      const pending: ConvertedFile[] = validFiles.map((f) => ({
        source: f,
        name: f.name,
        size: f.size,
        result: null,
        error: null,
        status: "pending" as const,
        diagnostics: [],
        vendorExtUsed: includeVendorExt,
        discardStemsUsed: discardStems,
        hideMetronomeUsed: hideMetronome,
      }));

      // Capture startIdx via the functional updater so concurrent uploads
      // don't compute a stale insertion index from a stale `files` closure.
      let startIdx = 0;
      setFiles((prev) => {
        startIdx = prev.length;
        return [...prev, ...pending];
      });
      setConverting(true);

      for (let i = 0; i < validFiles.length; i++) {
        setFiles((prev) => {
          const copy = [...prev];
          if (copy[startIdx + i]) copy[startIdx + i] = { ...copy[startIdx + i]!, status: "converting" };
          return copy;
        });

        const result = await processFile(validFiles[i]!);

        setFiles((prev) => {
          const copy = [...prev];
          copy[startIdx + i] = result;
          return copy;
        });
      }

      setSelectedIndex(startIdx);
      setConverting(false);
    },
    [includeVendorExt, discardStems, hideMetronome, processFile],
  );

  const removeFile = useCallback(
    (idx: number) => {
      setFiles((prev) => prev.filter((_, i) => i !== idx));
      if (selectedIndex >= idx && selectedIndex > 0) {
        setSelectedIndex(selectedIndex - 1);
      }
    },
    [selectedIndex],
  );

  const clearAll = useCallback(() => {
    setFiles([]);
    setSelectedIndex(0);
  }, []);

  const downloadSingle = useCallback((file: ConvertedFile) => {
    if (!file.result) return;
    const json = JSON.stringify(file.result, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name.replace(/\.(musicxml|xml|mxl)$/i, ".mnx");
      a.click();
    } finally {
      // Always revoke the blob URL even if anchor click throws.
      URL.revokeObjectURL(url);
    }
  }, []);

  /** Encode the converted MNX into a URL fragment and navigate to the editor.
   *  Fragments are not sent to servers, work cross-origin, and survive any
   *  cross-SPA boundary without needing same-origin storage. The editor
   *  reads `#h=...` on boot and bootstraps a standalone score.
   *  We can't carry the FSA file handle across SPAs, so the user will be
   *  re-prompted for a save location the first time they hit Ctrl+S. */
  const openInViritura = useCallback(
    (file: ConvertedFile) => {
      if (!file.result) return;
      const url = buildHandoffUrl(links.app, {
        v: 1,
        ts: new Date().toISOString(),
        fileName: file.name.replace(/\.(musicxml|xml|mxl)$/i, ".mnx"),
        sourceName: file.name,
        json: JSON.stringify(file.result),
      });
      if (!url) {
        // The handoff travels in the URL, so an oversized score can't go that
        // way. Say so in the page and fall back to a download — a native alert
        // would block the thread and can be suppressed by the browser, which
        // would leave the download looking unexplained.
        setNotice(
          `“${file.name}” is too large to open directly in the editor. ` +
            `It has been downloaded instead — open it from the editor's File menu.`,
        );
        downloadSingle(file);
        return;
      }
      setNotice(null);
      window.location.href = url;
    },
    [downloadSingle],
  );

  const downloadAll = useCallback(() => {
    const successful = files.filter((f) => f.status === "success");
    for (const file of successful) downloadSingle(file);
  }, [files, downloadSingle]);

  const selected = files[selectedIndex] ?? null;
  const successCount = useMemo(() => files.filter((f) => f.status === "success").length, [files]);
  const errorCount = useMemo(() => files.filter((f) => f.status === "error").length, [files]);

  /** Parse the converted MNX into a Score so the playback engine can
   *  generate a timeline from it. Memoized on the result reference. */
  const parsedScore = useMemo(() => {
    if (!selected?.result) return null;
    try {
      return parseMnx(selected.result as unknown as object);
    } catch {
      return null;
    }
  }, [selected?.result]);

  /** Files whose cached result was produced with a different option set
   *  than the current toggles. */
  const staleFiles = useMemo(
    () =>
      files.filter((f) => f.status === "success" && !optionsMatch(f, includeVendorExt, discardStems, hideMetronome)),
    [files, includeVendorExt, discardStems, hideMetronome],
  );

  /** Re-convert every file (or just the stale ones) with the current
   *  import settings. */
  const reconvertAll = useCallback(
    async (onlyStale: boolean) => {
      const indices: number[] = [];
      files.forEach((f, i) => {
        if (!f.source) return;
        if (onlyStale && f.status === "success" && optionsMatch(f, includeVendorExt, discardStems, hideMetronome))
          return;
        indices.push(i);
      });
      if (indices.length === 0) return;
      setConverting(true);
      for (const i of indices) {
        setFiles((prev) => {
          const copy = [...prev];
          if (copy[i]) copy[i] = { ...copy[i]!, status: "converting" };
          return copy;
        });
        const file = files[i]!.source;
        const result = await processFile(file);
        setFiles((prev) => {
          const copy = [...prev];
          copy[i] = result;
          return copy;
        });
      }
      setConverting(false);
    },
    [files, includeVendorExt, discardStems, hideMetronome, processFile],
  );

  return {
    files,
    selectedIndex,
    setSelectedIndex,
    converting,
    includeVendorExt,
    setIncludeVendorExt,
    discardStems,
    setDiscardStems,
    hideMetronome,
    setHideMetronome,
    selected,
    successCount,
    errorCount,
    parsedScore,
    staleFiles,
    handleFiles,
    removeFile,
    clearAll,
    downloadSingle,
    downloadAll,
    openInViritura,
    reconvertAll,
    notice,
    dismissNotice: () => setNotice(null),
  };
}
