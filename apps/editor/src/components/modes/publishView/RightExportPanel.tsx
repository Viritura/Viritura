import {
  Download,
  FileAudio,
  Globe,
  Link as LinkIcon,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { Button, Checkbox, FormInput, Panel, Radio, RadioGroup } from "@viritura/ui";
import styles from "../PublishView.module.css";
import type { CSSProperties } from "react";

const FLEX_COL_STYLE: CSSProperties = { display: "flex", flexDirection: "column" };
const DEST_COL_STYLE: CSSProperties = { display: "flex", flexDirection: "column", minWidth: 0 };
const SPARKLES_INLINE_STYLE: CSSProperties = { verticalAlign: "-1px", marginRight: 4 };
import type { FsDirectoryHandle } from "../../../publish/batchRender";
import type { BundleMode } from "./runPublishExport";
import { FormatSelect, Section } from "./FormatPickers";

interface RightExportPanelProps {
  /** Panel positioning props — surfaced here so WorkspaceShell can detect
   * this wrapper as Panel-like and inject `shellStyle`. */
  side?: "right";
  width: number;
  onResize: (w: number) => void;
  exporting: boolean;
  scoreLoaded: boolean;
  orderedSelectedCount: number;

  bundleMode: BundleMode;
  onBundleModeChange: (mode: BundleMode) => void;

  folderSupported: boolean;
  exportFolder: FsDirectoryHandle | null;
  onPickFolder: () => void;
  onClearFolder: () => void;

  filenamePattern: string;
  onFilenamePatternChange: (s: string) => void;

  embedMnx: boolean;
  onEmbedMnxChange: (v: boolean) => void;

  progress: { done: number; total: number; name: string } | null;
  statusMessage: { kind: "ok" | "err"; text: string } | null;

  onExport: () => void;
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
    bundleMode,
    onBundleModeChange,
    folderSupported,
    exportFolder,
    onPickFolder,
    onClearFolder,
    filenamePattern,
    onFilenamePatternChange,
    embedMnx,
    onEmbedMnxChange,
    progress,
    statusMessage,
    onExport,
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
      subtitle="Choose what to export and where it goes. Renders use the same engine as the editor."
      scrollBody
    >
      <Section label="Format">
        <FormatSelect />
      </Section>

      <Section label="Bundle">
        <RadioGroup value={bundleMode} onChange={(v) => onBundleModeChange(v as typeof bundleMode)}>
          <Radio value="separate" variant="card" label="Separate files" description="One download per layout" />
          <Radio
            value="single-pdf"
            variant="card"
            label="Single PDF"
            description="Concatenate every layout into one PDF"
          />
          <Radio value="zip" variant="card" label="ZIP archive" description="One ZIP containing all PDFs" />
        </RadioGroup>
      </Section>

      <Section label="Destination">
        <DestinationRow
          folderSupported={folderSupported}
          exportFolder={exportFolder}
          exporting={exporting}
          onPickFolder={onPickFolder}
          onClearFolder={onClearFolder}
        />
      </Section>

      <Section label="Filename">
        <FormInput
          className={styles.inputField}
          value={filenamePattern}
          onChange={(e) => onFilenamePatternChange(e.target.value)}
          disabled={exporting}
        />
        <div className={styles.fieldHint}>
          Tokens: <code>%TITLE%</code> (document title), <code>%PART%</code> (layout name). Extension is added
          automatically.
        </div>
      </Section>

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

      <ProgressOrStatus exporting={exporting} progress={progress} statusMessage={statusMessage} />

      <div className={styles.exportButtonWrap}>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onClick={onExport}
          disabled={!scoreLoaded || orderedSelectedCount === 0 || exporting}
        >
          <Download size={18} />
          Export {orderedSelectedCount} layout{orderedSelectedCount === 1 ? "" : "s"}
          {exportFolder ? ` to "${exportFolder.name}"` : ""}
        </Button>
      </div>

      <ComingSoon />
    </Panel>
  );
}

interface DestinationRowProps {
  folderSupported: boolean;
  exportFolder: FsDirectoryHandle | null;
  exporting: boolean;
  onPickFolder: () => void;
  onClearFolder: () => void;
}

function DestinationRow({
  folderSupported,
  exportFolder,
  exporting,
  onPickFolder,
  onClearFolder,
}: DestinationRowProps) {
  if (!folderSupported) {
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
          <span className={styles.destinationHint}>Files will be written here.</span>
        </div>
        <div className={styles.destinationBtns}>
          <Button size="sm" onClick={onPickFolder} disabled={exporting} label="Change…" />
          <Button size="sm" onClick={onClearFolder} disabled={exporting} label="Clear" />
        </div>
      </div>
    );
  }
  return (
    <div className={styles.destinationRow}>
      <div style={DEST_COL_STYLE}>
        <span className={styles.destinationName}>Browser downloads</span>
        <span className={styles.destinationHint}>Pick a folder to write files directly without download prompts.</span>
      </div>
      <div className={styles.destinationBtns}>
        <Button size="sm" onClick={onPickFolder} disabled={exporting} label="Choose folder…" />
      </div>
    </div>
  );
}

interface ProgressOrStatusProps {
  exporting: boolean;
  progress: { done: number; total: number; name: string } | null;
  statusMessage: { kind: "ok" | "err"; text: string } | null;
}

function ProgressOrStatus({ exporting, progress, statusMessage }: ProgressOrStatusProps) {
  if (exporting && progress) {
    return (
      <div className={styles.progressBox}>
        <Loader2 size={14} className="spin" />
        <span>
          Rendering {progress.done} of {progress.total}
          {progress.name ? ` · ${progress.name}` : ""}
        </span>
      </div>
    );
  }
  if (statusMessage && !exporting) {
    return (
      <div className={statusMessage.kind === "ok" ? styles.statusOk : styles.statusErr}>
        {statusMessage.kind === "ok" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
        <span>{statusMessage.text}</span>
      </div>
    );
  }
  return null;
}

function ComingSoon() {
  return (
    <div className={styles.comingSoon}>
      <h3 className={styles.comingSoonHeader}>
        <Sparkles size={11} style={SPARKLES_INLINE_STYLE} />
        Coming soon
      </h3>
      <ul className={styles.comingSoonList}>
        <li>
          <LinkIcon size={12} /> Share link with permissions
        </li>
        <li>
          <Globe size={12} /> Public score page with embedded player
        </li>
        <li>
          <FileAudio size={12} /> Bounce to WAV/MP3 with per-part stems
        </li>
      </ul>
    </div>
  );
}
