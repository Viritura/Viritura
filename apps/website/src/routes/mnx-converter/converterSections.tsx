import type React from "react";
import type { CSSProperties } from "react";
import type { parseMnx } from "@viritura/format";
import { PlaybackProvider, TransportBar } from "@viritura/playback";
import { Tooltip } from "@viritura/ui";
import { MonacoMnxViewer } from "./MonacoMnxViewer";
import { MnxPreview } from "./MnxPreview";
import { ValidationPanel } from "./ValidationPanel";
import { ImportDiagnosticsPanel } from "./ImportDiagnosticsPanel";
import { type ConvertedFile, type TabId, formatSize, links } from "./converterTypes";

const MARGIN_LEFT_AUTO_STYLE: CSSProperties = { marginLeft: "auto" };
const FLEX_COL_FULL_STYLE: CSSProperties = { display: "flex", flexDirection: "column", height: "100%" };
const PREVIEW_FILL_STYLE: CSSProperties = { flex: 1, minHeight: 0 };
function progressBarStyle(successCount: number, errorCount: number, total: number): CSSProperties {
  return { width: `${((successCount + errorCount) / total) * 100}%` };
}

interface PageHeaderProps {
  readonly onChooseFiles: () => void;
}

export function PageHeader({ onChooseFiles }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div className="page-header-copy">
        <span className="eyebrow">Import workbench</span>
        <h1>Bring existing scores into Viritura.</h1>
        <p>
          Drop MusicXML or compressed MXL files, inspect what carried across, preview the score, then open the converted
          file in the editor.
        </p>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={onChooseFiles}>
            Choose files
          </button>
          <a href={links.app} className="btn btn-secondary">
            Open Editor
          </a>
        </div>
      </div>
      <div className="import-summary" aria-label="Conversion workflow">
        <div>
          <strong>1</strong>
          <span>Upload MusicXML</span>
        </div>
        <div>
          <strong>2</strong>
          <span>Preview and validate</span>
        </div>
        <div>
          <strong>3</strong>
          <span>Continue in Viritura</span>
        </div>
      </div>
    </div>
  );
}

interface DropZoneProps {
  readonly dragOver: boolean;
  readonly onClick: () => void;
  readonly onDrop: (e: React.DragEvent) => void;
  readonly onDragOver: (e: React.DragEvent) => void;
  readonly onDragLeave: () => void;
}

export function DropZone({ dragOver, onClick, onDrop, onDragOver, onDragLeave }: DropZoneProps) {
  return (
    <div
      className={`drop-zone ${dragOver ? "drag-over" : ""}`}
      onClick={onClick}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      <div className="drop-zone-icon">MusicXML</div>
      <h3>Drop scores here</h3>
      <p>Batch convert files, then review each result before opening it in Viritura.</p>
      <div className="drop-zone-formats">
        <span className="format-badge">.musicxml</span>
        <span className="format-badge">.xml</span>
        <span className="format-badge">.mxl</span>
      </div>
    </div>
  );
}

interface OptionsBarProps {
  readonly includeVendorExt: boolean;
  readonly onToggleVendorExt: (v: boolean) => void;
  readonly discardStems: boolean;
  readonly onToggleDiscardStems: (v: boolean) => void;
  readonly hideMetronome: boolean;
  readonly onToggleHideMetronome: (v: boolean) => void;
  readonly staleCount: number;
  readonly converting: boolean;
  readonly onReconvertStale: () => void;
}

export function OptionsBar({
  includeVendorExt,
  onToggleVendorExt,
  discardStems,
  onToggleDiscardStems,
  hideMetronome,
  onToggleHideMetronome,
  staleCount,
  converting,
  onReconvertStale,
}: OptionsBarProps) {
  return (
    <div className="converter-options">
      <label className="toggle-label">
        <input type="checkbox" checked={includeVendorExt} onChange={(e) => onToggleVendorExt(e.target.checked)} />
        <span className="toggle-switch" />
        <span>Include Viritura vendor extensions</span>
      </label>
      <span className="toggle-hint">
        {includeVendorExt
          ? "Preserve supported Viritura-only notation details in the converted file."
          : "Create strict MNX output and report details that could not be preserved."}
      </span>
      <label className="toggle-label">
        <input type="checkbox" checked={discardStems} onChange={(e) => onToggleDiscardStems(e.target.checked)} />
        <span className="toggle-switch" />
        <span>Discard explicit stem directions</span>
      </label>
      <span className="toggle-hint">
        {discardStems
          ? "Ignore per-note stem directions so Viritura computes them from voice and pitch."
          : "Keep per-note stem directions exactly as authored in the source file."}
      </span>
      <label className="toggle-label">
        <input type="checkbox" checked={hideMetronome} onChange={(e) => onToggleHideMetronome(e.target.checked)} />
        <span className="toggle-switch" />
        <span>Hide metronome mark when tempo text is present</span>
      </label>
      <span className="toggle-hint">
        {hideMetronome
          ? "Engrave the written tempo text alone and keep the bpm for playback — the convention for text-only repertoire."
          : "Show the numeric metronome mark exactly as authored in the source file."}
      </span>
      {staleCount > 0 && (
        <Tooltip content={`${staleCount} file(s) were converted with the previous setting. Click to re-run.`}>
          <button
            className="btn btn-sm btn-secondary"
            style={MARGIN_LEFT_AUTO_STYLE}
            onClick={onReconvertStale}
            disabled={converting}
          >
            Re-convert {staleCount} file{staleCount === 1 ? "" : "s"}
          </button>
        </Tooltip>
      )}
    </div>
  );
}

function fileStatusIcon(status: ConvertedFile["status"]): React.ReactNode {
  if (status === "converting") return <span className="spinner" />;
  if (status === "success") return "✅";
  if (status === "error") return "❌";
  return "📄";
}

function fileStatusBadge(status: ConvertedFile["status"]): React.ReactNode {
  if (status === "success") return <span className="status-badge success">Converted</span>;
  if (status === "error") return <span className="status-badge error">Failed</span>;
  if (status === "converting") return <span className="status-badge pending">Converting...</span>;
  return <span className="status-badge pending">Pending</span>;
}

interface FileListRowProps {
  readonly file: ConvertedFile;
  readonly index: number;
  readonly active: boolean;
  readonly onSelect: (i: number) => void;
  readonly onRemove: (i: number) => void;
}

function FileListRow({ file, index, active, onSelect, onRemove }: FileListRowProps) {
  return (
    <div className={`file-item ${active ? "active" : ""}`} onClick={() => onSelect(index)}>
      <span className="file-item-icon">{fileStatusIcon(file.status)}</span>
      <div className="file-item-info">
        <div className="file-item-name">{file.name}</div>
        <div className="file-item-meta">
          {formatSize(file.size)}
          {file.result &&
            ` · ${file.result.parts?.length ?? 0} parts · ${file.result.global?.measures?.length ?? 0} measures`}
        </div>
      </div>
      <div className="file-item-status">
        {fileStatusBadge(file.status)}
        <Tooltip content="Remove">
          <button
            className="remove-btn"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(index);
            }}
          >
            ×
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

interface FileListSectionProps {
  readonly files: readonly ConvertedFile[];
  readonly selectedIndex: number;
  readonly successCount: number;
  readonly errorCount: number;
  readonly converting: boolean;
  readonly onSelect: (i: number) => void;
  readonly onRemove: (i: number) => void;
  readonly onClearAll: () => void;
}

export function FileListSection({
  files,
  selectedIndex,
  successCount,
  errorCount,
  converting,
  onSelect,
  onRemove,
  onClearAll,
}: FileListSectionProps) {
  return (
    <div className="file-list">
      <div className="file-list-header">
        <h3>
          {files.length} file{files.length !== 1 ? "s" : ""}
          {successCount > 0 && <span className="file-count-success">{successCount} converted</span>}
          {errorCount > 0 && <span className="file-count-error">{errorCount} failed</span>}
        </h3>
        <div className="file-list-actions">
          <button className="btn btn-sm btn-danger" onClick={onClearAll}>
            Clear All
          </button>
        </div>
      </div>
      {files.map((file, idx) => (
        <FileListRow
          key={`${file.name}-${idx}`}
          file={file}
          index={idx}
          active={idx === selectedIndex}
          onSelect={onSelect}
          onRemove={onRemove}
        />
      ))}
      {converting && (
        <div className="progress-bar">
          <div className="progress-fill" style={progressBarStyle(successCount, errorCount, files.length)} />
        </div>
      )}
    </div>
  );
}

interface ResultTabsProps {
  readonly activeTab: TabId;
  readonly setActiveTab: (t: TabId) => void;
  readonly diagnosticsCount: number;
}

export function ResultTabs({ activeTab, setActiveTab, diagnosticsCount }: ResultTabsProps) {
  return (
    <div className="result-tabs">
      <button
        className={`result-tab ${activeTab === "preview" ? "active" : ""}`}
        onClick={() => setActiveTab("preview")}
      >
        Score Preview
      </button>
      <button
        className={`result-tab ${activeTab === "validation" ? "active" : ""}`}
        onClick={() => setActiveTab("validation")}
      >
        Validation
      </button>
      <button
        className={`result-tab ${activeTab === "diagnostics" ? "active" : ""}`}
        onClick={() => setActiveTab("diagnostics")}
      >
        Diagnostics
        {diagnosticsCount > 0 && <span className="result-tab-badge">{diagnosticsCount}</span>}
      </button>
      <button className={`result-tab ${activeTab === "mnx" ? "active" : ""}`} onClick={() => setActiveTab("mnx")}>
        MNX Output
      </button>
    </div>
  );
}

interface ResultContentProps {
  readonly activeTab: TabId;
  readonly selected: ConvertedFile;
  readonly parsedScore: ReturnType<typeof parseMnx> | null;
}

export function ResultContent({ activeTab, selected, parsedScore }: ResultContentProps) {
  if (!selected.result) return null;
  if (activeTab === "preview") {
    return (
      <PlaybackProvider score={parsedScore}>
        <div style={FLEX_COL_FULL_STYLE}>
          <div className="preview-transport">
            <TransportBar />
          </div>
          <div style={PREVIEW_FILL_STYLE}>
            <MnxPreview document={selected.result} />
          </div>
        </div>
      </PlaybackProvider>
    );
  }
  if (activeTab === "validation") return <ValidationPanel document={selected.result} />;
  if (activeTab === "diagnostics") return <ImportDiagnosticsPanel diagnostics={selected.diagnostics} />;
  return <MonacoMnxViewer data={selected.result} />;
}

interface ErrorDisplayProps {
  readonly selected: ConvertedFile;
}

export function ErrorDisplay({ selected }: ErrorDisplayProps) {
  return (
    <div className="result-panel">
      <div className="validation-panel">
        <div className="validation-summary invalid">❌ Conversion failed for {selected.name}</div>
        <div className="validation-error">
          <div className="validation-error-message">{selected.error}</div>
        </div>
      </div>
    </div>
  );
}

interface ConverterNoticeProps {
  readonly message: string;
  readonly onDismiss: () => void;
}

/**
 * A one-off in-page notice, used where the converter has to explain a fallback
 * it already performed. Replaces a native `alert()`: this stays on screen next
 * to the thing it describes instead of blocking the page.
 */
export function ConverterNotice({ message, onDismiss }: ConverterNoticeProps) {
  return (
    <div className="result-panel">
      <div className="validation-panel">
        <div className="validation-summary">{message}</div>
        <button type="button" className="btn btn-secondary" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

interface DownloadBarProps {
  readonly successCount: number;
  readonly selected: ConvertedFile | null;
  readonly includeVendorExt: boolean;
  readonly discardStems: boolean;
  readonly hideMetronome: boolean;
  readonly onOpenInViritura: (f: ConvertedFile) => void;
  readonly onDownloadSingle: (f: ConvertedFile) => void;
  readonly onDownloadAll: () => void;
}

export function DownloadBar({
  successCount,
  selected,
  includeVendorExt,
  discardStems,
  hideMetronome,
  onOpenInViritura,
  onDownloadSingle,
  onDownloadAll,
}: DownloadBarProps) {
  const selectedStale =
    selected?.status === "success" &&
    (selected.vendorExtUsed !== includeVendorExt ||
      selected.discardStemsUsed !== discardStems ||
      selected.hideMetronomeUsed !== hideMetronome);
  return (
    <div className="download-bar">
      <div className="download-info">
        {successCount} file{successCount !== 1 ? "s" : ""} ready
        {selectedStale && <span className="stale-warning">⚠ Selected file is stale (settings changed)</span>}
      </div>
      <div className="download-actions">
        {selected?.result && (
          <Tooltip content="Open the converted score in the Viritura editor for full preview, playback, and editing.">
            <button className="btn btn-sm btn-primary" onClick={() => onOpenInViritura(selected)}>
              Open in Viritura →
            </button>
          </Tooltip>
        )}
        {selected?.result && (
          <button className="btn btn-sm btn-secondary" onClick={() => onDownloadSingle(selected)}>
            Download .mnx
          </button>
        )}
        {successCount > 1 && (
          <button className="btn btn-sm btn-secondary" onClick={onDownloadAll}>
            Download All
          </button>
        )}
      </div>
    </div>
  );
}
