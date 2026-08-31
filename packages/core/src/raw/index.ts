/**
 * Re-export for codegen'd MNX raw types only (W3C schema).
 *
 * For vendor-extension raw types (`_x.viritura` payloads), import from
 * `@viritura/core/raw-viritura` instead. The two schemas define overlapping
 * names (`Jump`, `RhythmicPosition`, openapi-typescript boilerplate) so they
 * live behind separate subpaths.
 *
 * Both generated modules live in `@viritura/core` rather than
 * `@viritura/format` because the decoded model in `../model/` is derived
 * from them via TS utility types. Format depends on core, so core can't
 * depend on format — raw must live here.
 *
 * Consumers should import named PascalCase aliases:
 *   import type { Pitch, Sequence, Event } from "@viritura/core/raw";
 * rather than reaching into `components["schemas"]` directly.
 */

export type * from "./raw";
