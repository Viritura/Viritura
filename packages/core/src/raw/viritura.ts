/**
 * Re-export for codegen'd vendor-extension raw types (`_x.viritura`).
 *
 * Lives behind its own subpath because some symbol names collide with
 * the MNX schema (e.g. `Jump`, `RhythmicPosition`). Import MNX raw types
 * from `@viritura/core/raw`.
 */

export type * from "./raw-viritura";
