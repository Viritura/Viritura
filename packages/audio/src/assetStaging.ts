import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const audioRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = dirname(fileURLToPath(import.meta.resolve("spessasynth_lib/package.json")));
const canonicalSounds = resolve(audioRoot, "assets/sounds");
const stageLockRoot = resolve(audioRoot, "node_modules/.cache/viritura-sound-assets");
const SOUND_ASSETS = [
  "Shan-SGM-Pro-15.sf2",
  "ir/french-salon.wav",
  "ir/masonic-lodge.wav",
  "ir/musikvereinsaal.wav",
  "ir/scala-milan-opera.wav",
  "ir/st-nicolaes-church.wav",
];
const WORKLET_ASSETS = ["spessasynth_processor.min.js", "spessasynth_processor.min.js.map"];
const lockWaiter = new Int32Array(new SharedArrayBuffer(4));

export function syncSoundAssets(destination: string): void {
  const destinationRoot = resolve(destination);
  const lockName = createHash("sha256").update(destinationRoot).digest("hex");

  withStageLock(resolve(stageLockRoot, lockName), () => {
    for (const asset of SOUND_ASSETS) {
      copyIfChanged(resolve(canonicalSounds, asset), resolve(destinationRoot, asset));
    }
    for (const asset of WORKLET_ASSETS) {
      copyIfChanged(resolve(packageRoot, "dist", asset), resolve(destinationRoot, asset));
    }
  });
}

function copyIfChanged(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  if (!existsSync(destination) || !readFileSync(source).equals(readFileSync(destination))) {
    copyFileSync(source, destination);
  }
}

function withStageLock(stageLock: string, sync: () => void): void {
  mkdirSync(dirname(stageLock), { recursive: true });
  for (let attempt = 0; ; attempt += 1) {
    try {
      mkdirSync(stageLock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt === 400) throw error;
      Atomics.wait(lockWaiter, 0, 0, 25);
    }
  }

  try {
    sync();
  } finally {
    rmSync(stageLock, { force: true, recursive: true });
  }
}
