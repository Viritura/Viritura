/**
 * MnxPreview — score preview for the converter, powered by the
 * publishable @viritura/score-viewer-react package.
 *
 * Phase 7 rewrite: the old MnxPreview hand-rolled a viewport, paint loop,
 * and zoom controls. All of that now lives inside <ScoreViewer>.
 * What remains here:
 *   1. MNX sanitization fallback for documents the Rust parser rejects
 *      (some MusicXML imports produce vendor extensions or fields the
 *      strict parser refuses; we strip them as a recovery step).
 */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { MnxDocument } from "@viritura/musicxml";
import { ScoreViewer } from "@viritura/score-viewer-react";

const MNX_PREVIEW_ROOT_STYLE: CSSProperties = {
  position: "relative",
  height: "100%",
  minHeight: 0,
  overflow: "hidden",
  background: "#1e1e2e",
};
const MNX_PREVIEW_VIEWER_STYLE: CSSProperties = { background: "#1e1e2e" };
const MNX_PREVIEW_VIEWPORT_STYLE: CSSProperties = { padding: 20 };
const MNX_PREVIEW_LOADING_STYLE: CSSProperties = { color: "#a6adc8", padding: 24 };
const MNX_PREVIEW_ERROR_STYLE: CSSProperties = { color: "#f38ba8", padding: 24 };
function mnxPreviewBannerStyle(hasError: boolean): CSSProperties {
  return {
    position: "absolute",
    top: 12,
    right: 12,
    zIndex: 12,
    maxWidth: "min(520px, calc(100% - 24px))",
    padding: "6px 10px",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    borderRadius: 8,
    background: "rgba(24, 24, 36, 0.88)",
    color: hasError ? "#f38ba8" : "#f9e2af",
    fontSize: "var(--site-type-micro-size)",
    fontFamily: "system-ui, sans-serif",
    boxShadow: "0 10px 24px rgba(0, 0, 0, 0.24)",
  };
}

interface MnxPreviewProps {
  document: MnxDocument;
}

function sanitizeNotes(notes: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return notes.filter((n) => n.pitch != null);
}

function sanitizeContentItem(item: Record<string, unknown>): Record<string, unknown> {
  delete item._x;
  const notes = item.notes as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(notes)) {
    item.notes = sanitizeNotes(notes);
  }
  return item;
}

function sanitizeSequence(seq: Record<string, unknown>): void {
  const content = seq.content as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(content)) {
    seq.content = content.map(sanitizeContentItem);
  }
}

function sanitizeMeasure(m: Record<string, unknown>): void {
  delete m._x;
  const sequences = m.sequences as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(sequences)) {
    for (const seq of sequences) sanitizeSequence(seq);
  }
}

function sanitizePart(part: Record<string, unknown>): void {
  if (!part.id) part.id = "p-fallback";
  if (!Array.isArray(part.measures)) part.measures = [];
  const measures = part.measures as Array<Record<string, unknown>>;
  for (const m of measures) sanitizeMeasure(m);
}

/**
 * Strip fields that may cause the strict Rust serde parser to reject the
 * document. Vendor extensions, root-level _x, and partial pitch entries
 * are common offenders from MusicXML imports.
 */
function sanitizeForWasm(doc: MnxDocument): MnxDocument {
  const clone = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;

  const mnx = clone.mnx as Record<string, unknown> | undefined;
  if (mnx) {
    mnx.version = typeof mnx.version === "number" ? Math.floor(mnx.version) : 1;
  }
  delete clone._x;

  const parts = clone.parts as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(parts)) {
    for (const part of parts) sanitizePart(part);
  }
  return clone as unknown as MnxDocument;
}

export function MnxPreview({ document: doc }: MnxPreviewProps) {
  const [useSanitized, setUseSanitized] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset sanitization state when the document changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
    setUseSanitized(false);
    setWarning(null);
    setError(null);
  }, [doc]);

  // The MNX we feed to <ScoreView>: original first, sanitized on retry.
  const mnxToRender = useMemo(() => (useSanitized ? sanitizeForWasm(doc) : doc), [doc, useSanitized]);

  return (
    <div style={MNX_PREVIEW_ROOT_STYLE}>
      <ScoreViewer
        mnx={mnxToRender as unknown as object}
        pageWidth={980}
        defaultFitMode="width"
        defaultViewMode="page"
        availableViewModes={["page", "horizontal", "spread", "spread-horizontal"]}
        controls={{ viewMode: true, zoom: true, fit: true }}
        controlSurface="floating-status"
        enableCtrlWheelZoom
        maxZoom={3}
        zoomStep={0.1}
        style={MNX_PREVIEW_VIEWER_STYLE}
        viewportStyle={MNX_PREVIEW_VIEWPORT_STYLE}
        onError={(err) => {
          if (!useSanitized) {
            setUseSanitized(true);
            setWarning("Some features were simplified for preview");
          } else {
            setError(err.message);
          }
        }}
        onReady={() => {
          setError(null);
        }}
        loadingFallback={<div style={MNX_PREVIEW_LOADING_STYLE}>Loading score...</div>}
        errorFallback={(err) => (
          <div style={MNX_PREVIEW_ERROR_STYLE}>
            {useSanitized ? `Failed to render: ${err.message}` : "Preparing simplified preview..."}
          </div>
        )}
      />

      {(warning || error) && <div style={mnxPreviewBannerStyle(Boolean(error))}>{error ?? warning}</div>}
    </div>
  );
}
