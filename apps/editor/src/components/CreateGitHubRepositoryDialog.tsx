/**
 * CreateGitHubRepositoryDialog — modal for provisioning a new repo on a
 * connected GitHub account. Extracted from the (now-retired)
 * `GitHubAccountButton`; the consolidated `AccountButton` no longer
 * embeds repo-creation flow inline.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import {
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
import type { CreatedGitHubRepository, GitHubInstallationStatus } from "../github/api";
import styles from "./CreateGitHubRepositoryDialog.module.css";
import { GitHubMark } from "../brand/GitHubMark";

const REPO_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export function CreateGitHubRepositoryDialog({
  open,
  ownerLogin,
  installUrl,
  installation,
  defaultRepositoryName,
  onClose,
  onCreate,
}: {
  readonly open: boolean;
  readonly ownerLogin: string;
  readonly installUrl: string | null;
  readonly installation: GitHubInstallationStatus | null;
  readonly defaultRepositoryName?: string;
  readonly onClose: () => void;
  readonly onCreate: (request: {
    name: string;
    description?: string;
    private: boolean;
    autoInit: boolean;
  }) => Promise<CreatedGitHubRepository>;
}) {
  const [name, setName] = useState(() => normalizeDefaultRepositoryName(defaultRepositoryName));
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [createdRepository, setCreatedRepository] = useState<CreatedGitHubRepository | null>(null);

  const validationError = useMemo(() => validateRepositoryName(name), [name]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
    setName(normalizeDefaultRepositoryName(defaultRepositoryName));
    setDescription("");
    setIsPrivate(true);
    setCreatedRepository(null);
  }, [open, defaultRepositoryName]);

  const handleCreate = async () => {
    if (validationError) return;
    setSubmitting(true);
    setCreatedRepository(null);
    try {
      const repository = await onCreate({
        name: name.trim(),
        description: description.trim() || undefined,
        private: isPrivate,
        autoInit: false,
      });
      setCreatedRepository(repository);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "GitHub request failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Create GitHub repository</DialogTitle>
      <DialogBody>
        <div className={styles.repoOwnerRow}>
          <GitHubMark size={16} aria-hidden="true" />
          <span>{ownerLogin ? `@${ownerLogin}` : "GitHub account"}</span>
        </div>
        {installUrl && installation?.canCreateRepositories !== true && (
          <a className={styles.installHint} href={installUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={14} aria-hidden="true" />
            <span>
              {installation?.installed ? "Update Viritura installation" : "Install Viritura on this account first"}
            </span>
          </a>
        )}
        <FormField label="Repository name" error={validationError ?? undefined}>
          <FormInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="viritura-score"
            autoFocus
          />
        </FormField>
        <FormField label="Description">
          <FormInput
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Score project"
          />
        </FormField>
        <div className={styles.checkboxStack}>
          <Checkbox label="Private" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} />
        </div>
        {createdRepository && (
          <a className={styles.createdLink} href={createdRepository.htmlUrl} target="_blank" rel="noreferrer">
            <Check size={14} aria-hidden="true" />
            <span>{createdRepository.fullName}</span>
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        )}
      </DialogBody>
      <DialogActions>
        <DialogCancelButton>Close</DialogCancelButton>
        <DialogPrimaryButton onClick={handleCreate} disabled={Boolean(validationError) || submitting}>
          {submitting ? "Creating…" : "Create"}
        </DialogPrimaryButton>
      </DialogActions>
    </Dialog>
  );
}

function validateRepositoryName(value: string): string | null {
  const name = value.trim();
  if (!name) return "Enter a repository name.";
  if (name.length > 100) return "Use 100 characters or fewer.";
  if (!REPO_NAME_PATTERN.test(name)) return "Use letters, numbers, dots, underscores, or hyphens.";
  if (name === "." || name === "..") return "Choose a different repository name.";
  return null;
}

function normalizeDefaultRepositoryName(value: string | undefined): string {
  const normalized = (value?.trim() || "viritura-score")
    .replace(/\.mnx$/i, "")
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return normalized || "viritura-score";
}
