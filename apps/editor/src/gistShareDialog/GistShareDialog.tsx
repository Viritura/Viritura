import { useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import {
  Checkbox,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogCancelButton,
  DialogPrimaryButton,
  DialogTitle,
  FormField,
  FormInput,
} from "@viritura/ui";
import { toast } from "sonner";
import { buildGistShareUrl, loadGistMnx, parseGistUrl } from "../gistShare";
import styles from "./GistShareDialog.module.css";

interface GistShareDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function GistShareDialog({ open, onClose }: GistShareDialogProps) {
  const [gistUrl, setGistUrl] = useState("");
  const [pinRevision, setPinRevision] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    setError(null);
    setShareUrl(null);
    try {
      const reference = parseGistUrl(gistUrl);
      const loaded = await loadGistMnx({ gistId: reference.id });
      const nextShareUrl = buildGistShareUrl(
        window.location.origin,
        loaded.gistId,
        pinRevision ? loaded.revision : undefined,
      );
      setShareUrl(nextShareUrl);
      setFileName(loaded.fileName);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not create the preview link.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Preview link copied");
    } catch {
      toast.error("Could not copy the preview link");
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Share from GitHub Gist</DialogTitle>
      <DialogBody>
        <p className={styles.description}>
          Create a public or secret Gist containing exactly one <code>.mnx</code> file, then paste its URL here. Secret
          Gists are unlisted, not private, and anyone with the link can forward it.
        </p>
        <a className={styles.gistLink} href="https://gist.github.com/" target="_blank" rel="noreferrer">
          Create a GitHub Gist
          <ExternalLink size={14} aria-hidden="true" />
        </a>
        <FormField label="GitHub Gist URL" error={error ?? undefined}>
          <FormInput
            value={gistUrl}
            onChange={(event) => {
              setGistUrl(event.target.value);
              setError(null);
              setShareUrl(null);
            }}
            placeholder="https://gist.github.com/username/gist-id"
            autoFocus
          />
        </FormField>
        <Checkbox
          label="Pin the preview to the current Gist revision"
          checked={pinRevision}
          onChange={(event) => {
            setPinRevision(event.target.checked);
            setShareUrl(null);
          }}
        />
        <p className={styles.hint}>
          {pinRevision
            ? "The preview will keep showing this revision after the Gist changes."
            : "The preview will follow future edits to the Gist."}
        </p>
        {shareUrl && (
          <div className={styles.result} aria-live="polite">
            <div className={styles.resultTitle}>
              <Check size={15} aria-hidden="true" />
              Preview ready for {fileName}
            </div>
            <FormInput className={styles.shareUrl} value={shareUrl} readOnly aria-label="Viritura preview link" />
            <div className={styles.resultActions}>
              <Button size="sm" className={styles.secondaryButton} onClick={handleCopy}>
                Copy link
              </Button>
              <a className={styles.secondaryButton} href={shareUrl} target="_blank" rel="noreferrer">
                Open preview
                <ExternalLink size={13} aria-hidden="true" />
              </a>
            </div>
          </div>
        )}
      </DialogBody>
      <DialogActions>
        <DialogCancelButton>Close</DialogCancelButton>
        <DialogPrimaryButton onClick={handleCreate} disabled={loading || !gistUrl.trim()} aria-busy={loading}>
          Create preview link
        </DialogPrimaryButton>
      </DialogActions>
    </Dialog>
  );
}
