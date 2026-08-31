import { generateId } from "@viritura/core";

/**
 * Per-conversion ID generator.
 *
 * MusicXML → MNX is a one-shot import: the output MNX file owns its IDs
 * from then on. We mint UUID v7 IDs via the canonical `generateId()` so
 * imported scores match the editor's runtime ID format exactly.
 *
 * The `prefix` parameter is ignored at runtime — kept only so that call
 * sites can document intent (`ids.next("ev")`, `ids.next("m")`) without
 * changing every caller. It can be dropped in a later cleanup pass.
 */
export class IdGenerator {
  // prefix retained for call-site readability; see class doc
  next(_prefix: string): string {
    return generateId();
  }
}
