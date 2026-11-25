/**
 * Modal-flow service for promise-returning dialogs.
 *
 * Each helper stores its request in a standalone zustand store and resolves
 * when the user answers, for example:
 *
 *     await openFolderConfirm(folderName, count) // -> FolderConfirmChoice | null
 *     await openUnsavedChangesConfirm(fileName)  // -> UnsavedChangesChoice | null
 *
 * The actual dialog rendering lives in `<ModalFlowHost />`, mounted once
 * at the App shell so any caller can await a dialog from anywhere without
 * prop-drilling state.
 */

import { create } from "zustand";

import { type FolderConfirmChoice } from "../components/FolderConfirmDialog";

export type UnsavedChangesChoice = "save" | "discard";

interface UnsavedChangesState {
  fileName: string;
  resolve: (choice: UnsavedChangesChoice | null) => void;
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
interface PickupDurationState {
  meter: { count: number; unit: number };
  resolve: (duration: string | null) => void;
}

export type ExternalChangeChoice = "reload" | "overwrite";

interface ExternalChangeState {
  fileName: string;
  resolve: (choice: ExternalChangeChoice | null) => void;
}

interface ModalFlowStore {
  unsavedChanges: UnsavedChangesState | null;
  folderConfirm: FolderConfirmState | null;
  projectName: ProjectNameState | null;
  pickupDuration: PickupDurationState | null;
  externalChange: ExternalChangeState | null;
  _setUnsavedChanges: (next: UnsavedChangesState | null) => void;
  _setFolderConfirm: (next: FolderConfirmState | null) => void;
  _setProjectName: (next: ProjectNameState | null) => void;
  _setPickupDuration: (next: PickupDurationState | null) => void;
  _setExternalChange: (next: ExternalChangeState | null) => void;
}

export const useModalFlowStore = create<ModalFlowStore>((set) => ({
  unsavedChanges: null,
  folderConfirm: null,
  projectName: null,
  pickupDuration: null,
  externalChange: null,
  _setUnsavedChanges: (next) => set({ unsavedChanges: next }),
  _setFolderConfirm: (next) => set({ folderConfirm: next }),
  _setProjectName: (next) => set({ projectName: next }),
  _setPickupDuration: (next) => set({ pickupDuration: next }),
  _setExternalChange: (next) => set({ externalChange: next }),
}));

/**
 * Ask whether to save or discard unsaved changes before the open score is
 * replaced. Resolves with the choice, or null when the user cancels.
 */
export function openUnsavedChangesConfirm(fileName: string): Promise<UnsavedChangesChoice | null> {
  return new Promise((resolve) => {
    useModalFlowStore.getState()._setUnsavedChanges({ fileName, resolve });
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

export function openPickupDurationPrompt(meter: { count: number; unit: number }): Promise<string | null> {
  return new Promise((resolve) => {
    useModalFlowStore.getState()._setPickupDuration({ meter, resolve });
  });
}

export function openExternalChangeConfirm(fileName: string): Promise<ExternalChangeChoice | null> {
  return new Promise((resolve) => {
    useModalFlowStore.getState()._setExternalChange({ fileName, resolve });
  });
}
