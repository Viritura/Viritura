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

// A bounded key hold lets the piano decay before its own release envelope.
// Never use pedal sustain or a channel-wide panic as the normal deadline.
const CHORD_PREVIEW_HOLD_MS = 3_000;

/** Serialize cold preparation and invalidate old clicks before they can sound. */
function createChordPreview() {
  let revision = 0;
  let pending: Promise<void> = Promise.resolve();
  let active: { id: number; stopping?: Promise<void>; release(): void | Promise<void> } | undefined;
  let requested = false;

  const silence = async (id = active?.id) => {
    const voice = active;
    if (!voice || voice.id !== id) return;
    voice.stopping ??= (async () => {
      await voice.release();
      if (active === voice) active = undefined;
    })().finally(() => {
      voice.stopping = undefined;
    });
    await voice.stopping;
  };

  const cancel = () => {
    revision++;
    requested = false;
    // Release immediately, but include the asynchronous native stop in the
    // serialization barrier. A later audition must not overtake that stop.
    const cancelled = Promise.all([pending, silence()])
      .then(() => active === undefined)
      .catch((error: unknown) => {
        // Retain the voice for a retry. Fire-and-forget UI cancellations must
        // report failure without poisoning all subsequent transport barriers.
        console.warn("[Audio] Chord preview cancellation failed:", error);
        return false;
      });
    pending = cancelled.then(() => {});
    return cancelled;
  };

  const preview = (
    chord: ChordSymbol,
    target: ChordPreviewTarget | undefined,
    eligible: () => boolean,
  ): Promise<void> => {
    const request = ++revision;
    requested = true;
    const voicing = voiceChordSymbol(chord);
    const notes = [...voicing.leftHand, ...voicing.rightHand];
    const previous = pending;
    pending = (async () => {
      await previous;
      const current = () => request === revision && eligible();
      if (request !== revision) return;
      await silence();
      if (!target || !notes.length || !current()) return;
      if (target.native?.transport.previewChord) {
        await target.native.prepare();
        if (!current()) return;
        const transport = target.native.transport;
        const voiced = await transport.previewChord!(target.partIndex, notes, 80, CHORD_PREVIEW_HOLD_MS);
        if (voiced) {
          active = { id: request, release: () => transport.stop() };
          if (!current()) await silence(request);
          return;
        }
      }
      const voice = await target.browser(current);
      if (!voice || !current()) return;
      const { sampler, context } = voice;
      sampler.setPlaybackMuted?.(false);
      active = {
        id: request,
        release: () => {
          // ISampler uses MIDI pitch/channel addressing. Remove this audition's
          // queued offs before the next ID can reuse any of its pitches.
          sampler.cancelScheduledNotes?.(-Infinity);
          sampler.allNotesOff();
        },
      };
      sampler.sendControl?.(64, 0);
      sampler.sendControl?.(66, 0);
      const start = context.currentTime;
      for (const note of notes) {
        sampler.noteOn(note, 80, start);
        sampler.noteOff(note, start + CHORD_PREVIEW_HOLD_MS / 1000);
      }
    })();
    // Keep the serialization chain usable if a device or resource load fails.
    pending = pending
      .catch((error: unknown) => {
        console.warn("[Audio] Chord preview failed:", error);
      })
      .finally(() => {
        if (request === revision && active?.id !== request) requested = false;
      });
    return pending;
  };
  return { preview, cancel, isActive: () => requested || active !== undefined };
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

  const publish = (next: ChordPreviewPublication, invalidate?: () => void) => {
    const request = pending;
    const sameDevice = publication?.mode === next.mode && publication.transport === next.transport;
    const nextKey = publicationKey(next.score ?? null);
    publication = next;
    // Republishing parsed/immutable snapshots or refreshing callbacks is not
    // an audio lifetime boundary. Keep warming and sounding auditions alive.
    if (sameDevice && nextKey === scoreKey) return;
    scoreKey = nextKey;
    invalidate?.();
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
    return cancelled.then(() => {});
  };

  return { preview: voice.preview, isActive: voice.isActive, cancel, publish, request };
}
