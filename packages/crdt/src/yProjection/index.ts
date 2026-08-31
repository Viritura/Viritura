/**
 * Auto-generated Y.Doc projection — prototype.
 *
 * Schema-blind structural walker that projects MNX-shaped JSON into a
 * Yjs container tree (and back), proving the round-trip parity needed
 * before we add schema-driven codegen on top.
 *
 * Not yet wired into MnxYjsBridge — see ADR / data-model-pipeline.md.
 */

export { projectJsonIntoYDoc } from "./jsonToYDoc";
export { readJsonFromYDoc } from "./yDocToJson";
export { syncJsonToYDoc } from "./syncJsonToYDoc";
export { applyScorePatchesToYDoc } from "./applyScorePatchesToYDoc";
