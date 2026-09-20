import { voiceChordSymbol, type ChordSymbol, type Score } from "@viritura/core";
import type { ISampler } from "@viritura/audio";
import type { VstTransport } from "./vstTransport";

interface BrowserVoice {
  sampler: ISampler;
  context: AudioContext;
}

interface ChordPreviewTarget {
  partIndex: number;
  browser(current: () => boolean): Promise<BrowserVoice | null>;
  native?: {
    transport: VstTransport;
    prepare(): Promise<void>;
  };
}

/** Serialize cold preparation and invalidate old clicks before they can sound. */
function createChordPreview() {
  let revision = 0;
  let pending: Promise<void> = Promise.resolve();
  let release: (() => void | Promise<void>) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const silence = async () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const stop = release;
    release = undefined;
    await stop?.();
  };

  const cancel = async () => {
    revision++;
    await silence();
    await pending;
  };

  const preview = (
    chord: ChordSymbol,
    target: ChordPreviewTarget | undefined,
    eligible: () => boolean,
  ): Promise<void> => {
    const request = ++revision;
    const voicing = voiceChordSymbol(chord);
    const notes = [...voicing.leftHand, ...voicing.rightHand];
    const previous = pending;
    pending = (async () => {
      await silence();
      await previous;
      const current = () => request === revision && eligible();
      if (!target || !notes.length || !current()) return;
      if (target.native?.transport.previewChord) {
        await target.native.prepare();
        if (!current()) return;
        const transport = target.native.transport;
        const voiced = await transport.previewChord!(target.partIndex, notes, 80, 400);
        if (voiced) {
          release = () => transport.stop();
          if (!current()) await silence();
          return;
        }
      }
      const voice = await target.browser(current);
      if (!voice || !current()) return;
      const { sampler, context } = voice;
      sampler.setPlaybackMuted?.(false);
      release = () => {
        sampler.cancelScheduledNotes?.(-Infinity);
        sampler.allNotesOff();
      };
      for (const note of notes) sampler.noteOn(note, 80, context.currentTime);
      // Do not queue old note-offs into a shared channel: a repeat click can
      // reuse the same pitches before that old release reaches the worklet.
      timer = setTimeout(() => {
        timer = undefined;
        if (request === revision) void silence();
      }, 400);
    })();
    // Keep the serialization chain usable if a device or resource load fails.
    pending = pending.catch((error: unknown) => {
      console.warn("[Audio] Chord preview failed:", error);
    });
    return pending;
  };
  return { preview, cancel };
}

interface ChordPreviewPublication {
  score: Score | null | undefined;
  mode: "web" | "native";
  transport: VstTransport | undefined;
  audition(chord: ChordSymbol): Promise<void>;
}

function publicationKey(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
      : item,
  );
}

/** Commit handlers run before React publishes the edited score. The editor
 * reparses deferred MNX, so correlate by content, not object identity or a
 * timeout. Only the expected publication may launch a queued commit audition. */
export function createPublishedChordPreview() {
  const voice = createChordPreview();
  let publication: ChordPreviewPublication | undefined;
  let pending: { chord: ChordSymbol; scoreKey: string } | undefined;
  const expectedPublications = new Set<string>();
  let scoreKey = publicationKey(null);

  const cancel = () => {
    pending = undefined;
    expectedPublications.clear();
    return voice.cancel();
  };

  const publish = (next: ChordPreviewPublication) => {
    const request = pending;
    const sameDevice = publication?.mode === next.mode && publication.transport === next.transport;
    publication = next;
    scoreKey = publicationKey(next.score ?? null);
    if (request && sameDevice && request.scoreKey !== scoreKey && expectedPublications.delete(scoreKey)) {
      // Deferred rendering can publish an earlier commit after a newer click.
      // Keep only the newest audition, but do not mistake this for a new document.
      void voice.cancel();
      return;
    }
    void cancel();
    if (request && sameDevice && request.scoreKey === scoreKey) void next.audition(request.chord);
  };

  const request = (chord: ChordSymbol, updatedScore?: Score): Promise<void> => {
    pending = undefined;
    const expected = updatedScore ? publicationKey(updatedScore) : scoreKey;
    if (publication && expected === scoreKey) {
      expectedPublications.clear();
      return publication.audition(chord);
    }
    const cancelled = voice.cancel();
    pending = { chord, scoreKey: expected };
    expectedPublications.add(expected);
    return cancelled;
  };

  return { preview: voice.preview, cancel, publish, request };
}
