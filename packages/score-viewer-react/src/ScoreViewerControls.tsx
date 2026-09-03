import type { CSSProperties, ReactNode } from "react";
import { BookOpen, Columns3, FileText, Maximize2, Minus, Plus, Rows3, Scan } from "lucide-react";
import { Slider } from "@viritura/ui";
import type { ScoreViewMode } from "./ScoreView";

function inlineIconButtonStyle(active: boolean, disabled: boolean): CSSProperties {
  return {
    width: 28,
    height: 28,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: active ? "1px solid rgba(255, 255, 255, 0.4)" : "1px solid rgba(255, 255, 255, 0.12)",
    borderRadius: 6,
    background: active ? "rgba(255, 255, 255, 0.22)" : "rgba(255, 255, 255, 0.08)",
    color: disabled ? "rgba(255, 255, 255, 0.38)" : "rgba(255, 255, 255, 0.94)",
    cursor: disabled ? "default" : "pointer",
    padding: 0,
  };
}
const DIVIDER_STYLE: CSSProperties = { width: 1, height: 22, background: "rgba(255, 255, 255, 0.16)" };
const SCORE_SELECT_STYLE: CSSProperties = {
  height: 28,
  minWidth: 132,
  maxWidth: 220,
  border: "1px solid rgba(255, 255, 255, 0.18)",
  borderRadius: 6,
  background: "rgba(255, 255, 255, 0.1)",
  color: "rgba(255, 255, 255, 0.94)",
  padding: "0 28px 0 8px",
  font: "inherit",
  outline: "none",
};
const SCORE_OPTION_STYLE: CSSProperties = { color: "#111827" };
const INLINE_ROW_STYLE: CSSProperties = { display: "inline-flex", gap: 4 };
const INLINE_ROW_CENTERED_STYLE: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6 };
const ZOOM_LABEL_STYLE: CSSProperties = {
  minWidth: 42,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

export type ScoreFitMode = "none" | "width" | "page";
export type ScoreViewerControlSurface = "floating-status" | "toolbar" | "none";

export interface ScoreViewerScoreOption {
  readonly index: number;
  readonly label: string;
}

export interface ScoreViewerControlOptions {
  readonly score?: boolean;
  readonly viewMode?: boolean;
  readonly zoom?: boolean;
  readonly fit?: boolean;
}

export interface ScoreViewerControlsProps {
  readonly scoreIndex?: number;
  readonly onScoreIndexChange?: (scoreIndex: number) => void;
  readonly scoreOptions?: readonly ScoreViewerScoreOption[];
  readonly viewMode: ScoreViewMode;
  readonly onViewModeChange: (viewMode: ScoreViewMode) => void;
  readonly availableViewModes?: readonly ScoreViewMode[];
  readonly zoom: number;
  readonly onZoomChange: (zoom: number) => void;
  readonly fitMode: ScoreFitMode;
  readonly onFitModeChange: (fitMode: ScoreFitMode) => void;
  readonly controls?: boolean | ScoreViewerControlOptions;
  readonly surface?: ScoreViewerControlSurface;
  readonly minZoom?: number;
  readonly maxZoom?: number;
  readonly zoomStep?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}

const defaultViewModes: readonly ScoreViewMode[] = ["page", "horizontal", "spread", "spread-horizontal"];

const controlLabels: Record<ScoreViewMode, string> = {
  page: "Single page",
  horizontal: "Horizontal pages",
  spread: "Page spread",
  "spread-horizontal": "Horizontal spreads",
};

function normalizeControls(
  controls: boolean | ScoreViewerControlOptions | undefined,
): Required<ScoreViewerControlOptions> {
  if (controls === false) return { score: false, viewMode: false, zoom: false, fit: false };
  return {
    score: controls === true || controls == null ? true : (controls.score ?? true),
    viewMode: controls === true || controls == null ? true : (controls.viewMode ?? true),
    zoom: controls === true || controls == null ? true : (controls.zoom ?? true),
    fit: controls === true || controls == null ? true : (controls.fit ?? true),
  };
}

function ViewModeIcon({ viewMode }: { readonly viewMode: ScoreViewMode }) {
  const size = 15;
  if (viewMode === "horizontal") return <Rows3 size={size} />;
  if (viewMode === "spread") return <BookOpen size={size} />;
  if (viewMode === "spread-horizontal") return <Columns3 size={size} />;
  return <FileText size={size} />;
}

interface InlineIconButtonProps {
  readonly title: string;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}

function InlineIconButton({ title, active = false, disabled = false, onClick, children }: InlineIconButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      style={inlineIconButtonStyle(active === true, disabled === true)}
    >
      {children}
    </button>
  );
}

export function ScoreViewerControls({
  scoreIndex = 0,
  onScoreIndexChange,
  scoreOptions = [],
  viewMode,
  onViewModeChange,
  availableViewModes = defaultViewModes,
  zoom,
  onZoomChange,
  fitMode,
  onFitModeChange,
  controls,
  surface = "floating-status",
  minZoom = 0.25,
  maxZoom = 2,
  zoomStep = 0.05,
  className,
  style,
}: ScoreViewerControlsProps) {
  if (surface === "none") return null;

  const visibleControls = normalizeControls(controls);
  const showScoreSelector = Boolean(visibleControls.score && scoreOptions.length > 1 && onScoreIndexChange);
  if (!showScoreSelector && !visibleControls.viewMode && !visibleControls.zoom && !visibleControls.fit) {
    return null;
  }

  const isFloating = surface === "floating-status";
  const controlStyle = buildControlStyle(isFloating, style);

  return (
    <div className={className} style={controlStyle} data-score-viewer-controls="true">
      <ScoreSelector
        show={showScoreSelector}
        scoreIndex={scoreIndex}
        scoreOptions={scoreOptions}
        onScoreIndexChange={onScoreIndexChange}
      />
      <SectionDivider
        show={showScoreSelector && (visibleControls.viewMode || visibleControls.zoom || visibleControls.fit)}
      />
      <ViewModeSwitcher
        show={visibleControls.viewMode}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        availableViewModes={availableViewModes}
      />
      <SectionDivider show={visibleControls.viewMode && (visibleControls.zoom || visibleControls.fit)} />
      <ZoomControl
        show={visibleControls.zoom}
        zoom={zoom}
        onZoomChange={onZoomChange}
        minZoom={minZoom}
        maxZoom={maxZoom}
        zoomStep={zoomStep}
      />
      <FitControl show={visibleControls.fit} fitMode={fitMode} onFitModeChange={onFitModeChange} />
    </div>
  );
}

function buildControlStyle(isFloating: boolean, style: CSSProperties | undefined): CSSProperties {
  return {
    "--accent": "#5fc9ad",
    "--border": "rgba(255, 255, 255, 0.22)",
    position: isFloating ? "absolute" : "relative",
    left: isFloating ? "50%" : undefined,
    bottom: isFloating ? 18 : undefined,
    transform: isFloating ? "translateX(-50%)" : undefined,
    zIndex: 20,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    minHeight: 38,
    padding: "5px 8px",
    border: "1px solid rgba(255, 255, 255, 0.16)",
    borderRadius: 8,
    background: "rgba(18, 22, 28, 0.88)",
    boxShadow: isFloating ? "0 12px 32px rgba(0, 0, 0, 0.28)" : "none",
    color: "rgba(255, 255, 255, 0.94)",
    backdropFilter: "blur(14px)",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 12,
    userSelect: "none",
    ...style,
  } as CSSProperties;
}

function SectionDivider({ show }: { show: boolean }) {
  if (!show) return null;
  return <div style={DIVIDER_STYLE} />;
}

interface ScoreSelectorProps {
  show: boolean;
  scoreIndex: number;
  scoreOptions: readonly ScoreViewerScoreOption[];
  onScoreIndexChange: ((scoreIndex: number) => void) | undefined;
}

function ScoreSelector({ show, scoreIndex, scoreOptions, onScoreIndexChange }: ScoreSelectorProps) {
  if (!show || !onScoreIndexChange) return null;
  return (
    <select
      value={scoreIndex}
      aria-label="Score"
      title="Score"
      onChange={(event) => onScoreIndexChange(Number(event.currentTarget.value))}
      style={SCORE_SELECT_STYLE}
    >
      {scoreOptions.map((option) => (
        <option key={option.index} value={option.index} style={SCORE_OPTION_STYLE}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

interface ViewModeSwitcherProps {
  show: boolean;
  viewMode: ScoreViewMode;
  onViewModeChange: (viewMode: ScoreViewMode) => void;
  availableViewModes: readonly ScoreViewMode[];
}

function ViewModeSwitcher({ show, viewMode, onViewModeChange, availableViewModes }: ViewModeSwitcherProps) {
  if (!show) return null;
  return (
    <div style={INLINE_ROW_STYLE} role="radiogroup" aria-label="Score view mode">
      {availableViewModes.map((availableMode) => (
        <InlineIconButton
          key={availableMode}
          title={controlLabels[availableMode]}
          active={availableMode === viewMode}
          onClick={() => onViewModeChange(availableMode)}
        >
          <ViewModeIcon viewMode={availableMode} />
        </InlineIconButton>
      ))}
    </div>
  );
}

interface ZoomControlProps {
  show: boolean;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  minZoom: number;
  maxZoom: number;
  zoomStep: number;
}

function ZoomControl({ show, zoom, onZoomChange, minZoom, maxZoom, zoomStep }: ZoomControlProps) {
  if (!show) return null;
  const zoomPercent = Math.round(zoom * 100);
  return (
    <div style={INLINE_ROW_CENTERED_STYLE}>
      <InlineIconButton
        title="Zoom out"
        disabled={zoom <= minZoom}
        onClick={() => onZoomChange(Math.max(minZoom, zoom - zoomStep))}
      >
        <Minus size={14} />
      </InlineIconButton>
      <Slider
        min={minZoom}
        max={maxZoom}
        step={zoomStep}
        value={zoom}
        onChange={onZoomChange}
        ariaLabel="Zoom"
        width={116}
      />
      <InlineIconButton
        title="Zoom in"
        disabled={zoom >= maxZoom}
        onClick={() => onZoomChange(Math.min(maxZoom, zoom + zoomStep))}
      >
        <Plus size={14} />
      </InlineIconButton>
      <span style={ZOOM_LABEL_STYLE}>{zoomPercent}%</span>
    </div>
  );
}

interface FitControlProps {
  show: boolean;
  fitMode: ScoreFitMode;
  onFitModeChange: (fitMode: ScoreFitMode) => void;
}

function FitControl({ show, fitMode, onFitModeChange }: FitControlProps) {
  if (!show) return null;
  return (
    <div style={INLINE_ROW_STYLE}>
      <InlineIconButton
        title="Fit width"
        active={fitMode === "width"}
        onClick={() => onFitModeChange(fitMode === "width" ? "none" : "width")}
      >
        <Maximize2 size={14} />
      </InlineIconButton>
      <InlineIconButton
        title="Fit page"
        active={fitMode === "page"}
        onClick={() => onFitModeChange(fitMode === "page" ? "none" : "page")}
      >
        <Scan size={14} />
      </InlineIconButton>
    </div>
  );
}
