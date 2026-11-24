import type { Score } from "@viritura/core";
import {
  OfflineSf2Synth,
  dispatchSamplerEvent,
  samplerRoutingKey,
  type ISampler,
  type MidiEvent,
} from "@viritura/audio";
import { generateTimeline } from "@viritura/midi";
import { requireSf2Sound, resolveScorePlaybackParts, type ResolvedPlaybackPart } from "../soundProfileRuntime";
import { createOfflineSamplers } from "./offlineSamplers";
import type { AudioEffects, AudioEncoding, AudioPartMix, AudioStage } from "./messages";
import { createAudioEncoder } from "./audioEncoding";
import { OfflineMixGraph } from "./mixGraph";
import { planStage } from "./stagePlan";

const SAMPLE_RATE = 44_100;
const BUFFER_SIZE = 4_096;
const SYNTH_QUANTUM = 128;
const MIN_RELEASE_SECONDS = 2;
const MAX_RELEASE_SECONDS = 30;

export interface RenderedAudio {
  bytes: Uint8Array<ArrayBuffer>;
  warnings: string[];
}

function renderEvent(event: MidiEvent, samplers: ReadonlyMap<number | string, ISampler>): void {
  const sampler = samplers.get(samplerRoutingKey(event));
  const target = event.playbackInstrumentKey === undefined ? (sampler ?? samplers.get(event.partIndex)) : sampler;
  if (!target) throw new Error(`No sound is available for playback part ${event.partIndex + 1}.`);
  dispatchSamplerEvent(target, event);
}

function eventSample(event: MidiEvent): number {
  if (!Number.isFinite(event.time)) throw new Error("The score contains an invalid playback time.");
  return Math.max(0, Math.round(event.time * SAMPLE_RATE));
}

function concatenate(
  chunks: readonly Uint8Array[],
  { tail, header }: { tail: Uint8Array; header: Uint8Array | null },
): Uint8Array<ArrayBuffer> {
  chunks = [...chunks, tail];
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (header) {
    if (header.length > bytes.length) throw new Error("Audio encoder returned an invalid header.");
    bytes.set(header);
  }
  if (bytes.length === 0) throw new Error("Audio encoder returned no audio.");
  return bytes;
}

function createRenderTimeline(score: Score, parts: readonly ResolvedPlaybackPart[], warnings: Set<string>) {
  const partPrograms = parts.map((part) => requireSf2Sound(part.part.name, part.sf2).primary.program);
  const instrumentPrograms = new Map(
    parts.map((part) => [
      part.index,
      new Map(
        (part.instruments ?? []).map(({ key, resolved }) => [
          key,
          requireSf2Sound(resolved.part.name, resolved.sf2).primary.program,
        ]),
      ),
    ]),
  );
  return generateTimeline(score, {
    partPrograms,
    instrumentPrograms,
    includeGlobalChords: true,
    onDiagnostic: (diagnostic) => {
      if (diagnostic.code === "glissando-playback-unsupported" || diagnostic.code === "swing-staff-meter-unsupported") {
        warnings.add(diagnostic.message);
      }
    },
  });
}

function planFrames(timeline: ReturnType<typeof generateTimeline>) {
  if (!Number.isFinite(timeline.duration) || timeline.duration <= 0) {
    throw new Error("The document has no playable duration to export.");
  }
  const eventSamples = timeline.events.map(eventSample);
  const lastEvent = eventSamples.at(-1) ?? 0;
  const scoreFrames = Math.ceil(Math.max(timeline.duration * SAMPLE_RATE, lastEvent));
  const minimumFrames = scoreFrames + MIN_RELEASE_SECONDS * SAMPLE_RATE;
  const maximumFrames = scoreFrames + MAX_RELEASE_SECONDS * SAMPLE_RATE;
  if (!Number.isSafeInteger(maximumFrames)) throw new Error("The score is too long to export.");
  return { eventSamples, minimumFrames, maximumFrames };
}

/** Playback stage and master settings; omitted settings render the default stage, dry. */
export interface RenderMixOptions {
  stage?: AudioStage;
  effects?: AudioEffects;
}

async function createSectionSynths(
  soundfont: ArrayBuffer,
  count: number,
  effects: boolean,
): Promise<OfflineSf2Synth[]> {
  const bank = OfflineSf2Synth.parseSoundBank(soundfont);
  const synths: OfflineSf2Synth[] = [];
  try {
    for (let i = 0; i < count; i++) synths.push(await OfflineSf2Synth.create(bank, SAMPLE_RATE, { effects }));
  } catch (error) {
    for (const synth of synths) synth.destroy();
    throw error;
  }
  return synths;
}

export async function renderScoreAudio(
  score: Score,
  soundfont: ArrayBuffer,
  encoding: AudioEncoding,
  onProgress: (fraction: number) => void,
  mix?: readonly AudioPartMix[],
  { stage, effects }: RenderMixOptions = {},
): Promise<RenderedAudio> {
  const parts = resolveScorePlaybackParts(score);
  const plan = planStage(parts, mix, stage);
  const warnings = new Set<string>();
  const timeline = createRenderTimeline(score, parts, warnings);
  const { eventSamples, minimumFrames, maximumFrames } = planFrames(timeline);

  // The synths share one parsed bank, so they are destroyed together after rendering.
  const synths = await createSectionSynths(soundfont, plan.sections.length, !!effects);
  try {
    const samplers = createOfflineSamplers(score, parts, timeline.events, synths, plan.parts, mix);
    const graph = new OfflineMixGraph(plan.sections, effects, SAMPLE_RATE, BUFFER_SIZE);
    const sounding = () => synths.some((synth) => synth.voiceCount > 0);
    const encoder = await createAudioEncoder(encoding, SAMPLE_RATE);
    try {
      const chunks: Uint8Array[] = [];
      let eventIndex = 0;
      let frame = 0;
      let reportedPercent = -1;
      let tailEnd: number | null = null;
      while (frame < maximumFrames) {
        if (frame >= minimumFrames && !sounding()) {
          tailEnd ??= frame + graph.tailFrames;
          if (frame >= tailEnd) break;
        } else {
          tailEnd = null;
        }
        // Blocks stay full-size so the reverb convolver keeps its partition alignment.
        const size = Math.min(BUFFER_SIZE, maximumFrames - frame);
        let offset = 0;
        while (offset < size) {
          while (eventIndex < timeline.events.length && eventSamples[eventIndex]! <= frame + offset) {
            const event = timeline.events[eventIndex]!;
            if (!mix?.[event.partIndex]?.muted && mix?.[event.partIndex]?.volume !== 0) {
              renderEvent(event, samplers);
            }
            eventIndex++;
          }
          const nextEvent = eventSamples[eventIndex] ?? maximumFrames;
          const count = Math.min(SYNTH_QUANTUM, size - offset, nextEvent - frame - offset);
          synths.forEach((synth, index) => {
            const section = graph.sections[index]!;
            synth.process(section.left, section.right, offset, count);
          });
          offset += count;
        }
        graph.render();
        const chunk = encoder.encode(graph.output.left.subarray(0, size), graph.output.right.subarray(0, size));
        if (chunk.length > 0) chunks.push(chunk);
        frame += size;
        const percent = Math.min(99, Math.floor((frame / minimumFrames) * 99));
        if (percent > reportedPercent) {
          reportedPercent = percent;
          onProgress(percent / 100);
        }
      }
      if (sounding()) {
        warnings.add("The final sound was cut off after a 30-second release.");
      }
      const bytes = concatenate(chunks, encoder.finish());
      onProgress(1);
      return { bytes, warnings: [...warnings] };
    } finally {
      encoder.free();
    }
  } finally {
    for (const synth of synths) synth.destroy();
  }
}
