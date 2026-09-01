import type React from "react";
import type { CSSProperties } from "react";
import type { parseMnx } from "@viritura/format";
import { PlaybackProvider, TransportBar } from "@viritura/playback";
import { Tooltip } from "@viritura/ui";
import { MonacoMnxViewer } from "./MonacoMnxViewer";
import { MnxPreview } from "./MnxPreview";
import { ValidationPanel } from "./ValidationPanel";
import { ImportDiagnosticsPanel } from "./ImportDiagnosticsPanel";
import { type ConvertedFile, type TabId, formatSize } from "./converterTypes";

const MARGIN_LEFT_AUTO_STYLE: CSSProperties = { marginLeft: "auto" };
const FLEX_COL_FULL_STYLE: CSSProperties = { display: "flex", flexDirection: "column", height: "100%" };
const PREVIEW_FILL_STYLE: CSSProperties = { flex: 1, minHeight: 0 };
function progressBarStyle(successCount: number, errorCount: number, total: number): CSSProperties {
  return { width: `${((successCount + errorCount) / total) * 100}%` };
}

export function PageHeader() {
  return (
    <div className="page-header">
      <div className="page-header-copy">
        <h1>MusicXML to MNX</h1>
        <p>Convert MusicXML and compressed MXL files to MNX in your browser. Your files stay on your device.</p>
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
      <span className="drop-zone-kicker">Source files</span>
      <div className="drop-zone-icon" aria-hidden="true">
        XML <span>→</span> MNX
      </div>
      <h2>Drop scores here</h2>
      <p>Choose one score or convert a batch. Nothing is uploaded.</p>
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
    <section className="converter-options" aria-labelledby="conversion-settings-title">
      <div className="converter-options-header">
        <span className="converter-section-kicker">Output</span>
        <h2 id="conversion-settings-title">Conversion settings</h2>
        <p>Choose how source-specific notation should carry into the MNX document.</p>
      </div>
      <div className="converter-options-list">
        <label className="toggle-label">
          <span className="toggle-copy">
            <strong>Viritura extensions</strong>
            <span>
              {includeVendorExt
                ? "Preserve supported Viritura-only notation details."
                : "Create strict MNX and report details that cannot be preserved."}
            </span>
          </span>
          <input type="checkbox" checked={includeVendorExt} onChange={(e) => onToggleVendorExt(e.target.checked)} />
          <span className={`toggle-switch ${includeVendorExt ? "is-on" : ""}`} />
        </label>
        <label className="toggle-label">
          <span className="toggle-copy">
            <strong>Recompute stem directions</strong>
            <span>
              {discardStems
                ? "Let Viritura compute stems from voice and pitch."
                : "Keep explicit stem directions from the source."}
            </span>
          </span>
          <input type="checkbox" checked={discardStems} onChange={(e) => onToggleDiscardStems(e.target.checked)} />
          <span className={`toggle-switch ${discardStems ? "is-on" : ""}`} />
        </label>
        <label className="toggle-label">
          <span className="toggle-copy">
            <strong>Prefer written tempo text</strong>
            <span>
              {hideMetronome
                ? "Keep bpm for playback without engraving the metronome mark."
                : "Show the numeric metronome mark from the source."}
            </span>
          </span>
          <input type="checkbox" checked={hideMetronome} onChange={(e) => onToggleHideMetronome(e.target.checked)} />
          <span className={`toggle-switch ${hideMetronome ? "is-on" : ""}`} />
        </label>
      </div>
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
    </section>
  );
}

function fileStatusIcon(status: ConvertedFile["status"]): React.ReactNode {
  if (status === "converting") return <span className="spinner" />;
  return <span className={`file-status-mark ${status}`} aria-hidden="true" />;
}

function fileStatusText(status: ConvertedFile["status"]): React.ReactNode {
  if (status === "success") return <span className="file-status-text success">Ready</span>;
  if (status === "error") return <span className="file-status-text error">Failed</span>;
  if (status === "converting") return <span className="file-status-text pending">Converting...</span>;
  return <span className="file-status-text pending">Pending</span>;
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
        {fileStatusText(file.status)}
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
          {errorCount > 0 && <span className="file-count-error">{errorCount} failed</span>}
        </h3>
        <div className="file-list-actions">
          <button type="button" className="file-list-clear" onClick={onClearAll}>
            Clear files
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
        <div className="validation-summary invalid">Conversion failed for {selected.name}</div>
        <div className="validation-error">
          <div className="validation-error-message">{selected.error}</div>
        </div>
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
  readonly onDownloadSingle: (f: ConvertedFile) => void;
  readonly onDownloadAll: () => void;
}

export function DownloadBar({
  successCount,
  selected,
  includeVendorExt,
  discardStems,
  hideMetronome,
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
          <button className="btn btn-sm btn-primary" onClick={() => onDownloadSingle(selected)}>
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
