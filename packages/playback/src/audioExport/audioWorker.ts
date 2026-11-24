/// <reference lib="webworker" />

import { renderScoreAudio } from "./renderAudio";
import type { AudioRenderRequest, AudioRenderResponse } from "./messages";

const worker = self as DedicatedWorkerGlobalScope;

worker.addEventListener("message", ({ data }: MessageEvent<AudioRenderRequest>) => {
  void renderScoreAudio(
    data.score,
    data.soundfont,
    data.encoding,
    (fraction) => {
      const response: AudioRenderResponse = { type: "progress", fraction };
      worker.postMessage(response);
    },
    data.mix,
    { stage: data.stage, effects: data.effects },
  ).then(
    ({ bytes, warnings }) => {
      const response: AudioRenderResponse = { type: "complete", bytes: bytes.buffer, warnings };
      worker.postMessage(response, [bytes.buffer]);
    },
    (error: unknown) => {
      const response: AudioRenderResponse = {
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      };
      worker.postMessage(response);
    },
  );
});
