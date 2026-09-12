#!/usr/bin/env -S node --experimental-strip-types

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SystemCommandRunner } from "./commandRunner.ts";
import { commands, type WorktreeCommand } from "./config.ts";
import { runStackCommand } from "./stack.ts";

export { deriveSlug, getProfiles, getStateRoot, needsWasm } from "./config.ts";
export { getCleanupAction } from "./leases.ts";

export async function main(args = process.argv.slice(2)): Promise<void> {
  const command = args[0] ?? "status";
  if (!commands.includes(command as WorktreeCommand)) {
    throw new Error(`Unknown command '${command}' (known: ${commands.join(", ")})`);
  }
  await runStackCommand(command as WorktreeCommand, args.slice(1), new SystemCommandRunner());
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (entryPath === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
