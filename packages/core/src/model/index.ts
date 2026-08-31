/**
 * Barrel for the score data model. Each sibling file exports the typed
 * interfaces and helpers for one MNX concept (parts, measures, events,
 * pitches, etc.); this barrel re-exports the union of their public
 * surfaces.
 *
 * Consumers should import from `@viritura/core` rather than reaching
 * into this folder directly; the package barrel re-exports through here.
 */

export * from "./score";
export * from "./part";
export * from "./measure";
export * from "./event";
export * from "./sequenceWalk";
export * from "./pitch";
export * from "./clef";
export * from "./key";
export * from "./time";
export * from "./barline";
export * from "./layout";
export * from "./pagination";
export * from "./derivedLayouts";
export * from "./kit";
