import { useState } from "react";
import { AlertTriangle, Check, ExternalLink, Link, Plus } from "lucide-react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogCancelButton,
  DialogPrimaryButton,
  DialogSecondaryButton,
  DialogTitle,
  FormField,
  FormInput,
  Radio,
  RadioGroup,
} from "@viritura/ui";
import { toast } from "sonner";
import type { CreatedGitHubRepository, GitHubInstallationStatus } from "../github/api";
import { getGitHubInstallationStartUrl } from "../github/api";
import type { RemoteCompatibility } from "../git/ProjectAdapter";
import { describeCompatibility, type RepositoryVisibility } from "./githubRepositoryConnection";
import { useGitHubRepositoryConnection } from "./useGitHubRepositoryConnection";
import { GitHubRepositoryCombobox } from "./GitHubRepositoryCombobox";
import styles from "./CreateGitHubRepositoryDialog.module.css";
import { GitHubMark } from "../brand/GitHubMark";

interface ConnectGitHubRepositoryRequest {
  readonly repository: CreatedGitHubRepository;
  readonly compatibility: RemoteCompatibility;
}

interface CreateGitHubRepositoryDialogProps {
  readonly open: boolean;
  readonly ownerLogin: string;
  readonly installUrl: string | null;
  readonly installation: GitHubInstallationStatus | null;
  readonly defaultRepositoryName?: string;
  readonly onClose: () => void;
  readonly onInspect: (repository: CreatedGitHubRepository) => Promise<RemoteCompatibility>;
  readonly onConnect: (request: ConnectGitHubRepositoryRequest) => Promise<void>;
}

type ConnectionState = ReturnType<typeof useGitHubRepositoryConnection>;

export function CreateGitHubRepositoryDialog(props: CreateGitHubRepositoryDialogProps) {
  const connection = useGitHubRepositoryConnection(props);
  const [connecting, setConnecting] = useState(false);
  const needsInstallOrSelection =
    !props.installation?.installed ||
    props.installation.suspended ||
    props.installation.repositorySelection === "selected";

  const handleConnect = async () => {
    if (!connection.detectedRepository || !connection.compatibility || !connection.canConnect) return;
    setConnecting(true);
    try {
      await props.onConnect({
        repository: connection.detectedRepository,
        compatibility: connection.compatibility,
      });
      connection.setStep("connected");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "GitHub connection failed");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Dialog open={props.open} onClose={props.onClose}>
      <DialogTitle>Connect a GitHub repository</DialogTitle>
      <DialogBody className={styles.dialogBody}>
        <div className={styles.repoOwnerRow}>
          <GitHubMark size={16} aria-hidden="true" />
          <span>{props.ownerLogin ? `@${props.ownerLogin}` : "GitHub account"}</span>
        </div>
        <ConnectionBody
          connection={connection}
          installUrl={props.installUrl}
          installationInstalled={props.installation?.installed === true}
          needsInstallOrSelection={needsInstallOrSelection}
        />
      </DialogBody>
      <ConnectionActions
        connection={connection}
        connecting={connecting}
        onClose={props.onClose}
        onConnect={() => void handleConnect()}
      />
    </Dialog>
  );
}

function ConnectionBody({
  connection,
  installUrl,
  installationInstalled,
  needsInstallOrSelection,
}: {
  connection: ConnectionState;
  installUrl: string | null;
  installationInstalled: boolean;
  needsInstallOrSelection: boolean;
}) {
  const installationHint =
    installUrl && needsInstallOrSelection ? (
      <InstallationHint installUrl={installUrl} installed={installationInstalled} />
    ) : null;

  switch (connection.step) {
    case "choose":
      return (
        <ConnectionChoices onCreate={() => connection.setStep("create")} onLink={() => connection.setStep("link")} />
      );
    case "create":
      return <CreateRepositoryFields connection={connection} />;
    case "link":
      return <ExistingRepositoryFields connection={connection} installationHint={installationHint} />;
    case "waiting":
      return (
        <>
          <p className={styles.stepDescription} aria-live="polite">
            We opened GitHub with <strong>{connection.name}</strong> ({connection.visibility}) ready to create. Finish
            creating the empty repository there, then return here. Viritura is waiting for access.
          </p>
          {installationHint}
          <DetectionError message={connection.detectionError} />
        </>
      );
    case "checking":
      return (
        <p className={styles.stepDescription} aria-live="polite">
          Checking repository history for compatibility.
        </p>
      );
    case "result":
      return connection.detectedRepository ? (
        <CompatibilityResult
          repository={connection.detectedRepository}
          compatibility={connection.compatibility}
          error={connection.detectionError}
        />
      ) : null;
    case "connected":
      return connection.detectedRepository ? <ConnectedRepository repository={connection.detectedRepository} /> : null;
  }
}

function ConnectionChoices({ onCreate, onLink }: { onCreate: () => void; onLink: () => void }) {
  return (
    <div className={styles.flowChoices}>
      <Button className={styles.flowChoice} variant="ghost" onClick={onCreate}>
        <Plus size={18} aria-hidden="true" />
        <span>
          <strong>Create new repository</strong>
          <small>Publish this project to a new, empty GitHub repository.</small>
        </span>
      </Button>
      <Button className={styles.flowChoice} variant="ghost" onClick={onLink}>
        <Link size={18} aria-hidden="true" />
        <span>
          <strong>Link existing repository</strong>
          <small>Reconnect an empty repository or one that shares this project&apos;s history.</small>
        </span>
      </Button>
    </div>
  );
}

function CreateRepositoryFields({ connection }: { connection: ConnectionState }) {
  return (
    <>
      <FormField label="Repository name" error={connection.validationError ?? undefined}>
        <FormInput
          value={connection.name}
          onChange={(event) => connection.setName(event.target.value)}
          placeholder="viritura-score"
          autoFocus
        />
      </FormField>
      <FormField label="Visibility">
        <RadioGroup
          value={connection.visibility}
          onChange={(value) => connection.setVisibility(value as RepositoryVisibility)}
          layout="inline"
        >
          <Radio value="private" label="Private" />
          <Radio value="public" label="Public" />
        </RadioGroup>
      </FormField>
    </>
  );
}

function ExistingRepositoryFields({
  connection,
  installationHint,
}: {
  connection: ConnectionState;
  installationHint: React.ReactNode;
}) {
  return (
    <>
      <p className={styles.stepDescription}>
        Enter an existing repository as <strong>owner/name</strong> or paste its GitHub URL. Viritura checks its history
        before changing this project.
      </p>
      <FormField label="GitHub repository" error={connection.repositoryInputError ?? undefined}>
        <GitHubRepositoryCombobox
          value={connection.repositoryInput}
          repositories={connection.repositories}
          loading={connection.repositoriesLoading}
          error={connection.repositoriesError}
          onChange={connection.setRepositoryInput}
        />
      </FormField>
      <DetectionError message={connection.detectionError} />
      {installationHint}
    </>
  );
}

function ConnectionActions({
  connection,
  connecting,
  onClose,
  onConnect,
}: {
  connection: ConnectionState;
  connecting: boolean;
  onClose: () => void;
  onConnect: () => void;
}) {
  if (connection.step === "connected") {
    return (
      <DialogActions>
        <DialogPrimaryButton onClick={onClose}>Close</DialogPrimaryButton>
      </DialogActions>
    );
  }

  return (
    <DialogActions>
      <DialogCancelButton>Close</DialogCancelButton>
      {connection.step !== "choose" && connection.step !== "checking" && (
        <DialogSecondaryButton onClick={connection.returnToChoice}>Back</DialogSecondaryButton>
      )}
      {connection.step === "create" && (
        <DialogPrimaryButton onClick={connection.openGitHub} disabled={Boolean(connection.validationError)}>
          Create on GitHub
        </DialogPrimaryButton>
      )}
      {connection.step === "link" && (
        <DialogPrimaryButton
          onClick={() => void connection.checkExisting()}
          disabled={Boolean(connection.repositoryInputError) || connection.checkingExisting}
        >
          {connection.checkingExisting ? "Checking" : "Check repository"}
        </DialogPrimaryButton>
      )}
      {connection.step === "result" && connection.canConnect && (
        <DialogPrimaryButton onClick={onConnect} disabled={connecting}>
          {connecting ? "Publishing" : "Connect and publish"}
        </DialogPrimaryButton>
      )}
    </DialogActions>
  );
}

function InstallationHint({ installUrl, installed }: { installUrl: string; installed: boolean }) {
  return (
    <a className={styles.installHint} href={getGitHubInstallationStartUrl(installUrl)} target="_blank" rel="noreferrer">
      <ExternalLink size={14} aria-hidden="true" />
      <span>{installed ? "Select repository in GitHub" : "Install App and select repository"}</span>
    </a>
  );
}

function DetectionError({ message }: { message: string | null }) {
  return message ? (
    <p className={styles.detectionError} role="alert">
      {message}
    </p>
  ) : null;
}

function CompatibilityResult({
  repository,
  compatibility,
  error,
}: {
  repository: CreatedGitHubRepository;
  compatibility: RemoteCompatibility | null;
  error: string | null;
}) {
  if (!compatibility) {
    return (
      <div className={styles.blockedStatus} role="alert">
        <AlertTriangle size={18} aria-hidden="true" />
        <div>
          <strong>Could not verify repository history</strong>
          <span>{error ?? "Try checking the repository again."}</span>
        </div>
      </div>
    );
  }
  const result = describeCompatibility(compatibility);
  return (
    <div className={result.safe ? styles.detectedStatus : styles.blockedStatus} aria-live="polite">
      {result.safe ? <Check size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
      <div>
        <strong>{result.title}</strong>
        <span>{repository.fullName}</span>
        <span>{result.description}</span>
      </div>
    </div>
  );
}

function ConnectedRepository({ repository }: { repository: CreatedGitHubRepository }) {
  return (
    <>
      <p className={styles.stepDescription} aria-live="polite">
        The project is connected and its local history is published to GitHub.
      </p>
      <a className={styles.createdLink} href={repository.htmlUrl} target="_blank" rel="noreferrer">
        <Check size={14} aria-hidden="true" />
        <span>{repository.fullName}</span>
        <ExternalLink size={13} aria-hidden="true" />
      </a>
    </>
  );
}
