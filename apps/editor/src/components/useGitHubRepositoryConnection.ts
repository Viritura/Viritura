import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findGitHubRepository, listGitHubRepositories, type CreatedGitHubRepository } from "../github/api";
import type { RemoteCompatibility } from "../git/ProjectAdapter";
import {
  buildGitHubNewRepoUrl,
  formatDefaultRepository,
  normalizeDefaultRepositoryName,
  parseRepositoryInput,
  SAFE_COMPATIBILITY,
  type RepositoryVisibility,
  type RepositoryWizardStep,
  validateRepositoryInput,
  validateRepositoryName,
} from "./githubRepositoryConnection";

interface RepositoryConnectionOptions {
  open: boolean;
  ownerLogin: string;
  defaultRepositoryName?: string;
  onInspect: (repository: CreatedGitHubRepository) => Promise<RemoteCompatibility>;
}

export function useGitHubRepositoryConnection(options: RepositoryConnectionOptions) {
  const defaultName = normalizeDefaultRepositoryName(options.defaultRepositoryName);
  const [step, setStep] = useState<RepositoryWizardStep>("choose");
  const [name, setName] = useState(defaultName);
  const [visibility, setVisibility] = useState<RepositoryVisibility>("private");
  const [repositoryInput, setRepositoryInput] = useState(() =>
    formatDefaultRepository(options.ownerLogin, defaultName),
  );
  const [detectedRepository, setDetectedRepository] = useState<CreatedGitHubRepository | null>(null);
  const [compatibility, setCompatibility] = useState<RemoteCompatibility | null>(null);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [repositories, setRepositories] = useState<CreatedGitHubRepository[]>([]);
  const [repositoriesLoading, setRepositoriesLoading] = useState(false);
  const [repositoriesError, setRepositoriesError] = useState<string | null>(null);
  const [checkingExisting, setCheckingExisting] = useState(false);
  const inspectionIdRef = useRef(0);

  const validationError = useMemo(() => validateRepositoryName(name), [name]);
  const repositoryInputError = useMemo(() => validateRepositoryInput(repositoryInput), [repositoryInput]);
  const canConnect = compatibility !== null && SAFE_COMPATIBILITY.has(compatibility.kind);

  useEffect(() => {
    if (!options.open) {
      inspectionIdRef.current += 1;
      return;
    }
    const nextDefaultName = normalizeDefaultRepositoryName(options.defaultRepositoryName);
    inspectionIdRef.current += 1;
    setStep("choose");
    setName(nextDefaultName);
    setVisibility("private");
    setRepositoryInput(formatDefaultRepository(options.ownerLogin, nextDefaultName));
    setDetectedRepository(null);
    setCompatibility(null);
    setDetectionError(null);
  }, [options.open, options.defaultRepositoryName, options.ownerLogin]);

  const inspectRepository = useCallback(
    async (repository: CreatedGitHubRepository, inspectionId = ++inspectionIdRef.current) => {
      if (inspectionId !== inspectionIdRef.current) return;
      setStep("checking");
      setDetectionError(null);
      setDetectedRepository(repository);
      try {
        const result = await options.onInspect(repository);
        if (inspectionId !== inspectionIdRef.current) return;
        setCompatibility(result);
        setStep("result");
      } catch (error) {
        if (inspectionId !== inspectionIdRef.current) return;
        setCompatibility(null);
        setDetectionError(error instanceof Error ? error.message : "Could not inspect the repository history");
        setStep("result");
      }
    },
    [options.onInspect],
  );

  useEffect(() => {
    if (!options.open || step !== "waiting" || !options.ownerLogin || validationError) return;
    let cancelled = false;
    let checking = false;
    const checkRepository = async () => {
      if (checking) return;
      checking = true;
      try {
        const repository = await findGitHubRepository(options.ownerLogin, name.trim());
        if (!cancelled && repository) await inspectRepository(repository);
      } catch (error) {
        if (!cancelled) {
          setDetectionError(error instanceof Error ? error.message : "Could not check the GitHub repository");
        }
      } finally {
        checking = false;
      }
    };
    void checkRepository();
    const interval = window.setInterval(() => void checkRepository(), 2500);
    window.addEventListener("focus", checkRepository);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", checkRepository);
    };
  }, [inspectRepository, name, options.open, options.ownerLogin, step, validationError]);

  useEffect(() => {
    if (!options.open || step !== "link") return;
    let cancelled = false;
    setRepositoriesLoading(true);
    setRepositoriesError(null);
    void listGitHubRepositories()
      .then((result) => {
        if (!cancelled) setRepositories(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRepositoriesError(error instanceof Error ? error.message : "Could not list GitHub repositories");
        }
      })
      .finally(() => {
        if (!cancelled) setRepositoriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [options.open, step]);

  const openGitHub = () => {
    if (validationError) return;
    window.open(buildGitHubNewRepoUrl(name.trim(), visibility), "_blank", "noopener,noreferrer");
    setStep("waiting");
  };

  const checkExisting = async () => {
    const parsed = parseRepositoryInput(repositoryInput);
    if (!parsed) return;
    const inspectionId = ++inspectionIdRef.current;
    setCheckingExisting(true);
    setDetectionError(null);
    try {
      const repository = await findGitHubRepository(parsed.owner, parsed.name);
      if (inspectionId !== inspectionIdRef.current) return;
      if (!repository) {
        setDetectionError("Repository not found, or the Viritura GitHub App does not have access to it.");
        return;
      }
      await inspectRepository(repository, inspectionId);
    } catch (error) {
      if (inspectionId !== inspectionIdRef.current) return;
      setDetectionError(error instanceof Error ? error.message : "Could not check the GitHub repository");
    } finally {
      if (inspectionId === inspectionIdRef.current) setCheckingExisting(false);
    }
  };

  const updateRepositoryInput = (value: string) => {
    inspectionIdRef.current += 1;
    setCheckingExisting(false);
    setRepositoryInput(value);
    setDetectedRepository(null);
    setCompatibility(null);
    setDetectionError(null);
  };

  const returnToChoice = () => {
    inspectionIdRef.current += 1;
    setCheckingExisting(false);
    setStep("choose");
    setDetectedRepository(null);
    setCompatibility(null);
    setDetectionError(null);
  };

  return {
    step,
    setStep,
    name,
    setName,
    visibility,
    setVisibility,
    repositoryInput,
    setRepositoryInput: updateRepositoryInput,
    detectedRepository,
    compatibility,
    detectionError,
    validationError,
    repositoryInputError,
    repositories,
    repositoriesLoading,
    repositoriesError,
    checkingExisting,
    canConnect,
    openGitHub,
    checkExisting,
    returnToChoice,
  };
}
