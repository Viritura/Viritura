import { createHash } from "node:crypto";
import { basename, posix, win32 } from "node:path";

export const commands = [
  "up",
  "watch",
  "stop",
  "down",
  "restart",
  "rebuild",
  "status",
  "logs",
  "wasm",
  "url",
  "slug",
  "keepalive",
  "cleanup",
  "proxy",
  "proxy-down",
  "prune",
] as const;

export type WorktreeCommand = (typeof commands)[number];

const profileAliases: Readonly<Record<string, string>> = {
  core: "app",
  app: "app",
  editor: "editor",
  ui: "ui",
  frontend: "ui",
  website: "website",
  web: "website",
  backend: "backend",
  api: "backend",
  storybook: "storybook",
  stories: "storybook",
  "storybook-ui": "storybook-ui",
  "ui-stories": "storybook-ui",
  "storybook-mnx": "storybook-mnx",
  "mnx-stories": "storybook-mnx",
  "storybook-app": "storybook-app",
  "app-stories": "storybook-app",
  full: "full",
  all: "full",
};

export interface StatePathEnvironment {
  readonly [key: string]: string | undefined;
  readonly LOCALAPPDATA?: string;
  readonly XDG_STATE_HOME?: string;
  readonly HOME?: string;
}

export function getStateRoot(
  platform: NodeJS.Platform,
  environment: StatePathEnvironment,
  homeDirectory: string,
): string {
  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA;
    if (!localAppData) throw new Error("LOCALAPPDATA is not defined.");
    return win32.join(localAppData, "Viritura", "dev");
  }
  if (platform === "darwin") {
    return posix.join(homeDirectory, "Library", "Application Support", "Viritura", "dev");
  }
  return posix.join(
    environment.XDG_STATE_HOME ?? posix.join(environment.HOME ?? homeDirectory, ".local", "state"),
    "viritura",
    "dev",
  );
}

export function deriveSlug(repositoryRoot: string, branch: string | undefined): string {
  const source = branch && branch !== "HEAD" ? branch : basename(repositoryRoot);
  const normalized = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28)
    .replace(/-$/g, "");
  const base = normalized || "wt";
  const hash = createHash("md5").update(repositoryRoot.toLowerCase()).digest("hex").slice(0, 4);
  return `${base}-${hash}`;
}

export function getProfiles(targets: readonly string[]): string[] {
  const requested = targets.length > 0 ? targets : ["app"];
  const profiles: string[] = [];
  for (const target of requested) {
    const profile = profileAliases[target.toLowerCase()];
    if (!profile) {
      throw new Error(
        `Unknown stack target '${target}' (known: app, core, editor, ui, website, backend, storybook[-ui|-mnx|-app], full)`,
      );
    }
    if (!profiles.includes(profile)) profiles.push(profile);
  }
  return profiles;
}

export function needsWasm(targets: readonly string[]): boolean {
  return targets.length === 0 || targets.some((target) => !["backend", "api"].includes(target.toLowerCase()));
}
