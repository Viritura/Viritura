/**
 * Point git at the versioned hooks directory (`.githooks`) and make the hook
 * scripts executable. Wired into `prepare`, so a fresh `pnpm install` activates
 * the staged pre-commit checks, whole-repository pre-push lint gate, and Git LFS
 * passthroughs automatically.
 *
 * Non-fatal everywhere: a missing git binary, a non-git checkout (CI tarball),
 * or a restricted environment must never break `pnpm install`.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const HOOKS_DIR = ".githooks";

function isInsideGitWorkTree(): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (!isInsideGitWorkTree() || !existsSync(HOOKS_DIR)) {
  // Nothing to wire up (e.g. installing from a tarball in CI).
  process.exit(0);
}

try {
  execFileSync("git", ["config", "core.hooksPath", HOOKS_DIR], { stdio: "ignore" });
  for (const name of readdirSync(HOOKS_DIR)) {
    try {
      chmodSync(join(HOOKS_DIR, name), 0o755);
    } catch {
      // chmod is a no-op / unsupported on some filesystems — ignore.
    }
  }
  console.log(`Git hooks installed (core.hooksPath = ${HOOKS_DIR}).`);
} catch (err) {
  console.warn(`Could not configure git hooks: ${(err as Error).message}`);
}
