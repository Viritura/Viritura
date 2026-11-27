import { calculateHarpPedalSolutions } from "@viritura/core";
import type { CalculationRequest, CalculationResponse } from "./calculationRunner";

self.onmessage = (event: MessageEvent<CalculationRequest>) => {
  let response: CalculationResponse;
  try {
    response = { kind: "result", result: calculateHarpPedalSolutions(event.data.score, event.data.partIndex) };
  } catch (error) {
    response = {
      kind: "error",
      message: error instanceof Error ? error.message : "The harp pedal calculation failed.",
    };
  }
  self.postMessage(response);
};
