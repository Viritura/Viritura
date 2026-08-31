import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Tooltip } from "@viritura/ui";
import type { ClipboardFragment } from "../clipboard/ClipboardFragment";
import type { ClipboardSourceRef } from "../store/clipboardHistoryStore";
import { useHistoryEntryMnxJsonById } from "../store/historyStore";
import { isWasmReady } from "@viritura/renderer";
import { buildPreviewScore } from "./clipboardPreview/buildPreview";
import { describeFragment } from "./clipboardPreview/describeFragment";
import { renderScoreToCanvas } from "./clipboardPreview/renderScoreToCanvas";

function canvasShellRectStyle(width: number, height: number): CSSProperties {
  return { ...canvasShellStyle, width, height };
}
function canvasDisplayStyle(ready: boolean): CSSProperties {
  return { ...canvasStyle, display: ready ? "block" : "none" };
}
function elidedRowDisplayStyle(ready: boolean): CSSProperties {
  return { ...elidedRowStyle, display: ready ? "flex" : "none" };
}
function canvasHalfStyle(halfW: number, height: number): CSSProperties {
  return { ...canvasStyle, width: halfW, height };
}
import { useRenderPlan, type RenderPlan } from "./clipboardPreview/useRenderPlan";

interface ClipboardPreviewProps {
  fragment: ClipboardFragment;
  /**
   * Optional ref to the historical score snapshot this fragment was copied
   * from. When the snapshot is still resident in HistoryContext, the preview
   * renders the actual source measures (preserving instrument names,
   * clefs, transpositions, dynamics) instead of the synthetic snippet.
   */
  source?: ClipboardSourceRef;
  width?: number;
  height?: number;
  /**
   * Maximum number of measures to render contiguously. When the source
   * range exceeds this, the preview shows the first and last
   * `elideHeadTailMeasures` measures with a visual divider between them.
   * Default 6 (so anything > 6 measures gets elided).
   */
  maxContiguousMeasures?: number;
  /** When eliding, how many measures to show at the head and tail. Default 2. */
  elideHeadTailMeasures?: number;
}

/**
 * Renders a mini canvas preview of clipboard content, plus a metadata badge
 * row showing time signature, key signature, and pitch range.
 *
 * Two rendering modes:
 *  1. **Snapshot mode** (preferred) — when `source` is provided AND the
 *     referenced HistoryContext snapshot is still resident, slice the actual
 *     historical Score down to the copied parts × measures and render that.
 *     This preserves instrument names, exact clefs (incl. mid-measure clef
 *     changes), transpositions, dynamics, lyrics, slurs etc. For long
 *     ranges (> maxContiguousMeasures) only the first/last few measures are
 *     rendered with a visual divider showing the elided count.
 *  2. **Snippet fallback** — wrap the bare fragment in a synthetic minimal
 *     score (legacy behavior). Used when the snapshot has been LRU-evicted
 *     or no `source` was captured.
 */
export function ClipboardPreview({
  fragment,
  source,
  width: widthProp,
  height = 62,
  maxContiguousMeasures,
  elideHeadTailMeasures,
}: ClipboardPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(containerRef, widthProp);

  // wasm layout compresses measures to fit the canvas, so we can pack
  // measures densely (~22px each at minimum useful size) and let layout
  // decide spacing. headTail is clamped 2..14 measures per side.
  const PX_PER_MEASURE = 22;
  const autoHeadTail = Math.max(2, Math.min(14, Math.floor((width - 14) / 2 / PX_PER_MEASURE)));
  const headTail = elideHeadTailMeasures ?? autoHeadTail;
  // Only elide when we'd save at least 2 measures vs. rendering contiguously.
  const maxContig = maxContiguousMeasures ?? headTail * 2 + 2;

  const headCanvasRef = useRef<HTMLCanvasElement>(null);
  const tailCanvasRef = useRef<HTMLCanvasElement>(null);
  const [renderState, setRenderState] = useState<"loading" | "ready" | "failed">(isWasmReady() ? "ready" : "loading");

  const meta = useMemo(() => describeFragment(fragment), [fragment]);
  const snapshotMnxJson = useHistoryEntryMnxJsonById(source?.historyId);
  const renderPlan = useRenderPlan({ fragment, source, snapshotMnxJson, maxContig, headTail });

  // Scale canvas height proportionally for multi-staff content.
  const effectiveHeight = renderPlan.staves > 1 ? Math.min(height * (renderPlan.staves * 0.85), height * 2.5) : height;

  useWasmReadyPoll(renderState, setRenderState);

  useEffect(() => {
    if (renderState !== "ready") return;
    try {
      paintRenderPlan({
        plan: renderPlan,
        fragment,
        headCanvas: headCanvasRef.current,
        tailCanvas: tailCanvasRef.current,
        width,
        height: effectiveHeight,
      });
    } catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
      setRenderState("failed");
    }
  }, [renderPlan, fragment, width, effectiveHeight, renderState]);

  return (
    <div ref={containerRef} style={containerStyle}>
      <PreviewCanvasArea
        renderPlan={renderPlan}
        renderState={renderState}
        headCanvasRef={headCanvasRef}
        tailCanvasRef={tailCanvasRef}
        width={width}
        effectiveHeight={effectiveHeight}
      />
      <BadgeRow meta={meta} renderPlan={renderPlan} />
    </div>
  );
}

// ───────────────────────────────────────────
// Hooks
// ───────────────────────────────────────────

function useMeasuredWidth(containerRef: React.RefObject<HTMLDivElement | null>, widthProp: number | undefined): number {
  const [measuredWidth, setMeasuredWidth] = useState<number>(widthProp ?? 186);
  useEffect(() => {
    if (widthProp !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
      setMeasuredWidth(widthProp);
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setMeasuredWidth(w);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [widthProp, containerRef]);
  return measuredWidth;
}

function useWasmReadyPoll(
  renderState: "loading" | "ready" | "failed",
  setRenderState: (s: "loading" | "ready" | "failed") => void,
) {
  useEffect(() => {
    if (renderState !== "loading") return;
    let cancelled = false;
    const check = () => {
      if (cancelled) return;
      if (isWasmReady()) {
        setRenderState("ready");
      } else {
        setTimeout(check, 80);
      }
    };
    check();
    return () => {
      cancelled = true;
    };
  }, [renderState, setRenderState]);
}

// ───────────────────────────────────────────
// Painting
// ───────────────────────────────────────────

interface PaintRenderPlanArgs {
  plan: RenderPlan;
  fragment: ClipboardFragment;
  headCanvas: HTMLCanvasElement | null;
  tailCanvas: HTMLCanvasElement | null;
  width: number;
  height: number;
}

function paintRenderPlan({ plan, fragment, headCanvas, tailCanvas, width, height }: PaintRenderPlanArgs) {
  if (plan.mode === "snippet") {
    if (!headCanvas) return;
    const previewScore = buildPreviewScore(fragment);
    renderScoreToCanvas(headCanvas, previewScore, width, height);
    return;
  }
  if (plan.mode === "snapshot-contig") {
    if (!headCanvas) return;
    renderScoreToCanvas(headCanvas, plan.score, width, height);
    return;
  }
  // Elided: render head and tail into two canvases side by side.
  if (!headCanvas || !tailCanvas) return;
  const halfW = Math.floor((width - ELIDE_GAP_PX) / 2);
  renderScoreToCanvas(headCanvas, plan.head, halfW, height);
  renderScoreToCanvas(tailCanvas, plan.tail, halfW, height);
}

// ───────────────────────────────────────────
// Sub-components
// ───────────────────────────────────────────

interface PreviewCanvasAreaProps {
  renderPlan: RenderPlan;
  renderState: "loading" | "ready" | "failed";
  headCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  tailCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  width: number;
  effectiveHeight: number;
}

function PreviewCanvasArea({
  renderPlan,
  renderState,
  headCanvasRef,
  tailCanvasRef,
  width,
  effectiveHeight,
}: PreviewCanvasAreaProps) {
  const isElided = renderPlan.mode === "snapshot-elided";
  const halfW = Math.floor((width - ELIDE_GAP_PX) / 2);

  return (
    <div style={canvasShellRectStyle(width, effectiveHeight)}>
      {renderState === "loading" && <div style={skeletonStyle} aria-label="Loading preview" />}
      {renderState === "failed" && <div style={failedStyle}>Preview unavailable</div>}
      {!isElided ? (
        <canvas
          ref={headCanvasRef}
          style={canvasDisplayStyle(renderState === "ready")}
          aria-label="Clipboard preview"
        />
      ) : (
        <div style={elidedRowDisplayStyle(renderState === "ready")}>
          <canvas
            ref={headCanvasRef}
            style={canvasHalfStyle(halfW, effectiveHeight)}
            aria-label="Clipboard preview (start)"
          />
          <Tooltip content={`${renderPlan.elidedCount} measure${renderPlan.elidedCount === 1 ? "" : "s"} omitted`}>
            <div style={elideDividerStyle}>
              <span style={elideDotsStyle}>···</span>
            </div>
          </Tooltip>
          <canvas
            ref={tailCanvasRef}
            style={canvasHalfStyle(halfW, effectiveHeight)}
            aria-label="Clipboard preview (end)"
          />
        </div>
      )}
    </div>
  );
}

interface BadgeRowProps {
  meta: ReturnType<typeof describeFragment>;
  renderPlan: RenderPlan;
}

function BadgeRow({ meta, renderPlan }: BadgeRowProps) {
  const isElided = renderPlan.mode === "snapshot-elided";
  return (
    <div style={badgeRowStyle}>
      <Tooltip content="Time signature">
        <span style={badgeStyle}>{meta.timeSig}</span>
      </Tooltip>
      <Tooltip content="Key signature">
        <span style={badgeStyle}>{meta.keySig}</span>
      </Tooltip>
      {meta.pitchRange && (
        <Tooltip content="Pitch range">
          <span style={badgeStyle}>{meta.pitchRange}</span>
        </Tooltip>
      )}
      {renderPlan.staves > 1 && (
        <Tooltip content="Number of staves shown">
          <span style={badgeStyle}>{renderPlan.staves} staves</span>
        </Tooltip>
      )}
      {renderPlan.hiddenStaves > 0 && (
        <Tooltip
          content={`${renderPlan.hiddenStaves} silent stave${renderPlan.hiddenStaves === 1 ? "" : "s"} hidden from preview (no notes in copied range)`}
        >
          <span style={badgeStyle}>+{renderPlan.hiddenStaves} silent</span>
        </Tooltip>
      )}
      {isElided && (
        <Tooltip content="Measures omitted in middle">
          <span style={badgeStyle}>+{renderPlan.elidedCount} m. hidden</span>
        </Tooltip>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════

/** Width reserved for the elision divider between head/tail canvases. */
const ELIDE_GAP_PX = 14;

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  width: "100%",
  minWidth: 0,
};

const canvasShellStyle: CSSProperties = {
  position: "relative",
  borderRadius: "6px",
  background: "#fff",
  overflow: "hidden",
};

const canvasStyle: CSSProperties = {
  display: "block",
};

const elidedRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  width: "100%",
  height: "100%",
};

const elideDividerStyle: CSSProperties = {
  width: `${ELIDE_GAP_PX}px`,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  position: "relative",
  background: "repeating-linear-gradient(90deg, transparent 0 4px, rgba(0,0,0,0.18) 4px 6px)",
};

const elideDotsStyle: CSSProperties = {
  fontSize: "var(--type-small-size)",
  color: "rgba(0,0,0,0.55)",
  fontWeight: "var(--type-heading-weight)",
  letterSpacing: "1px",
  background: "#fff",
  padding: "0 2px",
  lineHeight: 1,
};

const skeletonStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "linear-gradient(90deg, #f3f3f3 25%, #e8e8e8 50%, #f3f3f3 75%)",
  backgroundSize: "200% 100%",
  animation: "viritura-clips-shimmer 1.2s ease-in-out infinite",
};

const failedStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "var(--type-eyebrow-size)",
  color: "var(--text-muted)",
};

const badgeRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "3px",
  padding: "0 2px",
};

const badgeStyle: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  padding: "1px 5px",
  borderRadius: "3px",
  background: "var(--surface-sunken)",
  color: "var(--text-muted)",
  fontWeight: "var(--type-control-weight)",
  whiteSpace: "nowrap",
};
