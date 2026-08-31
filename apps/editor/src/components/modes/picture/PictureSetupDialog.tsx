import { useCallback, useRef, useState } from "react";
import { DEMO_VIDEO_SOURCES, VIDEO_FILE_ACCEPT, useVideoSyncActions, useVideoSyncState } from "@viritura/video-sync";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogHeader,
  DialogPrimaryButton,
  FormInput,
  SectionLabel,
} from "@viritura/ui";
import { Film, Timer } from "lucide-react";
import { PictureTimingSettings } from "./TimecodePanel";
import styles from "./PictureSetupDialog.module.css";

export interface PictureSetupDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function PictureSetupDialog({ open, onClose }: PictureSetupDialogProps) {
  const state = useVideoSyncState();
  const actions = useVideoSyncActions();
  const [timingEditing, setTimingEditing] = useState(false);
  const [timingEditorKey, setTimingEditorKey] = useState(0);
  const videoSectionRef = useRef<HTMLElement | null>(null);
  const close = useCallback(() => {
    setTimingEditing(false);
    onClose();
  }, [onClose]);

  const handleFile = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (file) void actions.attachFile(file);
    },
    [actions],
  );

  const hasClip = state.mediaName !== null;

  return (
    <Dialog
      open={open}
      onClose={close}
      size="wide"
      onEscapeKeyDown={(event) => {
        if (!timingEditing) return;
        event.preventDefault();
        setTimingEditing(false);
        setTimingEditorKey((current) => current + 1);
        setTimeout(() => {
          videoSectionRef.current
            ?.closest('[role="dialog"]')
            ?.querySelector<HTMLButtonElement>('button[aria-label="Close"]')
            ?.focus();
        }, 0);
      }}
    >
      <DialogHeader title="Picture setup" onClose={close} />
      <DialogBody className={styles.body}>
        <section ref={videoSectionRef} className={styles.section}>
          <SectionLabel label="Video file" icon={<Film size={12} />} />
          <div className={styles.fileSummary}>
            <span className={styles.fileName}>{state.mediaName ?? "No picture selected"}</span>
            <span className={styles.fileStatus}>{attachmentLabel(state.attachment)}</span>
          </div>
          <div className={styles.fileActions}>
            <label className={styles.fileButton}>
              <FormInput type="file" accept={VIDEO_FILE_ACCEPT} className={styles.fileInput} onChange={handleFile} />
              <span>{hasClip ? "Relink…" : "Choose video…"}</span>
            </label>
            {!hasClip &&
              DEMO_VIDEO_SOURCES.map((source) => (
                <Button
                  key={source.id}
                  variant="ghost"
                  size="sm"
                  label="Try demo clip"
                  tooltip={`${source.title} — ${source.description}`}
                  onClick={() => void actions.attachDemo(source)}
                />
              ))}
          </div>
          {state.errorMessage && (
            <p className={styles.error} role="alert">
              {state.errorMessage}
            </p>
          )}
        </section>

        {hasClip && (
          <section className={styles.section}>
            <SectionLabel label="Clip timing" icon={<Timer size={12} />} />
            <PictureTimingSettings key={timingEditorKey} onEditingChange={setTimingEditing} />
          </section>
        )}
      </DialogBody>
      <DialogActions>
        <DialogPrimaryButton onClick={close}>{hasClip ? "Done" : "Close"}</DialogPrimaryButton>
      </DialogActions>
    </Dialog>
  );
}

function attachmentLabel(attachment: ReturnType<typeof useVideoSyncState>["attachment"]): string {
  switch (attachment) {
    case "loading":
      return "Loading…";
    case "ready":
      return "Ready";
    case "offline":
      return "Relink required";
    case "error":
      return "Could not load";
    default:
      return "";
  }
}
