/**
 * Metadata Viritura needs from a reference picture.
 *
 * MediaInfo knows thousands of fields and hundreds of formats. None of that
 * shape crosses this boundary: the rest of the editor gets a deliberately
 * small, stable result describing the primary video track's timing and the
 * file's SMPTE timecode, if one exists.
 */

import type { BaseTrack, GeneralTrack, MediaInfoResult, OtherTrack, VideoTrack } from "mediainfo.js";
import { FRAME_RATES } from "./smpte";

type DetectedFrameRateMode = "constant" | "variable" | "unknown";
type DetectedFrameRateConfidence = "high" | "medium" | "low" | "vfr";
type DetectedFrameRateSource = "container-rational" | "container-average";

interface DetectedFrameRate {
  /** Exact container rational when MediaInfo exposes it. */
  readonly numerator: number;
  readonly denominator: number;
  /** Decimal display value; never used for frame arithmetic. */
  readonly fps: number;
  readonly mode: DetectedFrameRateMode;
  readonly source: DetectedFrameRateSource;
  readonly confidence: DetectedFrameRateConfidence;
  readonly minimumFps: number | null;
  readonly maximumFps: number | null;
  /**
   * Existing Viritura rate id this maps to.
   *
   * Null for VFR, a non-standard rate, or NTSC media whose DF/NDF convention
   * the file does not declare.
   */
  readonly suggestedFrameRateId: string | null;
}

interface DetectedTimecode {
  readonly firstFrame: string | null;
  /** Null means the container did not declare DF/NDF. */
  readonly dropFrame: boolean | null;
  readonly source: string | null;
}

export interface DetectedMediaMetadata {
  readonly container: string | null;
  readonly codec: string | null;
  readonly codecProfile: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly frameRate: DetectedFrameRate | null;
  readonly timecode: DetectedTimecode;
}

export interface MediaMetadataWorkerRequest {
  readonly blob: Blob;
}

export type MediaMetadataWorkerResponse =
  | { readonly kind: "success"; readonly metadata: DetectedMediaMetadata }
  | { readonly kind: "error"; readonly message: string };

interface TimecodeFields {
  readonly TimeCode_FirstFrame?: string;
  readonly TimeCode_DropFrame?: string;
  readonly TimeCode_Settings?: string;
  readonly TimeCode_Source?: string;
}

const STANDARD_RATES = uniqueStandardRates();

/** Convert MediaInfo's broad result into Viritura's narrow timing model. */
export function normalizeMediaInfo(result: MediaInfoResult): DetectedMediaMetadata {
  const tracks = result.media?.track ?? [];
  const general = tracks.find((track): track is GeneralTrack => track["@type"] === "General");
  const videos = tracks.filter((track): track is VideoTrack => track["@type"] === "Video");
  const video = videos.find((track) => parseBooleanText(track.Default) === true) ?? videos[0];
  const timecode = detectTimecode(tracks, video);

  return {
    container: clean(general?.Format),
    codec: clean(video?.Format),
    codecProfile: clean(video?.Format_Profile),
    width: positiveInteger(video?.Width),
    height: positiveInteger(video?.Height),
    frameRate: video ? detectFrameRate(video, timecode.dropFrame) : null,
    timecode,
  };
}

function detectFrameRate(video: VideoTrack, dropFrame: boolean | null): DetectedFrameRate | null {
  const mode = normalizeFrameRateMode(video.FrameRate_Mode);
  const exactNumerator = positiveInteger(video.FrameRate_Num);
  const exactDenominator = positiveInteger(video.FrameRate_Den);
  const average = positiveNumber(video.FrameRate);

  let numerator: number;
  let denominator: number;
  let source: DetectedFrameRateSource;

  if (exactNumerator !== null && exactDenominator !== null) {
    [numerator, denominator] = reduceFraction(exactNumerator, exactDenominator);
    source = "container-rational";
  } else if (average !== null) {
    const standard = nearestStandardRate(average);
    if (standard && relativeError(average, standard.numerator / standard.denominator) < 0.0001) {
      numerator = standard.numerator;
      denominator = standard.denominator;
    } else {
      [numerator, denominator] = decimalFraction(average);
    }
    source = "container-average";
  } else {
    return null;
  }

  const fps = numerator / denominator;
  const standard = nearestStandardRate(fps);
  const isExactStandard = STANDARD_RATES.some(
    (candidate) => candidate.numerator === numerator && candidate.denominator === denominator,
  );
  const confidence: DetectedFrameRateConfidence =
    mode === "variable"
      ? "vfr"
      : source === "container-rational" && isExactStandard && mode === "constant"
        ? "high"
        : source === "container-rational" || standard !== null
          ? "medium"
          : "low";

  return {
    numerator,
    denominator,
    fps,
    mode,
    source,
    confidence,
    minimumFps: positiveNumber(video.FrameRate_Minimum),
    maximumFps: positiveNumber(video.FrameRate_Maximum),
    suggestedFrameRateId:
      mode === "variable" || !standard ? null : suggestedRateId(standard.numerator, standard.denominator, dropFrame),
  };
}

function detectTimecode(tracks: readonly BaseTrack[], video: VideoTrack | undefined): DetectedTimecode {
  const candidates: TimecodeFields[] = [
    ...tracks
      .filter((track): track is OtherTrack => track["@type"] === "Other")
      .map((track) => track as OtherTrack & TimecodeFields),
    ...(video ? [video as VideoTrack & TimecodeFields] : []),
    ...tracks
      .filter((track): track is GeneralTrack => track["@type"] === "General")
      .map((track) => track as GeneralTrack & TimecodeFields),
  ];
  const firstFrame =
    candidates.map((track) => clean(track.TimeCode_FirstFrame)).find((value) => value !== null) ?? null;
  const declaredDropFrame =
    candidates
      .map((track) => parseDropFrame(track.TimeCode_DropFrame, track.TimeCode_Settings))
      .find((value) => value !== null) ?? null;
  // A semicolon before the frame field is itself the SMPTE notation for
  // drop-frame. Treat it as an explicit declaration; a colon is not promoted
  // to NDF because some metadata tools normalize separators while exposing the
  // real setting elsewhere.
  const dropFrame = declaredDropFrame ?? (firstFrame && /;\d{1,2}$/.test(firstFrame) ? true : null);
  const source = candidates.map((track) => clean(track.TimeCode_Source)).find((value) => value !== null) ?? null;

  return {
    firstFrame,
    dropFrame,
    source,
  };
}

function normalizeFrameRateMode(value: string | undefined): DetectedFrameRateMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("vfr") || normalized.includes("variable")) return "variable";
  if (normalized.includes("cfr") || normalized.includes("constant")) return "constant";
  return "unknown";
}

function parseDropFrame(direct: string | undefined, settings: string | undefined): boolean | null {
  const directValue = parseBooleanText(direct);
  if (directValue !== null) return directValue;

  const normalized = settings?.trim().toLowerCase();
  if (!normalized) return null;
  if (/drop.?frame\s*=\s*(yes|true|1)/.test(normalized) || /\bdrop.?frame\b/.test(normalized)) {
    if (/non.?drop/.test(normalized) || /drop.?frame\s*=\s*(no|false|0)/.test(normalized)) return false;
    return true;
  }
  return null;
}

function parseBooleanText(value: string | undefined): boolean | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (["yes", "true", "1", "drop frame", "drop-frame"].includes(normalized)) return true;
  if (["no", "false", "0", "non-drop frame", "non drop frame", "non-drop"].includes(normalized)) return false;
  return null;
}

function suggestedRateId(numerator: number, denominator: number, dropFrame: boolean | null): string | null {
  const ntsc = numerator === 30000 || numerator === 60000;
  if (ntsc && dropFrame === null) return null;
  const rate = FRAME_RATES.find(
    (candidate) =>
      candidate.numerator === numerator &&
      candidate.denominator === denominator &&
      candidate.dropFrame === (dropFrame ?? false),
  );
  return rate?.id ?? null;
}

function uniqueStandardRates(): { readonly numerator: number; readonly denominator: number }[] {
  const seen = new Set<string>();
  const rates: { numerator: number; denominator: number }[] = [];
  for (const rate of FRAME_RATES) {
    const key = `${rate.numerator}/${rate.denominator}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rates.push({ numerator: rate.numerator, denominator: rate.denominator });
  }
  return rates;
}

function nearestStandardRate(fps: number): (typeof STANDARD_RATES)[number] | null {
  if (!Number.isFinite(fps) || fps <= 0) return null;
  let best = STANDARD_RATES[0] ?? null;
  for (const candidate of STANDARD_RATES) {
    if (!best) {
      best = candidate;
      continue;
    }
    if (
      Math.abs(fps - candidate.numerator / candidate.denominator) < Math.abs(fps - best.numerator / best.denominator)
    ) {
      best = candidate;
    }
  }
  return best && relativeError(fps, best.numerator / best.denominator) < 0.0001 ? best : null;
}

function decimalFraction(value: number): [number, number] {
  const denominator = 1_000_000;
  return reduceFraction(Math.round(value * denominator), denominator);
}

function reduceFraction(numerator: number, denominator: number): [number, number] {
  const divisor = gcd(numerator, denominator);
  return [numerator / divisor, denominator / divisor];
}

function gcd(a: number, b: number): number {
  let left = Math.abs(Math.trunc(a));
  let right = Math.abs(Math.trunc(b));
  while (right !== 0) [left, right] = [right, left % right];
  return left || 1;
}

function relativeError(actual: number, expected: number): number {
  return Math.abs(actual - expected) / expected;
}

function positiveNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function positiveInteger(value: number | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
