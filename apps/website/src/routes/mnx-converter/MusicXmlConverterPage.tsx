import { useCallback, useRef, useState } from "react";
import { UnsupportedFeaturesPanel } from "./UnsupportedFeaturesPanel";
import {
  ConverterNotice,
  DownloadBar,
  DropZone,
  ErrorDisplay,
  FileListSection,
  OptionsBar,
  PageHeader,
  ResultContent,
  ResultTabs,
} from "./converterSections";
import type { TabId } from "./converterTypes";
import { usePreloadOnInteraction, useConverterFiles } from "./useConverterFiles";

export function MusicXmlConverterPage() {
  const [activeTab, setActiveTab] = useState<TabId>("preview");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  usePreloadOnInteraction();

  const {
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
    dismissNotice,
  } = useConverterFiles();

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const chooseFiles = () => fileInputRef.current?.click();

  return (
    <div className="converter-route">
      <div className="app-container">
        <PageHeader onChooseFiles={chooseFiles} />

        <DropZone
          dragOver={dragOver}
          onClick={chooseFiles}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        />
        <input
          ref={fileInputRef}
          type="file"
          className="file-input"
          accept=".musicxml,.xml,.mxl"
          multiple
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />

        <OptionsBar
          includeVendorExt={includeVendorExt}
          onToggleVendorExt={setIncludeVendorExt}
          discardStems={discardStems}
          onToggleDiscardStems={setDiscardStems}
          hideMetronome={hideMetronome}
          onToggleHideMetronome={setHideMetronome}
          staleCount={staleFiles.length}
          converting={converting}
          onReconvertStale={() => reconvertAll(true)}
        />

        <UnsupportedFeaturesPanel />

        {files.length > 0 && (
          <FileListSection
            files={files}
            selectedIndex={selectedIndex}
            successCount={successCount}
            errorCount={errorCount}
            converting={converting}
            onSelect={setSelectedIndex}
            onRemove={removeFile}
            onClearAll={clearAll}
          />
        )}

        {selected && selected.status === "success" && selected.result && (
          <div className="result-panel">
            <ResultTabs
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              diagnosticsCount={selected.diagnostics.length}
            />
            <div className="result-content">
              <ResultContent activeTab={activeTab} selected={selected} parsedScore={parsedScore} />
            </div>
          </div>
        )}

        {selected && selected.status === "error" && <ErrorDisplay selected={selected} />}

        {notice && <ConverterNotice message={notice} onDismiss={dismissNotice} />}

        {successCount > 0 && (
          <DownloadBar
            successCount={successCount}
            selected={selected}
            includeVendorExt={includeVendorExt}
            discardStems={discardStems}
            hideMetronome={hideMetronome}
            onOpenInViritura={openInViritura}
            onDownloadSingle={downloadSingle}
            onDownloadAll={downloadAll}
          />
        )}
      </div>
    </div>
  );
}
