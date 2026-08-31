/**
 * Key signature (MNX-aligned). Uses the circle of fifths representation.
 *
 * Derived from raw `Key` via `WithVendor`, which retypes `_x.viritura` so
 * `atonal` can be statically typed (the raw codegen otherwise produces
 * `Record<string, never>` for vendor dicts).
 */
import type { Key as RawKey } from "../raw";
import type { HoistVendor } from "./_derive";

export type KeySignature = HoistVendor<RawKey, { atonal?: boolean }>;
