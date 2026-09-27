import { version as scoreEngineVersion } from "@viritura/score-engine/package.json";

/**
 * Where `scripts/copy-assets.ts` stages the published engine's WASM, fonts and
 * worker. Every `<ScoreViewer>` and `loadEngine()` call on the site must pass
 * this so they share one engine instance and resolve the files for the exact
 * engine release the site was built against.
 */
export const SCORE_ENGINE_ASSET_BASE_URL = `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}score-engine/${scoreEngineVersion}/`;
