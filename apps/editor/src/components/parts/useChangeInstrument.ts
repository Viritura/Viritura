import { useCallback, useState } from "react";
import type { Score } from "@viritura/core";
import { toast } from "sonner";
import type { CatalogInstrument } from "../../score/InstrumentCatalog";
import {
  analyzeInstrumentChange,
  changeInstrumentInScore,
  type InstrumentChangeAnalysis,
} from "../../score/changeInstrument";
import type { InstrumentCompatibility } from "./InstrumentCatalogPicker";

interface UseChangeInstrumentArgs {
  score: Score | null;
  updateScore: (score: Score) => void;
  onAddInstrument?: (instrumentId: string, targetLayoutIds?: readonly string[]) => void;
}

/** Compatibility-aware existing-part instrument replacement workflow. */
export function useChangeInstrument({ score, updateScore, onAddInstrument }: UseChangeInstrumentArgs) {
  const [partId, setPartId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ instrument: CatalogInstrument; analysis: InstrumentChangeAnalysis } | null>(
    null,
  );

  const apply = useCallback(
    (instrument: CatalogInstrument) => {
      if (!score || !partId) return;
      const updated = changeInstrumentInScore(score, partId, instrument.id);
      if (!updated) return;
      updateScore(updated);
      setPartId(null);
      setPending(null);
      toast.success(`Changed instrument to ${instrument.name}`);
    },
    [score, partId, updateScore],
  );

  const select = useCallback(
    (instrument: CatalogInstrument) => {
      if (!score || !partId) return;
      const analysis = analyzeInstrumentChange(score, partId, instrument.id);
      if (!analysis.allowed || analysis.warning) setPending({ instrument, analysis });
      else apply(instrument);
    },
    [score, partId, apply],
  );

  const compatibility = useCallback(
    (instrument: CatalogInstrument): InstrumentCompatibility => {
      if (!score || !partId) return { status: "blocked", message: "No part is selected." };
      const analysis = analyzeInstrumentChange(score, partId, instrument.id);
      return {
        status: !analysis.allowed ? "blocked" : analysis.warning ? "warning" : "compatible",
        message: analysis.reason ?? analysis.warning ?? "Existing music will be preserved.",
      };
    },
    [score, partId],
  );

  const confirm = useCallback(() => {
    if (!pending) return;
    if (pending.analysis.allowed) apply(pending.instrument);
    else onAddInstrument?.(pending.instrument.id);
    setPending(null);
  }, [pending, apply, onAddInstrument]);

  return {
    partId,
    setPartId,
    pending,
    select,
    compatibility,
    confirm,
    cancelConfirmation: () => setPending(null),
  };
}
