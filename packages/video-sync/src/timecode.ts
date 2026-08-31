/**
 * Wall-clock timecode formatting for the basic Video Reference workflow.
 *
 * Scope note: this is *clock* time (HH:MM:SS.mmm), not SMPTE. Real SMPTE needs
 * a rational frame rate and drop-frame arithmetic, both of which belong to the
 * advanced scoring-to-picture work. Formatting seconds as if they were frames
 * would produce numbers that look authoritative and are wrong at 23.976 and
 * 29.97, so the basic tier deliberately shows only what it can compute exactly.
 *
 * A `startTimecode` is still supported as a *display* offset, because film
 * deliveries commonly start at 01:00:00:00 and composers read positions
 * relative to that.
 */

/** Seconds in a minute/hour, named to keep the arithmetic readable. */
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

function pad(value: number, width: number): string {
  return String(Math.floor(Math.abs(value))).padStart(width, "0");
}

/**
 * Format a duration as `HH:MM:SS.mmm`.
 *
 * Negative values (a count-in, or a picture offset that puts score zero before
 * the first frame) format with a leading `-` rather than wrapping, so the sign
 * stays visible in the transport readout.
 */
export function formatClockTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "--:--:--.---";
  const sign = seconds < 0 ? "-" : "";
  const abs = Math.abs(seconds);
  const hours = Math.floor(abs / SECONDS_PER_HOUR);
  const minutes = Math.floor((abs % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const secs = Math.floor(abs % SECONDS_PER_MINUTE);
  const millis = Math.round((abs - Math.floor(abs)) * 1000);
  // Rounding milliseconds can carry into the next second (e.g. 1.9996 -> 2.000).
  if (millis === 1000) {
    return formatClockTime(Math.sign(seconds) * (Math.floor(abs) + 1));
  }
  return `${sign}${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)}.${pad(millis, 3)}`;
}

/** Format a duration as `HH:MM:SS`, for compact readouts. */
export function formatShortClockTime(seconds: number): string {
  return formatClockTime(seconds).slice(0, -4);
}

/**
 * Parse `HH:MM:SS`, `HH:MM:SS.mmm`, `MM:SS`, or a bare seconds value.
 *
 * Also accepts the colon-separated `HH:MM:SS:FF` shape a composer is likely to
 * paste from a delivery spec. Without a declared frame rate the frame field
 * cannot be converted exactly, so it is ignored rather than guessed — the
 * caller gets the whole-second position and no false precision.
 *
 * Returns `null` for anything unparseable so callers can reject input instead
 * of silently seeking to zero.
 */
export function parseClockTime(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;

  if (!/^[\d:.]+$/.test(body)) return null;

  const parts = body.split(":");
  if (parts.length > 4) return null;

  // `HH:MM:SS:FF` — drop the frame field (see doc comment).
  const fields = parts.length === 4 ? parts.slice(0, 3) : parts;

  let seconds = 0;
  for (const field of fields) {
    if (field.length === 0) return null;
    const value = Number(field);
    if (!Number.isFinite(value) || value < 0) return null;
    seconds = seconds * SECONDS_PER_MINUTE + value;
  }
  return negative ? -seconds : seconds;
}

/**
 * Format a media time for display, shifted by the delivery's start timecode.
 *
 * `startTimecodeSeconds` is purely presentational: it changes the number the
 * composer reads, never the media time we seek to.
 */
export function formatPictureTimecode(mediaTimeSeconds: number, startTimecodeSeconds = 0): string {
  return formatClockTime(mediaTimeSeconds + startTimecodeSeconds);
}
