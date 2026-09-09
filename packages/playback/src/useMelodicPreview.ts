import { useCallback, useEffect, useRef, type RefObject } from "react";
import { Sf2Sampler, Sf2Synth } from "@viritura/audio";

interface UseMelodicPreviewArgs {
  sf2BufferRef: RefObject<ArrayBuffer | null>;
  sf2FetchPromiseRef: RefObject<Promise<ArrayBuffer | null> | null>;
}

interface Preview {
  program: number;
  synth: Sf2Synth;
  sampler: Sf2Sampler;
}

interface PreviewInitialization {
  program: number;
  context: AudioContext;
  promise: Promise<Preview>;
}

interface MutableValue<T> {
  current: T;
}

async function createPreview(context: AudioContext, buffer: ArrayBuffer, program: number): Promise<Preview> {
  const synth = await Sf2Synth.create(context, buffer);
  synth.outputNode.connect(context.destination);
  const preview = {
    program,
    synth,
    sampler: new Sf2Sampler(synth, 0, program),
  };
  await synth.warmUp([0]);
  return preview;
}

async function resolvePreview(args: {
  context: AudioContext;
  buffer: ArrayBuffer;
  program: number;
  previewRef: MutableValue<Preview | null>;
  initializationRef: MutableValue<PreviewInitialization | null>;
  disposedRef: MutableValue<boolean>;
}): Promise<Preview | null> {
  const { context, buffer, program, previewRef, initializationRef, disposedRef } = args;
  const existing = previewRef.current;
  if (existing?.program === program && existing.synth.context === context) return existing;

  let initialization = initializationRef.current;
  if (!initialization || initialization.program !== program || initialization.context !== context) {
    existing?.synth.destroy();
    previewRef.current = null;
    initialization = { program, context, promise: createPreview(context, buffer, program) };
    initializationRef.current = initialization;
  }

  let preview: Preview;
  try {
    preview = await initialization.promise;
  } catch (error) {
    if (initializationRef.current === initialization) initializationRef.current = null;
    throw error;
  }
  if (disposedRef.current) {
    preview.synth.destroy();
    return null;
  }

  const currentInitialization = initializationRef.current;
  if (currentInitialization && currentInitialization !== initialization) {
    preview.synth.destroy();
    return null;
  }
  if (currentInitialization === initialization) {
    initializationRef.current = null;
    previewRef.current = preview;
  } else if (previewRef.current !== preview) {
    preview.synth.destroy();
    return null;
  }
  return preview;
}

/** Dedicated melodic preview independent of the instruments loaded by the score. */
export function useMelodicPreview({ sf2BufferRef, sf2FetchPromiseRef }: UseMelodicPreviewArgs) {
  const previewRef = useRef<Preview | null>(null);
  const initializationRef = useRef<PreviewInitialization | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const heldNotesRef = useRef(new Map<number, { program: number; token: number }>());
  const noteTokenRef = useRef(0);
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      heldNotesRef.current.clear();
      previewRef.current?.synth.destroy();
      if (contextRef.current?.state !== "closed") void contextRef.current?.close();
    };
  }, []);

  const noteOn = useCallback(
    async (midiNote: number, program = 0, velocity = 80) => {
      const token = ++noteTokenRef.current;
      heldNotesRef.current.set(midiNote, { program, token });
      let context = contextRef.current;
      if (!context || context.state === "closed") {
        context = new AudioContext({ latencyHint: "interactive" });
        contextRef.current = context;
      }
      if (context.state === "suspended") await context.resume();
      let buffer = sf2BufferRef.current;
      if (!buffer && sf2FetchPromiseRef.current) buffer = await sf2FetchPromiseRef.current;
      if (!buffer) return;

      const preview = await resolvePreview({ context, buffer, program, previewRef, initializationRef, disposedRef });
      if (!preview) return;
      const heldNote = heldNotesRef.current.get(midiNote);
      if (heldNote?.program !== program || heldNote.token !== token) return;
      const now = context.currentTime;
      preview.sampler.noteOn(midiNote, velocity, now);
    },
    [sf2BufferRef, sf2FetchPromiseRef],
  );

  const noteOff = useCallback((midiNote: number) => {
    heldNotesRef.current.delete(midiNote);
    const preview = previewRef.current;
    if (preview) preview.sampler.noteOff(midiNote, preview.synth.context.currentTime);
  }, []);

  const allNotesOff = useCallback(() => {
    heldNotesRef.current.clear();
    previewRef.current?.sampler.allNotesOff();
  }, []);

  return { noteOn, noteOff, allNotesOff };
}
