import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { HarpPedalSolution, HarpPedalSolutionKind, Score } from "@viritura/core";
import type { DocumentStore } from "../store/documentStore";
import { applyHarpPedalSolution } from "./harpPedalCalculationEdits";
import { calculateHarpPedals } from "./calculationRunner";

interface Props {
  store: DocumentStore;
  target: { partId?: string; partIndex: number; generation: number } | null;
  updateScore: (score: Score) => void;
  onClose: () => void;
}

export function usePedalCalculation({ store, target, updateScore, onClose }: Props) {
  const [solutions, setSolutions] = useState<HarpPedalSolution[] | null>(null);
  const [selectedSolutionKind, setSelectedSolutionKind] = useState<HarpPedalSolutionKind | null>(null);
  const [busy, setBusy] = useState(false);
  const revision = useRef<ReturnType<DocumentStore["getState"]>["scoreRevision"] | null>(null);
  const job = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      job.current?.abort();
      job.current = null;
    },
    [],
  );

  function currentTarget() {
    const current = store.getState();
    const score = current.workingScore ?? current.score;
    if (!target || !score || current.documentGeneration !== target.generation) {
      toast.error("The score changed. Close and reopen the pedal editor.");
      return null;
    }
    const partIndex = target.partId ? score.parts.findIndex((part) => part.id === target.partId) : target.partIndex;
    if (partIndex < 0 || !score.parts[partIndex]) {
      toast.error("The harp part no longer exists.");
      return null;
    }
    return { score, partIndex, revision: current.scoreRevision };
  }

  function apply(solution: HarpPedalSolution): void {
    if (job.current) {
      toast.error("The pedal calculation is still running.");
      return;
    }
    const current = currentTarget();
    if (!current) return;
    if (current.revision !== revision.current) {
      toast.error("The score changed during calculation. Recalculating the available solutions.");
      void calculate();
      return;
    }
    updateScore(applyHarpPedalSolution(current.score, current.partIndex, solution));
    setSolutions(null);
    onClose();
  }

  async function calculate(): Promise<void> {
    const current = currentTarget();
    if (!current) return;
    job.current?.abort();
    const controller = new AbortController();
    job.current = controller;
    setSolutions(null);
    setBusy(true);
    try {
      const result = await calculateHarpPedals(current.score, current.partIndex, controller.signal);
      if (controller.signal.aborted) return;
      const latest = currentTarget();
      if (!latest) return;
      if (latest.revision !== current.revision) {
        toast.error("The score changed during calculation. Recalculating the available solutions.");
        void calculate();
        return;
      }
      revision.current = current.revision;
      job.current = null;
      setBusy(false);
      if (!result.solutions.length) {
        toast.error(result.error ?? "No complete harp pedal solution was found.");
        return;
      }
      if (result.solutions.length === 1) {
        apply(result.solutions[0]!);
        return;
      }
      const preferred = result.solutions.find((item) => item.kind === "no-respelling") ?? result.solutions[0]!;
      setSelectedSolutionKind(preferred.kind);
      setSolutions(result.solutions);
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(error instanceof Error ? error.message : "The harp pedal calculation failed.");
      }
    } finally {
      if (job.current === controller) {
        job.current = null;
        setBusy(false);
      }
    }
  }

  function cancel(): void {
    job.current?.abort();
    job.current = null;
    setBusy(false);
    setSolutions(null);
    setSelectedSolutionKind(null);
  }

  return { solutions, selectedSolutionKind, setSelectedSolutionKind, busy, calculate, apply, cancel };
}
