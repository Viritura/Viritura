const byteUnits = ["bytes", "KiB", "MiB", "GiB"];

export function formatBytes(bytes) {
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < byteUnits.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${byteUnits[unitIndex]}`;
}

export function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

export function formatDecibels(value) {
  if (value <= 0) {
    return "-∞ dBFS";
  }
  return `${(20 * Math.log10(value)).toFixed(1)} dBFS`;
}
