const MIB = 1024 * 1024;

export const MAX_GIST_FILES = 50;
// GitHub serves raw Gist files only up to 10 MB; larger files require git clone.
export const MAX_GIST_STORED_FILE_BYTES = 8 * MIB;
// Keeps the JSON-escaped create request under the API's 100 MiB request limit.
export const MAX_GIST_STORED_TOTAL_BYTES = 64 * MIB;
export const MAX_GIST_MNX_TOTAL_BYTES = 512 * MIB;

export function formatMiB(bytes: number): string {
  return `${bytes / MIB} MiB`;
}
