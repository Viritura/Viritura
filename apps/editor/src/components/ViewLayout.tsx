/**
 * ViewLayout — shared layout shell for all activity views.
 *
 * Mirrors Write mode and PublishView: the canvas spans the full
 * workspace edge-to-edge, side panels float over it as glass cards,
 * and a status pill at the bottom reveals on cursor approach.
 *
 * Panel widths persist to localStorage and are resizable via thin
 * edge drag handles. The right panel's collapsed state can be driven
 * declaratively (via `rightPanel.collapsed`) or imperatively through
 * the legacy PanelImperativeHandle ref for the "auto-collapse when
 * nothing is selected" pattern.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";

const MAIN_AREA_BARE_STYLE: CSSProperties = { position: "absolute", inset: 0, zIndex: 0 };
const LEFT_PANEL_STYLE: CSSProperties = { position: "absolute", top: 14, bottom: 14, left: 14 };
const RIGHT_PANEL_STYLE: CSSProperties = { position: "absolute", top: 14, bottom: 14, right: 14 };
import type { PanelImperativeHandle } from "react-resizable-panels";
import { Panel, Tabs, type TabDef } from "@viritura/ui";
import { useStoredWidth } from "../hooks/useStoredWidth";

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

interface LeftPanelConfig {
  tabs?: TabDef[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  content: ReactNode;
  /** Default panel width in pixels. @default 280 */
  defaultSize?: number;
  /** Minimum panel width. @default 200 */
  minSize?: number;
  /** Maximum panel width. @default 500 */
  maxSize?: number;
}

interface RightPanelConfig {
  content: ReactNode;
  /** Default panel width in pixels. @default 320 */
  defaultSize?: number;
  /** Minimum panel width. @default 220 */
  minSize?: number;
  /** Maximum panel width. @default 520 */
  maxSize?: number;
  panelRef?: RefObject<PanelImperativeHandle | null>;
  collapsed?: boolean;
}

/**
 * Insets the floating panels carve out of the workspace, in CSS pixels.
 * Children rendered via a render-function receive these so they can bias
 * their initial scroll (e.g. ScoreCanvas's `safeArea` prop) — the canvas
 * itself still spans the full viewport edge-to-edge.
 */
interface FloatingInsets {
  left: number;
  right: number;
  top: number;
}

interface ViewLayoutProps {
  /** Unique ID for persisting panel sizes across sessions. */
  layoutId: string;
  leftPanel?: LeftPanelConfig;
  /**
   * Main content. When a function, the canvas container spans edge-to-edge
   * (full-bleed) and the function receives the panel insets so children
   * can bias their initial layout/scroll to clear floating panels.
   * When a ReactNode in floating mode, the content is rendered full-bleed
   * with zero-inset (no bias applied).
   */
  children: ReactNode | ((insets: FloatingInsets) => ReactNode);
  rightPanel?: RightPanelConfig;
  statusBar?: ReactNode;
  /**
   * When true, the left panel is docked (not floating) and the main
   * content area is rendered as its own bordered panel card to the
   * right of it. Used by Review mode where the diff viewer needs a
   * hard left boundary instead of bleeding under a floating panel.
   */
  dockedLeft?: boolean;
}

// ═══════════════════════════════════════════
// Floating-panel infrastructure
// ═══════════════════════════════════════════

function useStoredCollapsed(key: string): [boolean, (c: boolean) => void] {
  const [collapsed, setRaw] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(key) === "1";
  });
  const setCollapsed = useCallback(
    (c: boolean) => {
      setRaw(c);
      try {
        window.localStorage.setItem(key, c ? "1" : "0");
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [collapsed, setCollapsed];
}

// ═══════════════════════════════════════════
// Component
// ═══════════════════════════════════════════

function useStatusVisible(enabled: boolean): boolean {
  const [statusVisible, setStatusVisible] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const onMove = (e: MouseEvent) => {
      setStatusVisible(window.innerHeight - e.clientY < 120);
    };
    const onLeave = () => setStatusVisible(false);
    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, [enabled]);
  return statusVisible;
}

function useBridgedCollapsed(
  externalRef: RefObject<PanelImperativeHandle | null> | undefined,
  collapsed: boolean,
  setCollapsed: (c: boolean) => void,
  declarative: boolean | undefined,
) {
  const collapsedRef = useRef(collapsed);
  // eslint-disable-next-line react-hooks/refs -- intentional ref-bag pattern; refs hold stable identity, not render-time state
  collapsedRef.current = collapsed;
  useEffect(() => {
    if (!externalRef) return;
    externalRef.current = {
      collapse: () => setCollapsed(true),
      expand: () => setCollapsed(false),
      isCollapsed: () => collapsedRef.current,
    } as PanelImperativeHandle;
    return () => {
      if (externalRef) externalRef.current = null;
    };
  }, [externalRef, setCollapsed]);

  useEffect(() => {
    if (declarative === undefined) return;
    setCollapsed(declarative);
  }, [declarative, setCollapsed]);
}

interface MainContentInsets {
  left: number;
  right: number;
}

function renderMainChildren(children: ViewLayoutProps["children"], insets: MainContentInsets): ReactNode {
  if (typeof children === "function") {
    return children({ ...insets, top: 12 });
  }
  return children;
}

function MainContentArea({
  dockedLeft,
  leftPanel,
  rightPanel,
  leftCollapsed,
  rightCollapsed,
  leftW,
  rightW,
  children,
}: {
  dockedLeft: boolean;
  leftPanel: LeftPanelConfig | undefined;
  rightPanel: RightPanelConfig | undefined;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  leftW: number;
  rightW: number;
  children: ViewLayoutProps["children"];
}) {
  if (dockedLeft && leftPanel) {
    const left = (!leftCollapsed ? leftW : 0) + 24;
    const right = rightPanel && !rightCollapsed ? rightW + 24 : 14;
    // The docked main area is itself a panel card (not a canvas underlay)
    // — use Panel with explicit positioning + content children. We have
    // to override `width: "auto"` (Panel inlines the numeric `width` prop
    // on its root) so the panel sizes from left+right insets instead of
    // collapsing to 0px.
    const dockedMainStyle: CSSProperties = {
      position: "absolute",
      top: 14,
      bottom: 14,
      left,
      right,
      width: "auto",
      overflow: "hidden",
    };
    return (
      <Panel side="left" width={0} zIndex={1} style={dockedMainStyle}>
        {renderMainChildren(children, { left, right })}
      </Panel>
    );
  }
  const left = leftPanel && !leftCollapsed ? leftW + 24 : 12;
  const right = rightPanel && !rightCollapsed ? rightW + 24 : 12;
  return <div style={MAIN_AREA_BARE_STYLE}>{renderMainChildren(children, { left, right })}</div>;
}

function LeftPanelArea({
  leftPanel,
  leftW,
  setLeftW,
}: {
  leftPanel: LeftPanelConfig;
  leftW: number;
  setLeftW: (w: number) => void;
}) {
  return (
    <Panel
      side="left"
      width={leftW}
      onResize={setLeftW}
      min={leftPanel.minSize ?? 200}
      max={leftPanel.maxSize ?? 500}
      style={LEFT_PANEL_STYLE}
    >
      {leftPanel.tabs && leftPanel.activeTab ? (
        <Tabs tabs={leftPanel.tabs} activeTab={leftPanel.activeTab} onTabChange={leftPanel.onTabChange}>
          {leftPanel.content}
        </Tabs>
      ) : (
        leftPanel.content
      )}
    </Panel>
  );
}

function RightPanelArea({
  rightPanel,
  rightW,
  setRightW,
}: {
  rightPanel: RightPanelConfig;
  rightW: number;
  setRightW: (w: number) => void;
}) {
  return (
    <Panel
      side="right"
      width={rightW}
      onResize={setRightW}
      min={rightPanel.minSize ?? 220}
      max={rightPanel.maxSize ?? 520}
      style={RIGHT_PANEL_STYLE}
    >
      {rightPanel.content}
    </Panel>
  );
}

export function ViewLayout({
  layoutId,
  leftPanel,
  children,
  rightPanel,
  statusBar,
  dockedLeft = false,
}: ViewLayoutProps) {
  const [leftW, setLeftW] = useStoredWidth(
    `viritura.${layoutId}.leftW`,
    leftPanel?.defaultSize ?? 280,
    leftPanel?.minSize ?? 200,
    leftPanel?.maxSize ?? 500,
  );
  const [rightW, setRightW] = useStoredWidth(
    `viritura.${layoutId}.rightW`,
    rightPanel?.defaultSize ?? 320,
    rightPanel?.minSize ?? 220,
    rightPanel?.maxSize ?? 520,
  );
  const [leftCollapsed] = useStoredCollapsed(`viritura.${layoutId}.leftW:collapsed`);
  const [rightCollapsed, setRightCollapsed] = useStoredCollapsed(`viritura.${layoutId}.rightW:collapsed`);

  useBridgedCollapsed(rightPanel?.panelRef, rightCollapsed, setRightCollapsed, rightPanel?.collapsed);

  const statusVisible = useStatusVisible(Boolean(statusBar));

  return (
    <div style={containerStyle}>
      <div className="workspace-bg" style={panelAreaStyle}>
        <MainContentArea
          dockedLeft={dockedLeft}
          leftPanel={leftPanel}
          rightPanel={rightPanel}
          leftCollapsed={leftCollapsed}
          rightCollapsed={rightCollapsed}
          leftW={leftW}
          rightW={rightW}
        >
          {children}
        </MainContentArea>

        {leftPanel && !leftCollapsed && <LeftPanelArea leftPanel={leftPanel} leftW={leftW} setLeftW={setLeftW} />}

        {rightPanel && !rightCollapsed && (
          <RightPanelArea rightPanel={rightPanel} rightW={rightW} setRightW={setRightW} />
        )}

        {statusBar && (
          <div className={`workspace-status-zone${statusVisible ? " workspace-status-zone--visible" : ""}`}>
            {statusBar}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  overflow: "hidden",
};

const panelAreaStyle: CSSProperties = {
  flex: 1,
  position: "relative",
  overflow: "hidden",
  minHeight: 0,
};

// Canvas occupies the remaining viewport — see render block above for the
// inline panel-aware insets that keep its center inside the visible region.
