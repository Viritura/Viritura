/**
 * Derivation primitives for building the decoded model on top of raw types.
 *
 * The decoded model lives in `@viritura/core/src/model/` and historically
 * was hand-written. After moving raw types to `@viritura/core/raw`, we
 * derive model types from raw via TS utility types whenever the model
 * shape matches (or only narrows / extends) the wire shape. This keeps
 * the two surfaces structurally in lock-step and surfaces schema drift
 * as compile errors.
 *
 * Use these helpers — not bare `Omit & {}` — so the intent ("preserved
 * narrower enum", "added discriminator", "hoisted vendor ext") is
 * legible in the type definition.
 */

/**
 * Replace specific fields with narrower or extended types. Preserves all
 * other fields (including `global-attrs` mixin — `id?`, `_c?`, `_x?`).
 *
 * Use when the hand model overrides one or two raw fields, e.g.:
 *   - tightening an open `number` to a finite tuple-union (`Octave`),
 *   - replacing a wire shape with a tuple (`fraction: [number, number]`),
 *   - extending an enum with hand-synthesised values (`repeat-start` for
 *     `BarlineType`, `"TAB"` for `ClefSign`).
 */
export type Narrow<T, M extends Partial<Record<keyof T, unknown>>> = Omit<T, keyof M> & M;

/**
 * Combined helper: hoist vendor-ext fields to the top level AND retype the
 * `_x.viritura` slot so deep writes/reads are also type-safe.
 *
 * Use this for the common Viritura pattern where the *decoded* model exposes
 * vendor fields at the top level (`key.atonal`) but the *wire* form stores
 * them under `_x.viritura.*`. The promote/serialize layer bridges the two
 * representations; both surfaces must type-check.
 *
 * Example:
 *   export type KeySignature = HoistVendor<RawKey, { atonal?: boolean }>;
 *   //   key.atonal works (hoisted)
 *   //   key._x = { viritura: { atonal: true } } works (deep)
 */
export type HoistVendor<T, V> = Omit<T, "_x"> &
  V & {
    _x?: { [key: string]: Record<string, unknown> } & { viritura?: V };
  };
