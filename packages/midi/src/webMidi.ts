/**
 * Web MIDI API access helpers.
 *
 * Provides browser-support detection and a thin wrapper around
 * `navigator.requestMIDIAccess()` so callers don't need to deal with
 * feature-detection boilerplate.
 *
 * Browser support: Chrome / Edge (Chromium-based) only.
 * Firefox and Safari do not support the Web MIDI API as of 2026-03.
 */

/** Whether the current browser exposes the Web MIDI API. */
export function isWebMidiSupported(): boolean {
  return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
}

/**
 * Request access to the Web MIDI API.
 *
 * Returns `null` when the API is unavailable (unsupported browser or
 * permission denied).  Callers should check {@link isWebMidiSupported}
 * first for a synchronous fast-path.
 */
export async function requestMidiAccess(): Promise<MIDIAccess | null> {
  if (!isWebMidiSupported()) {
    return null;
  }
  try {
    return await navigator.requestMIDIAccess();
  } catch {
    // Permission denied or API error
    return null;
  }
}

/**
 * Collect currently-available MIDI output ports from a {@link MIDIAccess}
 * instance.  Returns an array of `[portId, MIDIOutput]` pairs sorted by
 * port name for stable UI ordering.
 */
export function listMidiOutputs(access: MIDIAccess): ReadonlyArray<readonly [string, MIDIOutput]> {
  const outputs: Array<readonly [string, MIDIOutput]> = [];
  access.outputs.forEach((output, id) => {
    outputs.push([id, output] as const);
  });
  outputs.sort((a, b) => (a[1].name ?? "").localeCompare(b[1].name ?? ""));
  return outputs;
}
