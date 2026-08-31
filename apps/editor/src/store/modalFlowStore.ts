/**
 * Modal-flow service for the score-chooser and folder-confirm dialogs.
 *
 * Both dialogs are surfaced as part of the "open a folder project" pipeline
 * inside App.tsx. Previously they lived as a useState + useRef pair per
 * dialog, with a `prompt*` useCallback returning a Promise resolved from
 * the dialog's onConfirm/onCancel handlers.
 *
 * Phase A4 of the App state-extraction sweep moves all of that into a
 * standalone zustand store with two promise-returning helpers:
 *
 *     await openScoreChooser(folderName, scores) // -> DiscoveredScore | null
 *     await openFolderConfirm(folderName, count) // -> FolderConfirmChoice | null
 *
 * The signature is identical to the old `promptScoreChoice` /
 * `promptFolderConfirm` so call sites in openFolderHandle don't move.
 * The actual dialog rendering lives in `<ModalFlowHost />`, mounted once
 * at the App shell so any caller can `await openScoreChooser(...)` from
 * anywhere without prop-drilling state.
 */

import { create } from "zustand";

import { type DiscoveredScore } from "../store/folderScan";
import { type FolderConfirmChoice } from "../components/FolderConfirmDialog";

interface ScoreChooserState {
  folderName: string;
  scores: DiscoveredScore[];
  resolve: (chosen: DiscoveredScore | null) => void;
}

interface FolderConfirmState {
  folderName: string;
  scoreCount: number;
  resolve: (choice: FolderConfirmChoice | null) => void;
}

interface ProjectNameState {
  initialValue: string;
  resolve: (name: string | null) => void;
}

interface ModalFlowStore {
  scoreChooser: ScoreChooserState | null;
  folderConfirm: FolderConfirmState | null;
  projectName: ProjectNameState | null;
  _setScoreChooser: (next: ScoreChooserState | null) => void;
  _setFolderConfirm: (next: FolderConfirmState | null) => void;
  _setProjectName: (next: ProjectNameState | null) => void;
}

export const useModalFlowStore = create<ModalFlowStore>((set) => ({
  scoreChooser: null,
  folderConfirm: null,
  projectName: null,
  _setScoreChooser: (next) => set({ scoreChooser: next }),
  _setFolderConfirm: (next) => set({ folderConfirm: next }),
  _setProjectName: (next) => set({ projectName: next }),
}));

/**
 * Show the score chooser dialog and await the user's selection. Resolves
 * with the chosen score, or null if the user cancels. Safe to call from
 * any async flow — the dialog renders inside `<ModalFlowHost />`.
 */
export function openScoreChooser(folderName: string, scores: DiscoveredScore[]): Promise<DiscoveredScore | null> {
  return new Promise((resolve) => {
    useModalFlowStore.getState()._setScoreChooser({
      folderName,
      scores,
      resolve,
    });
  });
}

/**
 * Show the folder-confirm dialog (init git / open plain / cancel) and await
 * the user's choice. Resolves with the choice, or null on cancel/dismiss.
 */
export function openFolderConfirm(folderName: string, scoreCount: number): Promise<FolderConfirmChoice | null> {
  return new Promise((resolve) => {
    useModalFlowStore.getState()._setFolderConfirm({
      folderName,
      scoreCount,
      resolve,
    });
  });
}

export function openProjectNamePrompt(initialValue = "Untitled Project"): Promise<string | null> {
  return new Promise((resolve) => {
    useModalFlowStore.getState()._setProjectName({ initialValue, resolve });
  });
}
