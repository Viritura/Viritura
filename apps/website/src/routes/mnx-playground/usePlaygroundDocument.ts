import { startTransition, useEffect, useState } from "react";
import { validateRawScore } from "@viritura/format";

export interface SourceValidation {
  readonly document?: object;
  readonly error?: string;
}

export function validatePlaygroundSource(source: string): SourceValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error) {
    return { error: error instanceof Error ? `JSON: ${error.message}` : "Invalid JSON" };
  }

  const validation = validateRawScore(parsed);
  if (!validation.ok) {
    const first = validation.errors[0];
    return { error: `Schema: ${first?.pointer ?? "(root)"} ${first?.message ?? "Invalid MNX document"}` };
  }
  return { document: parsed as object };
}

export function usePlaygroundDocument(initialSource: string, debounceMs = 220) {
  const initialValidation = validatePlaygroundSource(initialSource);
  const [source, setSource] = useState(initialSource);
  const [renderedDocument, setRenderedDocument] = useState<object>(initialValidation.document ?? {});
  const [candidateDocument, setCandidateDocument] = useState<object | null>(null);
  const [status, setStatus] = useState("Ready");
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const validation = validatePlaygroundSource(source);
      if (validation.error || !validation.document) {
        setStatus(validation.error ?? "Invalid MNX document");
        setHasError(true);
        setCandidateDocument(null);
        return;
      }
      setStatus("Rendering preview...");
      setHasError(false);
      startTransition(() => setCandidateDocument(validation.document ?? null));
    }, debounceMs);
    return () => window.clearTimeout(timeout);
  }, [debounceMs, source]);

  const acceptCandidate = () => {
    if (!candidateDocument) return;
    startTransition(() => setRenderedDocument(candidateDocument));
    setCandidateDocument(null);
    setStatus("Ready");
    setHasError(false);
  };

  const rejectCandidate = (error: Error) => {
    setCandidateDocument(null);
    setStatus(`Layout: ${error.message}`);
    setHasError(true);
  };

  return {
    source,
    setSource,
    renderedDocument,
    candidateDocument,
    status,
    hasError,
    acceptCandidate,
    rejectCandidate,
  };
}
