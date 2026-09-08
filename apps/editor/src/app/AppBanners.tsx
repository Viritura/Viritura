import type { CSSProperties } from "react";
import { Button, IconButton } from "@viritura/ui";
import { X } from "lucide-react";
import {
  dragOverlayStyle,
  errorBannerStyle,
  errorDetailsContentStyle,
  errorDetailsStyle,
  errorDetailsSummaryStyle,
  printWarningBannerStyle,
  trackBannerStyle,
} from "./appStyles";
import { formatPageRanges } from "./printOverflow";

const DROP_HINT_STYLE: CSSProperties = {
  fontSize: "var(--type-title-size)",
  color: "#4a9df0",
  fontWeight: "var(--type-heading-weight)",
};
const TRACK_BANNER_TEXT_STYLE: CSSProperties = { flex: 1, minWidth: 0 };

function FileErrorBanner({ error }: { error: string }): React.ReactElement {
  const newlineIndex = error.indexOf("\n");
  if (newlineIndex === -1) return <div style={errorBannerStyle}>⚠️ {error}</div>;

  const summary = error.slice(0, newlineIndex);
  const details = error.slice(newlineIndex + 1);
  return (
    <div style={errorBannerStyle}>
      <div>⚠️ {summary}</div>
      <details style={errorDetailsStyle}>
        <summary style={errorDetailsSummaryStyle}>Show technical details</summary>
        <pre style={errorDetailsContentStyle}>{details}</pre>
      </details>
    </div>
  );
}

interface AppBannersProps {
  isDragOver: boolean;
  fileError: string | null;
  trackBannerFile: string | null;
  handleTrackWithGit: () => void | Promise<void>;
  handleDismissTrackBanner: (permanent: boolean) => void;
  printOverflowPages: number[];
}

export function AppBanners(props: AppBannersProps): React.ReactElement {
  const { isDragOver, fileError, trackBannerFile, handleTrackWithGit, handleDismissTrackBanner, printOverflowPages } =
    props;
  const pageLabel = printOverflowPages.length === 1 ? "Page" : "Pages";
  const pageRanges = formatPageRanges(printOverflowPages);
  return (
    <>
      {isDragOver && (
        <div style={dragOverlayStyle}>
          <span style={DROP_HINT_STYLE}>Drop .mnx file to open</span>
        </div>
      )}
      {fileError && <FileErrorBanner error={fileError} />}
      {!fileError && printOverflowPages.length > 0 && (
        <div style={printWarningBannerStyle}>
          ⚠️ {pageLabel} {pageRanges} exceed the printable bottom margin. Reduce the staff size, choose a larger page,
          or hide unused staves before printing.
        </div>
      )}
      {trackBannerFile && !fileError && (
        <div style={trackBannerStyle}>
          <span style={TRACK_BANNER_TEXT_STYLE}>
            <strong>{trackBannerFile}</strong> is open without version history. Open the containing folder to track
            changes with Git.
          </span>
          <Button
            variant="primary"
            size="sm"
            label="Open folder…"
            onClick={() => {
              void handleTrackWithGit();
            }}
          />
          <Button
            variant="link"
            size="sm"
            label="Don't show again"
            tooltip="Don't show this banner again"
            onClick={() => handleDismissTrackBanner(true)}
          />
          <IconButton tooltip="Dismiss" aria-label="Dismiss" onClick={() => handleDismissTrackBanner(false)}>
            <X size={14} />
          </IconButton>
        </div>
      )}
    </>
  );
}
