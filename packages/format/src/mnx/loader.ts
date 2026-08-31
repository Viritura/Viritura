/**
 * MNX Loader — convenience functions for loading MNX files.
 */

import type { Score } from "@viritura/core";
import { parseMnx } from "./parser";

/**
 * Load and parse an MNX file from a URL (fetch + parse).
 */
export async function loadMnxFromUrl(url: string): Promise<Score> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load MNX file: ${response.status} ${response.statusText}`);
  }
  const json = await response.json();
  return parseMnx(json);
}

/**
 * Parse an MNX file from a JSON string.
 */
export function loadMnxFromString(jsonString: string): Score {
  const json = JSON.parse(jsonString);
  return parseMnx(json);
}
