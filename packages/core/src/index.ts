/**
 * @viritura/core — Score data model, enums, and constants.
 *
 * These types represent the in-memory score model. They map closely to
 * MNX's JSON structure but are our own typed interfaces, not a 1:1 mirror
 * of the MNX JSON schema. The @viritura/format package converts between
 * MNX JSON and these types.
 */

export * from "./enums";
export * from "./constants";
export * from "./textStyleDefaults";
export * from "./model";
export * from "./operations";
export * from "./patches";
export * from "./id";
export * from "./partDisplay";
export * from "./diagnostics";
export * from "./handoff";
