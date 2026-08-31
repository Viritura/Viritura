import { resolve } from "node:path";
import { syncSoundAssets } from "../src/assetStaging.ts";

const destination = process.argv[2];
if (!destination) {
  throw new Error("Usage: pnpm --filter @viritura/audio stage-sounds <destination>");
}

syncSoundAssets(resolve(destination));
