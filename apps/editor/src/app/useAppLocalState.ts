import { useState } from "react";
import type { OpenFileResult } from "../commands/fileCommands";
import type { WriteViewMode as ViewMode } from "@viritura/ui";
import { useViewStateStore } from "../store/viewStateStore";

type InspectorFocus = "tie" | "slur" | "markings" | "directions" | "layout" | null;

export interface AppLocalState {
  pageSetupTargetIndex: number | null;
  setPageSetupTargetIndex: React.Dispatch<React.SetStateAction<number | null>>;
  openedFile: OpenFileResult | null;
  setOpenedFile: React.Dispatch<React.SetStateAction<OpenFileResult | null>>;
  fileError: string | null;
  setFileError: React.Dispatch<React.SetStateAction<string | null>>;
  isDragOver: boolean;
  setIsDragOver: React.Dispatch<React.SetStateAction<boolean>>;
  fileHandle: FileSystemFileHandle | null;
  setFileHandle: React.Dispatch<React.SetStateAction<FileSystemFileHandle | null>>;
  selectedScoreIndex: number;
  setSelectedScoreIndex: React.Dispatch<React.SetStateAction<number>>;
  selectedPartIds: string[];
  setSelectedPartIds: React.Dispatch<React.SetStateAction<string[]>>;
  viewMode: ViewMode;
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
  expandedCondensingStaves: Set<string>;
  setExpandedCondensingStaves: React.Dispatch<React.SetStateAction<Set<string>>>;
  currentZoom: number;
  setCurrentZoom: React.Dispatch<React.SetStateAction<number>>;
  inspectorFocus: InspectorFocus;
}

/**
 * Bundles the ~12 `useState` declarations at the top of AppInner into
 * one hook returning a flat state bag. Cuts the AppInner statement
 * count without changing semantics — each field still backs a separate
 * useState slot.
 */
export function useAppLocalState(): AppLocalState {
  const [pageSetupTargetIndex, setPageSetupTargetIndex] = useState<number | null>(null);
  const [openedFile, setOpenedFile] = useState<OpenFileResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);
  // selectedScoreIndex / selectedPartIds / viewMode are hoisted to the shared
  // view-state store so they survive the Write ↔ Engrave mode switch.
  const selectedScoreIndex = useViewStateStore((s) => s.selectedScoreIndex);
  const setSelectedScoreIndex = useViewStateStore((s) => s.setSelectedScoreIndex);
  const selectedPartIds = useViewStateStore((s) => s.selectedPartIds);
  const setSelectedPartIds = useViewStateStore((s) => s.setSelectedPartIds);
  const viewMode = useViewStateStore((s) => s.viewMode);
  const setViewMode = useViewStateStore((s) => s.setViewMode);
  const [expandedCondensingStaves, setExpandedCondensingStaves] = useState<Set<string>>(new Set());
  const [currentZoom, setCurrentZoom] = useState(1.0);
  const [inspectorFocus] = useState<InspectorFocus>(null);

  return {
    pageSetupTargetIndex,
    setPageSetupTargetIndex,
    openedFile,
    setOpenedFile,
    fileError,
    setFileError,
    isDragOver,
    setIsDragOver,
    fileHandle,
    setFileHandle,
    selectedScoreIndex,
    setSelectedScoreIndex,
    selectedPartIds,
    setSelectedPartIds,
    viewMode,
    setViewMode,
    expandedCondensingStaves,
    setExpandedCondensingStaves,
    currentZoom,
    setCurrentZoom,
    inspectorFocus,
  };
}
