/**
 * SMPTE timecode — real frame arithmetic, including drop-frame.
 *
 * The basic Video Reference tier deliberately showed only clock time, because
 * formatting seconds as frames produces numbers that look authoritative and are
 * wrong at 23.976 and 29.97 (see `timecode.ts`). Scoring to picture needs the
 * real thing: a composer's hit list, streamer cues and delivery notes are all
 * written in frames, and being one frame out is audible.
 *
 * Two facts drive the design.
 *
 * **Frame rates are rational, not decimal.** 23.976 is 24000/1001 exactly;
 * writing it as 23.976 accumulates about 1.5 frames of error per hour, which is
 * more than enough to miss a hit. Every rate here is stored as a fraction and
 * all conversion goes through it.
 *
 * **Drop-frame is a labelling convention, not a rate.** 29.97 DF runs at exactly
 * the same speed as 29.97 NDF; it just skips two *numbers* at the top of most
 * minutes so the displayed timecode tracks wall clock. Nothing about media time
 * changes — only what we print. Native browser media APIs do not expose the
 * QuickTime `tmcd` track, so Viritura reads it from the selected file through
 * MediaInfo and asks the composer only when the container does not declare it.
 */

/** A frame rate as the industry actually defines it. */
export interface FrameRateSpec {
  /** Stable identifier, used for persistence. */
  readonly id: string;
  /** How a composer would say it. */
  readonly label: string;
  /** Frames per second = numerator / denominator. */
  readonly numerator: number;
  readonly denominator: number;
  /** Whether timecode *labels* skip numbers to track wall clock. */
  readonly dropFrame: boolean;
}

/**
 * The rates worth offering.
 *
 * Deliberately short. A longer list invites the composer to pick something
 * plausible-looking rather than reading the delivery spec, and every extra entry
 * is another way to be silently one frame out.
 */
export const FRAME_RATES: readonly FrameRateSpec[] = [
  { id: "23.976", label: "23.976 (24 ÷ 1.001)", numerator: 24000, denominator: 1001, dropFrame: false },
  { id: "24", label: "24", numerator: 24, denominator: 1, dropFrame: false },
  { id: "25", label: "25 (PAL)", numerator: 25, denominator: 1, dropFrame: false },
  { id: "29.97", label: "29.97 non-drop", numerator: 30000, denominator: 1001, dropFrame: false },
  { id: "29.97df", label: "29.97 drop-frame", numerator: 30000, denominator: 1001, dropFrame: true },
  { id: "30", label: "30", numerator: 30, denominator: 1, dropFrame: false },
  { id: "50", label: "50", numerator: 50, denominator: 1, dropFrame: false },
  { id: "59.94", label: "59.94 non-drop", numerator: 60000, denominator: 1001, dropFrame: false },
  { id: "59.94df", label: "59.94 drop-frame", numerator: 60000, denominator: 1001, dropFrame: true },
  { id: "60", label: "60", numerator: 60, denominator: 1, dropFrame: false },
];

/** 24 fps: the safest default, and what most animation and film deliveries use. */
export const DEFAULT_FRAME_RATE_ID = "24";

export function frameRateById(id: string | undefined): FrameRateSpec {
  return FRAME_RATES.find((rate) => rate.id === id) ?? frameRateById(DEFAULT_FRAME_RATE_ID);
}

/** Frames per second as a float — for display and for spacing heuristics only. */
export function fps(rate: FrameRateSpec): number {
  return rate.numerator / rate.denominator;
}

/**
 * The integer frame rate timecode *labels* count to.
 *
 * 23.976 labels count 0–23; 29.97 labels count 0–29. This is the number that
 * appears in the `FF` field, and it is never the true rate for NTSC.
 */
export function labelFps(rate: FrameRateSpec): number {
  return Math.round(fps(rate));
}

/** Exact seconds for a frame index. */
export function secondsForFrame(frame: number, rate: FrameRateSpec): number {
  return (frame * rate.denominator) / rate.numerator;
}

/**
 * The frame index containing a moment.
 *
 * Floors rather than rounds: frame *n* covers `[n/fps, (n+1)/fps)`, so the frame
 * you are looking at 40 ms into a 24 fps clip is frame 0, not frame 1.
 * A small epsilon absorbs the float error in `seconds * numerator`, which
 * otherwise lands on 23.999999999999996 and reports the previous frame.
 */
export function frameForSeconds(seconds: number, rate: FrameRateSpec): number {
  const exact = (seconds * rate.numerator) / rate.denominator;
  return Math.floor(exact + 1e-6);
}

/** Snap a time to the start of the frame containing it. */
export function snapToFrame(seconds: number, rate: FrameRateSpec): number {
  return secondsForFrame(frameForSeconds(seconds, rate), rate);
}

/** Duration of one frame, in seconds. */
export function frameDuration(rate: FrameRateSpec): number {
  return rate.denominator / rate.numerator;
}

/**
 * Signed error in frames between two moments.
 *
 * The unit the whole spotting workflow is judged in: "this bar line lands 0.4
 * frames late" is meaningful in a way that "16.7 ms late" is not.
 */
export function frameError(actualSeconds: number, targetSeconds: number, rate: FrameRateSpec): number {
  return ((actualSeconds - targetSeconds) * rate.numerator) / rate.denominator;
}

/** How many label numbers are skipped per drop, and how often. */
function dropCount(rate: FrameRateSpec): number {
  // 2 at 29.97, 4 at 59.94 — i.e. two per 30 label-frames.
  return rate.dropFrame ? Math.round(labelFps(rate) / 15) : 0;
}

interface TimecodeFields {
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly frames: number;
  readonly negative: boolean;
}

/**
 * Convert a frame index to displayed timecode fields.
 *
 * The drop-frame branch is the standard renumbering: for every minute that is
 * not a multiple of ten, the first `dropCount` labels are skipped. Note that it
 * adjusts the *label*, never the position — frame 1800 at 29.97 DF is still
 * exactly 1800 × 1001/30000 seconds in.
 */
function fieldsForFrame(frame: number, rate: FrameRateSpec): TimecodeFields {
  const negative = frame < 0;
  let counted = Math.abs(Math.round(frame));
  const round = labelFps(rate);
  const drop = dropCount(rate);

  if (drop > 0) {
    const framesPerTenMinutes = Math.round(fps(rate) * 600);
    // The frames actually present in a dropped minute — 1798 at 29.97, not 1800.
    // Using the label count here is the classic off-by-a-minute in this algorithm.
    const framesPerMinute = round * 60 - drop;
    const tenMinuteBlocks = Math.floor(counted / framesPerTenMinutes);
    const remainder = counted % framesPerTenMinutes;
    counted += drop * 9 * tenMinuteBlocks;
    if (remainder > drop) {
      counted += drop * Math.floor((remainder - drop) / framesPerMinute);
    }
  }

  const frames = counted % round;
  const totalSeconds = Math.floor(counted / round);
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor(totalSeconds / 60) % 60,
    seconds: totalSeconds % 60,
    frames,
    negative,
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Format a frame index as `HH:MM:SS:FF`.
 *
 * Drop-frame uses a semicolon before the frame field, the convention every NLE
 * and every delivery spec uses. It is the only visible difference between two
 * timecodes running at identical speed, so it is worth being pedantic about.
 */
export function formatFrameTimecode(frame: number, rate: FrameRateSpec): string {
  if (!Number.isFinite(frame)) return "--:--:--:--";
  const f = fieldsForFrame(frame, rate);
  const separator = rate.dropFrame ? ";" : ":";
  return `${f.negative ? "-" : ""}${pad2(f.hours)}:${pad2(f.minutes)}:${pad2(f.seconds)}${separator}${pad2(f.frames)}`;
}

/** Format a media time as SMPTE, optionally shifted by a delivery start. */
export function formatTimecode(seconds: number, rate: FrameRateSpec, startFrames = 0): string {
  if (!Number.isFinite(seconds)) return "--:--:--:--";
  return formatFrameTimecode(frameForSeconds(seconds, rate) + startFrames, rate);
}

/**
 * Parse `HH:MM:SS:FF` (or `;FF`) into a frame index.
 *
 * Also accepts `MM:SS:FF` and `SS:FF` so a composer can type the short form off
 * a cue sheet. Returns `null` rather than guessing, so callers can reject bad
 * input instead of silently jumping to zero.
 */
export function parseFrameTimecode(text: string, rate: FrameRateSpec): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  if (!/^\d{1,2}([:;]\d{1,2}){1,3}$/.test(body)) return null;

  const parts = body.split(/[:;]/).map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;

  // Right-align: the last field is always frames.
  const [hours = 0, minutes = 0, seconds = 0, frames = 0] = [...Array<number>(4 - parts.length).fill(0), ...parts];

  const round = labelFps(rate);
  if (frames >= round || seconds >= 60 || minutes >= 60) return null;

  const drop = dropCount(rate);
  if (drop > 0 && seconds === 0 && frames < drop && minutes % 10 !== 0) {
    // These label numbers do not exist in drop-frame; rejecting is kinder than
    // silently resolving to a neighbouring frame.
    return null;
  }

  let counted = hours * 3600 * round + minutes * 60 * round + seconds * round + frames;
  if (drop > 0) {
    const totalMinutes = hours * 60 + minutes;
    counted -= drop * (totalMinutes - Math.floor(totalMinutes / 10));
  }
  return negative ? -counted : counted;
}

/** Parse timecode straight to seconds, for seeking. */
export function parseTimecodeSeconds(text: string, rate: FrameRateSpec): number | null {
  const frame = parseFrameTimecode(text, rate);
  return frame === null ? null : secondsForFrame(frame, rate);
}
