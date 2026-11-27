import { useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import {
  Button,
  Checkbox,
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
import { serializeMnx } from "@viritura/format";
import { useGitHubAccount } from "../github/useGitHubAccount";
import { createGitHubGist } from "../github/api";
import { useDocumentStore, useDocumentStoreApi } from "../store/DocumentContext";
import { useProjectStore } from "../store/projectStore";
import { buildGistSetlistUrl, loadGistSetlist, parseGistUrl, prepareGistFiles } from "../gistShare";
import styles from "./GistShareDialog.module.css";

interface GistShareDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function GistShareDialog({ open, onClose }: GistShareDialogProps) {
  const githubAccount = useGitHubAccount();
  const currentMnx = useDocumentStore((state) => state.mnxJson);
  const documentStore = useDocumentStoreApi();
  const projectFolder = useProjectStore((state) => state.projectFolder);
  const activeScorePath = useProjectStore((state) => state.activeScorePath);
  const connected = githubAccount.session?.connected === true;
  const [gistUrl, setGistUrl] = useState("");
  const [pinRevision, setPinRevision] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharedFileCount, setSharedFileCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    setError(null);
    setShareUrl(null);
    try {
      const { mnxJson, workingScore, score, fileName } = documentStore.getState();
      const files = await prepareGistFiles({
        projectFolder,
        activeScorePath,
        fileName,
        currentMnx: workingScore && workingScore !== score ? JSON.stringify(serializeMnx(workingScore)) : mnxJson,
      });
      const created = await createGitHubGist({ files });
      const revision = pinRevision ? (await loadGistSetlist({ gistId: created.id })).revision : undefined;
      setShareUrl(buildGistSetlistUrl(window.location.origin, created.id, revision));
      setSharedFileCount(Object.keys(files).length);
      toast.success("Secret Gist created");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not create the Gist share link.");
    } finally {
      setLoading(false);
    }
  };

  const handleUseExistingGist = async () => {
    setLoading(true);
    setError(null);
    setShareUrl(null);
    try {
      const reference = parseGistUrl(gistUrl);
      const setlist = await loadGistSetlist({ gistId: reference.id });
      setShareUrl(
        buildGistSetlistUrl(window.location.origin, setlist.gistId, pinRevision ? setlist.revision : undefined),
      );
      setSharedFileCount(setlist.files.length);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not load the Gist setlist.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Share link copied");
    } catch {
      toast.error("Could not copy the preview link");
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Share MNX setlist</DialogTitle>
      <DialogBody>
        <p className={styles.description}>
          {projectFolder
            ? "Create a secret Gist with all MNX files in this project folder."
            : "Create a secret Gist with the currently open MNX file."}{" "}
          The link opens the setlist in Click mode. Secret Gists are unlisted, not private, and anyone with the link can
          forward it. A setlist can contain up to 50 MNX files and 512 MiB in total. Files over 8 MiB are stored
          compressed.
        </p>
        {connected ? (
          <p className={styles.hint}>Connected to GitHub as @{githubAccount.session?.viewer?.login}.</p>
        ) : (
          <Button size="sm" className={styles.secondaryButton} onClick={() => githubAccount.signIn("activity")}>
            Connect GitHub to create a secret Gist
          </Button>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {error?.includes("Reconnect GitHub") && (
          <Button size="sm" className={styles.secondaryButton} onClick={() => githubAccount.signIn("activity")}>
            Reconnect GitHub
          </Button>
        )}
        {shareUrl && (
          <div className={styles.result} aria-live="polite">
            <div className={styles.resultTitle}>
              <Check size={15} aria-hidden="true" />
              Share link ready for {sharedFileCount} MNX {sharedFileCount === 1 ? "file" : "files"}
            </div>
            <FormInput className={styles.shareUrl} value={shareUrl} readOnly aria-label="Viritura preview link" />
            <div className={styles.resultActions}>
              <Button size="sm" className={styles.secondaryButton} onClick={handleCopy}>
                Copy link
              </Button>
              <a className={styles.secondaryButton} href={shareUrl} target="_blank" rel="noreferrer">
                Open setlist
                <ExternalLink size={13} aria-hidden="true" />
              </a>
            </div>
          </div>
        )}
        <div className={styles.manual}>
          <FormField label="Use an existing Gist">
            <FormInput
              value={gistUrl}
              onChange={(event) => {
                setGistUrl(event.target.value);
                setError(null);
                setShareUrl(null);
              }}
              placeholder="https://gist.github.com/username/gist-id"
            />
          </FormField>
          <Checkbox
            className={styles.pinRevision}
            label="Pin the link to the current Gist revision"
            checked={pinRevision}
            onChange={(event) => {
              setPinRevision(event.target.checked);
              setShareUrl(null);
            }}
          />
          <Button
            size="sm"
            className={styles.secondaryButton}
            onClick={() => void handleUseExistingGist()}
            disabled={loading || !gistUrl.trim()}
            aria-busy={loading}
          >
            Create link from existing Gist
          </Button>
        </div>
      </DialogBody>
      <DialogActions>
        <DialogCancelButton>Close</DialogCancelButton>
        <DialogPrimaryButton
          onClick={() => void handleCreate()}
          disabled={loading || !connected || !currentMnx}
          aria-busy={loading}
        >
          Create secret Gist and link
        </DialogPrimaryButton>
      </DialogActions>
    </Dialog>
  );
}
