#!/usr/bin/env node
/**
 * Viritura dev launcher.
 *
 * Two ways to use:
 *
 *   1. Interactive (no args) — pops a terminal checkbox UI so you can
 *      space-bar to toggle services, Enter to confirm. Used by the
 *      "Viritura: Dev (pick services)" launch config so you get a real
 *      multi-select picker every time you hit F5. (VS Code's pickString
 *      input never actually shipped multiSelect support — see
 *      microsoft/vscode#98789 — so we do the multi-select ourselves.)
 *
 *      pnpm tsx scripts/dev.ts
 *
 *   2. Direct (CLI args) — pass service ids as space- or comma-separated
 *      tokens. Skips the picker. Useful for muscle-memory shortcuts or
 *      package.json scripts.
 *
 *      pnpm tsx scripts/dev.ts editor api wasm storybook-app
 *      pnpm tsx scripts/dev.ts editor,wasm,storybook-app
 *
 * Add a new service by extending the SERVICES map below — the picker
 * picks it up automatically.
 *
 * The picker remembers your last selection in `.viritura-dev-state.json`
 * at the repo root (gitignored). Delete that file to reset to the
 * built-in defaults.
 */
import concurrently from "concurrently";
import checkbox from "@inquirer/checkbox";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface ServiceDef {
  name: string;
  color: string;
  command: string;
  label: string;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_FILE = resolve(REPO_ROOT, ".viritura-dev-state.json");

function loadLastSelection(): string[] | null {
  try {
    const raw = readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as { lastSelection?: unknown };
    if (Array.isArray(parsed.lastSelection)) return parsed.lastSelection as string[];
  } catch {
    /* first run / corrupt file — fall through */
  }
  return null;
}

function saveLastSelection(selection: string[]): void {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify({ lastSelection: selection, savedAt: new Date().toISOString() }, null, 2));
  } catch (err) {
    console.warn(`(could not persist selection to ${STATE_FILE}: ${(err as Error).message})`);
  }
}

const SERVICES: Record<string, ServiceDef> = {
  editor: { name: "EDITOR", color: "cyan", command: "corepack pnpm dev:editor", label: "Vite Editor" },
  "editor-prod": {
    name: "PROD",
    color: "cyanBright",
    command: "corepack pnpm preview:prod",
    label: "Editor prod preview (no HMR, port 3000)",
  },
  api: {
    name: "API",
    color: "gray",
    command: "dotnet watch --project server/Viritura.Api run --launch-profile Viritura.Api",
    label: "ASP.NET API (hot reload, http://localhost:5000 + https://localhost:5001)",
  },
  wasm: {
    name: "WASM",
    color: "red",
    command: "corepack pnpm wasm:watch",
    label: "WASM Watch (rebuild engine on change)",
  },
  "storybook-ui": {
    name: "UI-SB",
    color: "yellow",
    command: "corepack pnpm dev:storybook:ui",
    label: "Storybook · UI (port 6005)",
  },
  "storybook-mnx": {
    name: "MNX-SB",
    color: "blue",
    command: "corepack pnpm dev:storybook:mnx",
    label: "Storybook · MNX (port 6006)",
  },
  "storybook-app": {
    name: "APP-SB",
    color: "magenta",
    command: "corepack pnpm dev:storybook",
    label: "Storybook · App (port 6007)",
  },
  website: { name: "WEB", color: "green", command: "corepack pnpm dev:website", label: "Marketing website" },
};

const FALLBACK_DEFAULTS = ["editor", "wasm", "storybook-app"];

async function resolveSelection(): Promise<string[]> {
  const cliArgs = process.argv
    .slice(2)
    .flatMap((arg) => arg.split(","))
    .map((s) => s.trim())
    .filter(Boolean);

  if (cliArgs.length > 0) {
    const unknown = cliArgs.filter((s) => !SERVICES[s]);
    if (unknown.length > 0) {
      console.error(`Unknown service(s): ${unknown.join(", ")}`);
      console.error("Available:\n  " + Object.keys(SERVICES).join("\n  "));
      process.exit(1);
    }
    return cliArgs;
  }

  // The picker remembers your last selection across runs. First-time
  // users get FALLBACK_DEFAULTS pre-checked.
  const previous = loadLastSelection();
  const preChecked = (previous ?? FALLBACK_DEFAULTS).filter((s) => SERVICES[s]);

  // Interactive picker. `@inquirer/checkbox` needs a TTY; if stdin is
  // piped (CI, redirect, etc.) we fall back to the saved/default set
  // instead of hanging.
  if (!process.stdin.isTTY) {
    console.log(`(non-interactive stdin \u2014 using ${preChecked.join(", ")})`);
    return preChecked.length > 0 ? preChecked : FALLBACK_DEFAULTS;
  }

  const picked = await checkbox({
    message: "Which Viritura services do you want to run? (space to toggle, enter to confirm)",
    pageSize: Object.keys(SERVICES).length + 2,
    choices: Object.entries(SERVICES).map(([id, svc]) => ({
      name: `${id.padEnd(15)} ${svc.label}`,
      value: id,
      checked: preChecked.includes(id),
    })),
    instructions: false,
  });

  if (picked.length === 0) {
    console.error("Nothing selected \u2014 exiting.");
    process.exit(0);
  }
  saveLastSelection(picked);
  return picked;
}

const selected = await resolveSelection();
const commands = selected.map((s) => SERVICES[s]!);
console.log("\n▶ Starting:", selected.join(", "), "\n");

const { result } = concurrently(commands, {
  prefix: "name",
  killOthers: ["failure"],
  restartTries: 0,
});

result.catch(() => process.exit(1));
