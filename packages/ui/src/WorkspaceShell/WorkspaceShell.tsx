/**
 * WorkspaceShell — the single dock used by every workspace activity to
 * host a canvas underlay + floating glass panels + a peek-on-hover
 * status bar zone.
 *
 * Usage:
 *
 *   <WorkspaceShell
 *     statusBar={<StatusBar … />}
 *     statusVisible={statusVisible}
 *     canvas={(insets) => <ScoreCanvas safeArea={insets} … />}
 *   >
 *     <Panel side="left"  width={leftW}  onResize={setLeftW}  min={200} max={500}>
 *       <LeftPanel … />
 *     </Panel>
 *     <Panel side="right" width={rightW} onResize={setRightW} min={220} max={520}>
 *       <NotationInspector … />
 *     </Panel>
 *     {showSource && (
 *       <Panel side="right" width={sourceW} onResize={setSourceW} min={280} max={700}>
 *         <MnxSourcePanel … />
 *       </Panel>
 *     )}
 *   </WorkspaceShell>
 *
 * The shell scans its children for <Panel> elements, groups them by
 * `side`, and injects the computed `left` / `right` / `top` / `bottom`
 * style via the panel's `shellStyle` prop. Stacking is automatic in
 * source order: the first `side="right"` panel sits flush to the right
 * edge (inset by `INSET`), the second sits to its left of the first
 * with a `GAP` between, and so on.
 *
 * The total inboard inset on each side is passed back to the `canvas`
 * render prop as `{ left, right, top, bottom }` so the canvas's
 * `safeArea` stays in sync automatically — no per-callsite math.
 *
 * Non-<Panel> children (e.g. floating overlays) are rendered after the
 * panels untouched.
 */
import { Children, cloneElement, isValidElement, type CSSProperties, type ReactNode } from "react";
import { Panel, type PanelProps, type PanelSide } from "../Panel/Panel";
import styles from "./WorkspaceShell.module.css";

/** Horizontal inset between the workspace edge and the outermost panel. */
const INSET = 14;
/** Gap between stacked panels on the same side. */
const GAP = 12;
/** Width of the recovery handle at hover plus a small content gap. */
const PANEL_HANDLE_INSET = 32;
/** Height of the peek-on-hover status zone (see WorkspaceShell.module.css).
 *  Reported as a bottom inset while pinned so the canvas scroll cap never
 *  parks content underneath it. */
const STATUS_ZONE_HEIGHT = 56;

export interface WorkspaceInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface WorkspaceShellProps {
  /**
   * Render prop for the underlay (typically a score canvas). Receives
   * the running insets reflecting open panels so the canvas can keep
   * its safe area in sync.
   */
  canvas?: (insets: WorkspaceInsets) => ReactNode;
  /** Bottom status bar contents. Rendered into the peek-on-hover zone. */
  statusBar?: ReactNode;
  /** When true, the status zone is pinned visible (otherwise hover-only). */
  statusVisible?: boolean;
  /** Shows a persistent edge affordance when side panels are hidden. */
  showPanelHandle?: boolean;
  /** Reopens the hidden side panels. */
  onTogglePanels?: () => void;
  /** Extra class names appended to the shell root. */
  className?: string;
  style?: CSSProperties;
  /** <Panel> children + any auxiliary overlays. */
  children?: ReactNode;
}

export function WorkspaceShell({
  canvas,
  statusBar,
  statusVisible = false,
  showPanelHandle = false,
  onTogglePanels,
  className,
  style,
  children,
}: WorkspaceShellProps): React.ReactElement {
  const { panels, others } = splitChildren(children);
  const { positioned, insets: panelInsets } = layoutPanels(panels);
  const insets: WorkspaceInsets = {
    ...panelInsets,
    left: showPanelHandle ? Math.max(panelInsets.left, PANEL_HANDLE_INSET) : panelInsets.left,
    bottom: statusBar !== undefined && statusVisible ? STATUS_ZONE_HEIGHT : panelInsets.bottom,
  };

  const rootClass = className ? `${styles.shell} ${className}` : styles.shell;
  const statusClass = statusVisible ? `${styles.statusZone} ${styles.statusZoneVisible}` : styles.statusZone;

  return (
    <div className={rootClass} style={style}>
      {canvas !== undefined && <div className={styles.canvasLayer}>{canvas(insets)}</div>}
      {positioned}
      {others}
      {showPanelHandle && onTogglePanels !== undefined && (
        <button type="button" className={styles.panelHandle} onClick={onTogglePanels} aria-label="Show panels" />
      )}
      {statusBar !== undefined && <div className={statusClass}>{statusBar}</div>}
    </div>
  );
}

interface SplitChildren {
  panels: ReadonlyArray<React.ReactElement<PanelProps>>;
  others: ReactNode[];
}

/**
 * A child counts as a "Panel" if it is the Panel primitive itself OR a
 * thin wrapper component whose root renders <Panel>. We detect wrappers
 * structurally: they must expose a `side` of "left"/"right" and a
 * numeric `width` in their props. The shell injects `shellStyle` via
 * cloneElement; wrappers are expected to spread it onto their inner
 * Panel (see PublishView's LeftLayoutsPanel / RightExportPanel). This
 * keeps consumers free to extract their own per-feature wrappers
 * without losing positioning. Without this, the wrapper falls into
 * `others`, renders without shellStyle, and the inner Panel inherits
 * the default `position: relative` — no margins, no stacking.
 */
function isPanelLike(child: React.ReactElement<unknown>): child is React.ReactElement<PanelProps> {
  if (child.type === Panel) return true;
  const props = child.props as Partial<PanelProps> | null | undefined;
  if (!props) return false;
  return (props.side === "left" || props.side === "right") && typeof props.width === "number";
}

function splitChildren(children: ReactNode): SplitChildren {
  const panels: React.ReactElement<PanelProps>[] = [];
  const others: ReactNode[] = [];
  Children.forEach(children, (child) => {
    if (isValidElement(child) && isPanelLike(child)) {
      panels.push(child);
    } else if (child !== null && child !== undefined && child !== false && child !== true) {
      others.push(child);
    }
  });
  return { panels, others };
}

interface LayoutResult {
  positioned: ReactNode[];
  insets: WorkspaceInsets;
}

function layoutPanels(panels: ReadonlyArray<React.ReactElement<PanelProps>>): LayoutResult {
  let leftCursor = INSET;
  let rightCursor = INSET;
  const positioned = panels.map((panel, i) =>
    positionPanel(
      panel,
      i,
      () => leftCursor,
      () => rightCursor,
      advance,
    ),
  );

  function advance(side: PanelSide, width: number) {
    if (side === "left") leftCursor += width + GAP;
    else rightCursor += width + GAP;
  }

  // The cursor sits one GAP past the last panel — subtract it back out
  // so `insets` reports occupied width (panel-edge to workspace-edge).
  const left = leftCursor === INSET ? 0 : leftCursor - GAP;
  const right = rightCursor === INSET ? 0 : rightCursor - GAP;
  return { positioned, insets: { left, right, top: 0, bottom: 0 } };
}

function positionPanel(
  panel: React.ReactElement<PanelProps>,
  index: number,
  getLeft: () => number,
  getRight: () => number,
  advance: (side: PanelSide, width: number) => void,
): React.ReactElement<PanelProps> {
  const { side, width } = panel.props;
  const offset = side === "left" ? getLeft() : getRight();
  const shellStyle: CSSProperties = {
    position: "absolute",
    top: 0,
    marginTop: INSET,
    marginBottom: INSET,
    height: `calc(100% - ${INSET * 2}px)`,
    ...(side === "left" ? { left: offset } : { right: offset }),
  };
  advance(side, width);
  return cloneElement(panel, { shellStyle, key: panel.key ?? index });
}
