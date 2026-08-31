import type { ComponentProps, CSSProperties, RefObject } from "react";
import { ToolbarPortal } from "../components/AppShell";
import type { WorkspaceMode } from "./workspaceMode";
import { AppBanners } from "./AppBanners";
import { AppWorkspace } from "./AppWorkspace";
import { AppOverlays } from "./AppOverlays";

const APP_ROOT_STYLE: CSSProperties = {
  fontFamily: "system-ui, sans-serif",
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  position: "relative",
  overflow: "hidden",
  background: "var(--bg)",
  color: "var(--text)",
};

type AppBannersProps = ComponentProps<typeof AppBanners>;
type AppWorkspaceProps = ComponentProps<typeof AppWorkspace>;
type AppOverlaysProps = ComponentProps<typeof AppOverlays>;

export interface AppInnerViewProps {
  isActiveView: boolean | undefined;
  /** The active workspace mode (Write / Engrave / Publish). */
  mode: WorkspaceMode;
  dropRef: RefObject<HTMLDivElement | null>;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => Promise<void> | void;
  banners: AppBannersProps;
  workspace: AppWorkspaceProps;
  overlays: AppOverlaysProps;
}

/**
 * Pure render shell for AppInner. Receives the active `WorkspaceMode` plus the
 * banners / workspace / overlays prop bags and lays them out. The mode supplies
 * its own toolbar; this shell never branches on which mode is active.
 */
export function AppInnerView({
  isActiveView,
  mode,
  dropRef,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  banners,
  workspace,
  overlays,
}: AppInnerViewProps) {
  return (
    <div
      ref={dropRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={APP_ROOT_STYLE}
    >
      {/* View toolbar — the active mode supplies its own content (MenuBar is
          global via AppShell). Only the active view paints into the portal. */}
      {isActiveView && mode.toolbar && <ToolbarPortal>{mode.toolbar}</ToolbarPortal>}

      <AppBanners {...banners} />
      <AppWorkspace {...workspace} />
      <AppOverlays {...overlays} />
    </div>
  );
}
