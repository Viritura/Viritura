/**
 * Renders the score-chooser + folder-confirm dialogs driven by
 * `useModalFlowStore`. Mount once near the App root; any caller in any
 * package can then `await openScoreChooser(...)` / `await openFolderConfirm(...)`
 * without needing to thread state or props.
 *
 * See `store/modalFlowStore.ts` for the promise-returning helpers and the
 * rationale (Phase A4 of the App state-extraction sweep).
 */

import { ScoreChooserDialog } from "./ScoreChooserDialog";
import { FolderConfirmDialog } from "./FolderConfirmDialog";
import { PromptDialog } from "@viritura/ui";
import { toast } from "sonner";
import { getProjectFolderNameError } from "../app/projectFolder";
import { useModalFlowStore } from "../store/modalFlowStore";

export function ModalFlowHost(): React.JSX.Element {
  const scoreChooser = useModalFlowStore((s) => s.scoreChooser);
  const folderConfirm = useModalFlowStore((s) => s.folderConfirm);
  const projectName = useModalFlowStore((s) => s.projectName);
  const setScoreChooser = useModalFlowStore((s) => s._setScoreChooser);
  const setFolderConfirm = useModalFlowStore((s) => s._setFolderConfirm);
  const setProjectName = useModalFlowStore((s) => s._setProjectName);

  return (
    <>
      {scoreChooser && (
        <ScoreChooserDialog
          open
          folderName={scoreChooser.folderName}
          scores={scoreChooser.scores}
          onChoose={(score) => {
            scoreChooser.resolve(score);
            setScoreChooser(null);
          }}
          onCancel={() => {
            scoreChooser.resolve(null);
            setScoreChooser(null);
          }}
        />
      )}
      {folderConfirm && (
        <FolderConfirmDialog
          open
          folderName={folderConfirm.folderName}
          scoreCount={folderConfirm.scoreCount}
          onChoose={(choice) => {
            folderConfirm.resolve(choice);
            setFolderConfirm(null);
          }}
          onCancel={() => {
            folderConfirm.resolve(null);
            setFolderConfirm(null);
          }}
        />
      )}
      {projectName && (
        <PromptDialog
          open
          title="New Project"
          description="Name the project folder Viritura will create inside the location you choose next."
          label="Project name"
          initialValue={projectName.initialValue}
          confirmLabel="Choose Location…"
          allowEmpty={false}
          onSubmit={(value) => {
            const error = getProjectFolderNameError(value);
            if (error) {
              toast.error(error);
              return false;
            }
            projectName.resolve(value.trim());
            setProjectName(null);
          }}
          onClose={() => {
            projectName.resolve(null);
            setProjectName(null);
          }}
        />
      )}
    </>
  );
}
