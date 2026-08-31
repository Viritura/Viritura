import { useCallback, useEffect, useRef, type RefObject } from "react";
import { Sf2Sampler, Sf2Synth } from "@viritura/audio";

interface UsePercussionPreviewArgs {
  ensureEngine: () => unknown;
  audioContextRef: RefObject<AudioContext | null>;
  masterOutputRef: RefObject<GainNode | null>;
  sf2BufferRef: RefObject<ArrayBuffer | null>;
  sf2FetchPromiseRef: RefObject<Promise<ArrayBuffer | null> | null>;
}

/** Dedicated drum-channel preview independent of the currently loaded score's samplers. */
export function usePercussionPreview({
  ensureEngine,
  audioContextRef,
  masterOutputRef,
  sf2BufferRef,
  sf2FetchPromiseRef,
}: UsePercussionPreviewArgs) {
  const previewRef = useRef<{ program: number; synth: Sf2Synth; sampler: Sf2Sampler } | null>(null);

  useEffect(() => () => previewRef.current?.synth.destroy(), []);

  return useCallback(
    async (midiNote: number, drumKitProgram = 0, velocity = 100, durationMs = 500) => {
      ensureEngine();
      const context = audioContextRef.current;
      const output = masterOutputRef.current;
      if (!context || !output) return;
      if (context.state === "suspended") await context.resume();
      let buffer = sf2BufferRef.current;
      if (!buffer && sf2FetchPromiseRef.current) buffer = await sf2FetchPromiseRef.current;
      if (!buffer) return;

      let preview = previewRef.current;
      if (!preview || preview.program !== drumKitProgram || preview.synth.context !== context) {
        preview?.synth.destroy();
        const synth = await Sf2Synth.create(context, buffer);
        synth.outputNode.connect(output);
        preview = {
          program: drumKitProgram,
          synth,
          sampler: new Sf2Sampler(synth, 9, 0, { isDrum: true, drumKitProgram }),
        };
        previewRef.current = preview;
      }
      const now = context.currentTime;
      preview.sampler.noteOn(midiNote, velocity, now);
      preview.sampler.noteOff(midiNote, now + durationMs / 1000);
    },
    [ensureEngine, audioContextRef, masterOutputRef, sf2BufferRef, sf2FetchPromiseRef],
  );
}
