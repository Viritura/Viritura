/**
 * WorkspaceMode — the polymorphic contract every workspace mode (Setup /
 * Write / Engrave / Publish) implements around the single shared `ScoreCanvas`.
 *
 * A mode contributes four things and nothing else:
 *   • `canvasProps` — props merged over the shared base canvas props
 *     (interaction mode, print-preview, engrave adornments, selectedPartIds).
 *   • `panels`      — a flat array of `<Panel>` elements for `WorkspaceShell`.
 *   • `toolbar`     — content for the `ToolbarPortal` (omit = no view toolbar).
 *   • `statusBar`   — the bottom status bar.
 *   • `siblings`    — content rendered outside `WorkspaceShell` (dialogs and
 *     other mode-level overlays).
 *
 * `AppWorkspace` consumes a single `WorkspaceMode` and never branches on which
 * mode it is — adding a mode is one new `build*Mode` function plus a branch in
 * the AppInner selector, with zero edits to the shell. This replaces the
 * previous twin-boolean (`isEngrave` / `isPublish`) dispatch that was repeated
 * across four files.
 *
 * Sharing the canvas is what makes Setup mode work: every roster, layout, and
 * signature edit made in its panel re-renders the same live score the user
 * will go on to write into.
 */
import type { ReactNode } from "react";
import type { ScoreCanvasProps } from "../components/ScoreCanvas";

export type WorkspaceModeKind = "setup" | "write" | "engrave" | "publish";

export interface WorkspaceMode {
  readonly kind: WorkspaceModeKind;
  /** Props merged over the shared base canvas props. */
  readonly canvasProps: Partial<ScoreCanvasProps>;
  /** Flat array of `<Panel>` elements for `WorkspaceShell` (never a fragment). */
  readonly panels: ReactNode[];
  /** Toolbar content for the `ToolbarPortal`; omit for no view toolbar. */
  readonly toolbar?: ReactNode;
  /** Bottom status bar content. */
  readonly statusBar: ReactNode;
  /** Reopens side panels after the user collapses them. */
  readonly onTogglePanels?: () => void;
  /** Content rendered as a sibling of `WorkspaceShell` (dialogs, auto-collapse). */
  readonly siblings?: ReactNode;
}
