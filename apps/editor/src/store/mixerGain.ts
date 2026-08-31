export const MIXER_MIN_DB = -60;
export const MIXER_MAX_DB = 6;
export const MIXER_DB_STEP = 0.5;
export const MIXER_MAX_GAIN = Math.pow(10, MIXER_MAX_DB / 20);
export const MIXER_DEFAULT_GAIN = Math.pow(10, -6 / 20);

export function gainToDb(gain: number): number {
  if (gain <= 0) return MIXER_MIN_DB;
  return Math.max(MIXER_MIN_DB, Math.min(MIXER_MAX_DB, 20 * Math.log10(gain)));
}

export function dbToGain(db: number): number {
  if (db <= MIXER_MIN_DB) return 0;
  return Math.pow(10, Math.min(MIXER_MAX_DB, db) / 20);
}

export function formatGainDb(gain: number): string {
  if (gain <= 0) return "-inf dB";
  const db = gainToDb(gain);
  const decimals = Math.abs(db) >= 10 ? 0 : 1;
  const value = db.toFixed(decimals);
  return `${db > 0 ? "+" : ""}${value} dB`;
}

export function gainToFaderPercent(gain: number): number {
  return ((gainToDb(gain) - MIXER_MIN_DB) / (MIXER_MAX_DB - MIXER_MIN_DB)) * 100;
}
