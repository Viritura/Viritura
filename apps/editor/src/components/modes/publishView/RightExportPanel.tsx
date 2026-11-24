import { Download, Loader2, AlertCircle } from "lucide-react";
import { Button, Checkbox, FormInput, Panel, Radio, RadioGroup } from "@viritura/ui";
import styles from "../PublishView.module.css";
import type { CSSProperties } from "react";

const FLEX_COL_STYLE: CSSProperties = { display: "flex", flexDirection: "column" };
const DEST_COL_STYLE: CSSProperties = { display: "flex", flexDirection: "column", minWidth: 0 };
import type { FsDirectoryHandle } from "../../../publish/batchRender";
import type { BundleMode } from "./runPublishExport";
import { AudioQualitySelect, FormatSelect, Section } from "./FormatPickers";
import { isAudioFormat, type AudioQuality, type ExportFormat } from "./audioFormats";

const WAV_MEGABYTES_PER_MINUTE: Record<AudioQuality["wavBitDepth"], number> = { 16: 11, 24: 16, 32: 21 };

interface RightExportPanelProps {
  /** Panel positioning props — surfaced here so WorkspaceShell can detect
   * this wrapper as Panel-like and inject `shellStyle`. */
  side?: "right";
  width: number;
  onResize: (w: number) => void;
  exporting: boolean;
  scoreLoaded: boolean;
  orderedSelectedCount: number;
  format: ExportFormat;
  onFormatChange: (format: ExportFormat) => void;
  audioQuality: AudioQuality;
  onAudioQualityChange: (quality: AudioQuality) => void;

  bundleMode: BundleMode;
  onBundleModeChange: (mode: BundleMode) => void;

  folderSupported: boolean;
  exportFolder: FsDirectoryHandle | null;
  projectFolder: FsDirectoryHandle | null;
  onUseProjectFolder: () => void;
  onPickFolder: () => void;
  onClearFolder: () => void;

  filenamePattern: string;
  onFilenamePatternChange: (s: string) => void;

  embedMnx: boolean;
  onEmbedMnxChange: (v: boolean) => void;

  progress: { done: number; total: number; name: string } | null;
  statusMessage: { kind: "err"; text: string } | null;

  onExport: () => void;
  onCancelExport: () => void;
  /** Injected by WorkspaceShell via cloneElement — forward to inner Panel. */
  shellStyle?: CSSProperties;
}

export function RightExportPanel(props: RightExportPanelProps) {
  const {
    width,
    onResize,
    exporting,
    scoreLoaded,
    orderedSelectedCount,
    format,
    onFormatChange,
    audioQuality,
    onAudioQualityChange,
    bundleMode,
    onBundleModeChange,
    folderSupported,
    exportFolder,
    projectFolder,
    onUseProjectFolder,
    onPickFolder,
    onClearFolder,
    filenamePattern,
    onFilenamePatternChange,
    embedMnx,
    onEmbedMnxChange,
    progress,
    statusMessage,
    onExport,
    onCancelExport,
    shellStyle,
  } = props;

  return (
    <Panel
      side="right"
      width={width}
      onResize={onResize}
      min={300}
      max={600}
      shellStyle={shellStyle}
      title="Export"
      subtitle="Choose what to export and where it goes."
      scrollBody
      footer={
        <>
          <ProgressOrStatus exporting={exporting} progress={progress} statusMessage={statusMessage} format={format} />
          <div className={styles.exportButtonWrap}>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={onExport}
              disabled={!scoreLoaded || (format === "pdf" && orderedSelectedCount === 0) || exporting}
            >
              <Download size={18} />
              {isAudioFormat(format)
                ? `Export ${format.toUpperCase()}`
                : `Export ${orderedSelectedCount} layout${orderedSelectedCount === 1 ? "" : "s"}`}
              {exportFolder ? ` to "${exportFolder.name}"` : ""}
            </Button>
            {isAudioFormat(format) && exporting && (
              <Button size="sm" onClick={onCancelExport} label="Cancel export" disabled={progress?.done === 100} />
            )}
          </div>
        </>
      }
    >
      <Section label="Format">
        <FormatSelect value={format} onChange={onFormatChange} disabled={exporting} />
      </Section>

      {isAudioFormat(format) ? (
        <Section label="Audio">
          <AudioQualitySelect
            format={format}
            quality={audioQuality}
            onChange={onAudioQualityChange}
            disabled={exporting}
          />
          <div className={styles.fieldHint}>
            {format === "wav"
              ? `Stereo, 44.1 kHz, about ${WAV_MEGABYTES_PER_MINUTE[audioQuality.wavBitDepth]} MB/min. `
              : "Stereo, 44.1 kHz. "}
            {format === "mp3" && (
              <>
                {" "}
                <a
                  href="https://github.com/Viritura/Viritura/blob/main/THIRD_PARTY_NOTICES.md#mp3-encoding"
                  target="_blank"
                  rel="noreferrer"
                >
                  MP3 encoder licenses
                </a>
              </>
            )}
          </div>
        </Section>
      ) : (
        <Section label="Bundle">
          <RadioGroup
            value={bundleMode}
            onChange={(v) => onBundleModeChange(v as typeof bundleMode)}
            disabled={exporting}
          >
            <Radio value="zip" variant="card" label="ZIP archive" description="One ZIP containing all PDFs" />
            {exportFolder && (
              <Radio
                value="separate"
                variant="card"
                label="Separate files"
                description="One PDF per layout, saved directly to the folder"
              />
            )}
            <Radio
              value="single-pdf"
              variant="card"
              label="Single PDF"
              description="Concatenate every layout into one PDF"
            />
          </RadioGroup>
          {!exportFolder && (
            <div className={styles.fieldHint}>
              Downloads use one ZIP or PDF to avoid browser limits on multiple downloads.
            </div>
          )}
        </Section>
      )}

      <Section label="Destination">
        <DestinationRow
          folderSupported={folderSupported}
          exportFolder={exportFolder}
          projectFolder={projectFolder}
          onUseProjectFolder={onUseProjectFolder}
          exporting={exporting}
          onPickFolder={onPickFolder}
          onClearFolder={onClearFolder}
        />
      </Section>

      <Section label="Filename">
        <FormInput
          aria-label="Filename pattern"
          className={styles.inputField}
          value={filenamePattern}
          onChange={(e) => onFilenamePatternChange(e.target.value)}
          disabled={exporting}
        />
        <div className={styles.fieldHint}>
          {isAudioFormat(format) ? (
            <>
              Tokens: <code>%TITLE%</code> (document title), <code>%PART%</code> (Full Score),{" "}
              <code>%PART_NUMBER%</code> (All). The extension is added automatically.
            </>
          ) : (
            <>
              Tokens: <code>%TITLE%</code> (document title), <code>%PART%</code> (layout name),{" "}
              <code>%PART_NUMBER%</code> (padded score-order position). Scores are numbered first; unselected layouts
              still count. ZIP and combined PDF filenames use “All” for the number. The extension is added
              automatically.
            </>
          )}
        </div>
      </Section>

      {format === "pdf" && (
        <Section label="Options">
          <Checkbox
            checked={embedMnx}
            onChange={(e) => onEmbedMnxChange(e.target.checked)}
            disabled={exporting}
            label={
              <div style={FLEX_COL_STYLE}>
                <span className={styles.radioRowTitle}>Embed MNX source</span>
                <span className={styles.radioRowDesc}>Attach the MNX JSON inside each PDF for round-trip.</span>
              </div>
            }
          />
        </Section>
      )}
    </Panel>
  );
}

interface DestinationRowProps {
  folderSupported: boolean;
  exportFolder: FsDirectoryHandle | null;
  projectFolder: FsDirectoryHandle | null;
  onUseProjectFolder: () => void;
  exporting: boolean;
  onPickFolder: () => void;
  onClearFolder: () => void;
}

function DestinationRow({
  folderSupported,
  exportFolder,
  projectFolder,
  onUseProjectFolder,
  exporting,
  onPickFolder,
  onClearFolder,
}: DestinationRowProps) {
  if (!folderSupported && !projectFolder && !exportFolder) {
    return (
      <div className={styles.destinationRow}>
        <div style={DEST_COL_STYLE}>
          <span className={styles.destinationName}>Browser downloads</span>
          <span className={styles.destinationHint}>Folder picking requires a Chromium-based browser.</span>
        </div>
      </div>
    );
  }
  if (exportFolder) {
    return (
      <div className={styles.destinationRow}>
        <div style={DEST_COL_STYLE}>
          <span className={styles.destinationName}>{exportFolder.name}</span>
          <span className={styles.destinationHint}>
            Files will be written here. Existing files with the same names will be replaced.
          </span>
        </div>
        <div className={styles.destinationBtns}>
          {projectFolder && exportFolder !== projectFolder && (
            <Button size="sm" onClick={onUseProjectFolder} disabled={exporting} label="Use project folder" />
          )}
          {folderSupported && <Button size="sm" onClick={onPickFolder} disabled={exporting} label="Change" />}
          <Button size="sm" onClick={onClearFolder} disabled={exporting} label="Clear" />
        </div>
      </div>
    );
  }
  return (
    <div className={styles.destinationRow}>
      <div style={DEST_COL_STYLE}>
        <span className={styles.destinationName}>Browser downloads</span>
        <span className={styles.destinationHint}>
          {projectFolder
            ? `Save directly to "${projectFolder.name}", or choose another folder.`
            : "Pick a folder to write files directly without download prompts."}
        </span>
      </div>
      <div className={styles.destinationBtns}>
        {projectFolder && (
          <Button size="sm" onClick={onUseProjectFolder} disabled={exporting} label="Use project folder" />
        )}
        {folderSupported && <Button size="sm" onClick={onPickFolder} disabled={exporting} label="Choose folder" />}
      </div>
    </div>
  );
}

interface ProgressOrStatusProps {
  exporting: boolean;
  progress: { done: number; total: number; name: string } | null;
  statusMessage: { kind: "err"; text: string } | null;
  format: ExportFormat;
}

function ProgressOrStatus({ exporting, progress, statusMessage, format }: ProgressOrStatusProps) {
  if (exporting && progress) {
    return (
      <div className={styles.progressBox} role="status">
        <Loader2 size={14} className="spin" />
        <span>
          {isAudioFormat(format)
            ? progress.done === 100
              ? `Saving ${format.toUpperCase()}`
              : `Rendering ${format.toUpperCase()}: ${progress.done}%`
            : `Rendering ${progress.done} of ${progress.total}${progress.name ? ` · ${progress.name}` : ""}`}
        </span>
      </div>
    );
  }
  if (statusMessage && !exporting) {
    return (
      <div className={styles.statusErr} role="status">
        <AlertCircle size={14} />
        <span>{statusMessage.text}</span>
      </div>
    );
  }
  return null;
}
