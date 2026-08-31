#!/usr/bin/env node
/**
 * Enforces folder-level cohesion for authored Rust source.
 *
 * Module roots use the modern `feature.rs` plus `feature/` layout; legacy
 * `feature/mod.rs` roots are rejected across production and test modules.
 *
 * New files may contain at most 800 lexical code lines. Blank lines and lines
 * containing only comments (including doc comments) do not count. Existing oversized files
 * are tracked by an explicit baseline with bounded headroom for small fixes.
 * Meaningful shrinkage must lower that baseline, and the exemption disappears
 * once a file reaches the normal limit. This turns existing debt into a ratchet
 * without forcing an unrelated extraction before every small correctness fix.
 *
 * Generated schema bindings and test fixture modules are excluded. Clippy's
 * `too_many_lines` remains the function-level gate; this script supplies the
 * file-level gate that Clippy does not provide.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const engineRoot = join(repoRoot, "engine");
const MAX_AUTHORED_FILE_LINES = 800;
const MAX_LEGACY_HEADROOM = 25;

/**
 * Narrow exceptions for cohesive declarative surfaces where file length is a
 * poor proxy for maintainability. Additions require an architectural rationale;
 * ordinary algorithmic pipelines belong in LEGACY_LINE_BASELINES instead.
 */
const JUSTIFIED_LIMITS: Readonly<Record<string, { limit: number; reason: string }>> = {
  "engine/viritura-engine/src/render/binary.rs": {
    limit: 1200,
    reason: "paired exhaustive display-list binary encoder/decoder",
  },
  "engine/viritura-engine/src/render/smufl.rs": {
    limit: 2500,
    reason: "central SMuFL codepoint and glyph-metadata tables",
  },
};

/**
 * Temporary baselines for pre-existing oversized algorithmic files.
 *
 * Each baseline receives `min(25, 2%)` lines of fixed headroom for small fixes.
 * Do not add or increase an entry as part of ordinary feature work. When a file
 * shrinks beyond its headroom, lower the baseline to the new count; remove it
 * at <= 800 lines.
 */
const LEGACY_LINE_BASELINES: Readonly<Record<string, number>> = {};

const IGNORED_DIRS: ReadonlySet<string> = new Set(["target", "tests"]);
const GENERATED_FILES: ReadonlySet<string> = new Set([
  "engine/viritura-engine/src/raw.rs",
  "engine/viritura-engine/src/raw_viritura.rs",
]);
const GRANDFATHERED_GRABBAG_PATHS: ReadonlySet<string> = new Set([
  "engine/viritura-engine/src/layout/measure/helpers.rs",
  "engine/viritura-engine/src/layout/mnx_layout/shared.rs",
  "engine/viritura-engine/src/layout/render_geometry/helpers.rs",
]);
const BANNED_GRABBAG_FILENAMES: ReadonlySet<string> = new Set([
  "helpers.rs",
  "internal.rs",
  "misc.rs",
  "shared.rs",
  "utils.rs",
]);

interface SourceFile {
  path: string;
  lines: number;
  text: string;
}

function repoPath(absolutePath: string): string {
  return relative(repoRoot, absolutePath).split(sep).join("/");
}

/**
 * Count lines containing Rust tokens, excluding whitespace and comments.
 *
 * This small lexer understands nested block comments plus normal, character,
 * and raw strings. String contents count as code because they are part of a
 * source expression; comment markers inside strings are never stripped.
 */
// eslint-disable-next-line max-statements -- Single-pass Rust lexical state machine; splitting transitions would obscure shared quote/comment state.
function codeLineCount(text: string): number {
  const normalized = withoutTrailingTestModule(text.replaceAll("\r\n", "\n"));
  let blockCommentDepth = 0;
  let quote: '"' | "'" | undefined;
  let escaped = false;
  let rawStringHashes: number | undefined;
  let count = 0;

  for (const line of normalized.split("\n")) {
    let hasCode = quote !== undefined || rawStringHashes !== undefined;
    let index = 0;
    while (index < line.length) {
      if (blockCommentDepth > 0) {
        if (line.startsWith("/*", index)) {
          blockCommentDepth++;
          index += 2;
        } else if (line.startsWith("*/", index)) {
          blockCommentDepth--;
          index += 2;
        } else {
          index++;
        }
        continue;
      }

      if (rawStringHashes !== undefined) {
        hasCode = true;
        const terminator = `"${"#".repeat(rawStringHashes)}`;
        const end = line.indexOf(terminator, index);
        if (end < 0) break;
        rawStringHashes = undefined;
        index = end + terminator.length;
        continue;
      }

      if (quote !== undefined) {
        hasCode = true;
        const char = line[index]!;
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = undefined;
        index++;
        continue;
      }

      if (line.startsWith("//", index)) break;
      if (line.startsWith("/*", index)) {
        blockCommentDepth = 1;
        index += 2;
        continue;
      }

      const rawMatch = line.slice(index).match(/^(?:br|r)(#+)?"/);
      if (rawMatch) {
        const prefix = rawMatch[0];
        rawStringHashes = (prefix.match(/#/g) ?? []).length;
        hasCode = true;
        index += prefix.length;
        continue;
      }

      const char = line[index]!;
      if (char === '"') {
        quote = char;
        hasCode = true;
      } else if (char === "'") {
        // A lifetime (`'a`) is a token, not the start of a character literal.
        // Enter quote mode only when a closing apostrophe exists on this line.
        hasCode = true;
        if (/^'(?:\\.|[^'\\])+'/.test(line.slice(index))) quote = char;
      } else if (!/\s/.test(char)) {
        hasCode = true;
      }
      index++;
    }
    if (hasCode) count++;
  }
  return count;
}

/** Exclude a conventional trailing `#[cfg(test)] mod … {}` from production size. */
function withoutTrailingTestModule(text: string): string {
  const match = /(?:^|\n)\s*#\[cfg\(test\)\]\s*\n\s*mod\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/.exec(text);
  return match ? text.slice(0, match.index) : text;
}

function validateCodeLineCounter(): void {
  const fixture = `
// comment-only line
fn sample<'a>() { // lifetime plus trailing comment
    let url = "https://example.test//path";
    /* outer comment
       nested /* comment */
    */
    let raw = r#"// raw-string content
/* still raw-string content */"#;
}
#[cfg(test)]
mod tests {
  #[test]
  fn verbose_fixture() {}
}
`;
  const actual = codeLineCount(fixture);
  if (actual !== 5) throw new Error(`Rust code-line lexer self-test failed: expected 5, got ${actual}`);
}

function collectRustSources(dir: string, out: SourceFile[]): void {
  for (const name of readdirSync(dir)) {
    if (IGNORED_DIRS.has(name)) continue;
    const absolutePath = join(dir, name);
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      collectRustSources(absolutePath, out);
      continue;
    }
    if (!stat.isFile() || !name.endsWith(".rs")) continue;
    const path = repoPath(absolutePath);
    if (GENERATED_FILES.has(path) || name === "tests.rs") continue;
    const text = readFileSync(absolutePath, "utf8");
    out.push({ path, lines: codeLineCount(text), text });
  }
}

function collectLegacyModuleRoots(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "target") continue;
    const absolutePath = join(dir, name);
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      collectLegacyModuleRoots(absolutePath, out);
    } else if (stat.isFile() && name === "mod.rs") {
      out.push(repoPath(absolutePath));
    }
  }
}

if (!existsSync(engineRoot)) {
  console.error(`Cannot read Rust engine root: ${engineRoot}`);
  process.exit(2);
}

validateCodeLineCounter();
const sources: SourceFile[] = [];
collectRustSources(engineRoot, sources);
const byPath = new Map(sources.map((source) => [source.path, source]));
const violations: string[] = [];
const legacyModuleRoots: string[] = [];
collectLegacyModuleRoots(engineRoot, legacyModuleRoots);
for (const path of legacyModuleRoots) {
  violations.push(
    `${path}: use the modern module layout (module.rs with child modules in module/) instead of module/mod.rs`,
  );
}

if (process.argv.includes("--report")) {
  const oversized = sources
    .filter((source) => source.lines > MAX_AUTHORED_FILE_LINES)
    .sort((a, b) => b.lines - a.lines);
  console.log(`Rust files above ${MAX_AUTHORED_FILE_LINES} lexical code lines: ${oversized.length}`);
  for (const source of oversized) {
    const exception = JUSTIFIED_LIMITS[source.path];
    const baseline = LEGACY_LINE_BASELINES[source.path];
    const category = exception ? "justified" : baseline === undefined ? "untracked" : "legacy";
    console.log(`${source.lines.toString().padStart(5)}  ${category.padEnd(9)}  ${source.path}`);
  }
}

for (const source of sources) {
  const filename = source.path.slice(source.path.lastIndexOf("/") + 1);
  const isNumberedSplit = /^(?:chunk|part)[-_]?\d+\.rs$/i.test(filename);
  if (!GRANDFATHERED_GRABBAG_PATHS.has(source.path) && (BANNED_GRABBAG_FILENAMES.has(filename) || isNumberedSplit)) {
    violations.push(`${source.path}: name the module after its domain concept, not a grab-bag or numbered split`);
  }

  const justified = JUSTIFIED_LIMITS[source.path];
  const legacyBaseline = LEGACY_LINE_BASELINES[source.path];
  if (justified) {
    if (source.lines > justified.limit) {
      violations.push(
        `${source.path}: ${source.lines} code lines exceeds justified limit ${justified.limit} (${justified.reason})`,
      );
    }
  } else if (legacyBaseline === undefined) {
    if (source.lines > MAX_AUTHORED_FILE_LINES) {
      violations.push(
        `${source.path}: ${source.lines} code lines exceeds ${MAX_AUTHORED_FILE_LINES}; grow the concept into a folder, not a larger file`,
      );
    }
  } else {
    const headroom = Math.min(MAX_LEGACY_HEADROOM, Math.max(1, Math.floor(legacyBaseline * 0.02)));
    const ceiling = legacyBaseline + headroom;
    if (source.lines > ceiling) {
      violations.push(
        `${source.path}: ${source.lines} code lines exceeds legacy ceiling ${ceiling} (baseline ${legacyBaseline} + ${headroom} fix headroom)`,
      );
    } else if (source.lines <= MAX_AUTHORED_FILE_LINES) {
      violations.push(
        `${source.path}: reduced to ${source.lines} code lines; remove its stale legacy baseline now that it is within the normal limit`,
      );
    } else if (source.lines < legacyBaseline - headroom) {
      violations.push(
        `${source.path}: reduced from baseline ${legacyBaseline} to ${source.lines} code lines; ratchet the baseline down to ${source.lines}`,
      );
    }
  }

  const lines = source.text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line.includes("#[allow(clippy::too_many_lines)]")) continue;
    const comment = line.split("//", 2)[1]?.trim();
    if (!comment || comment.length < 12) {
      violations.push(
        `${source.path}:${index + 1}: clippy::too_many_lines allowance needs a specific trailing justification`,
      );
    }
  }
}

for (const path of [...Object.keys(LEGACY_LINE_BASELINES), ...Object.keys(JUSTIFIED_LIMITS)]) {
  if (!byPath.has(path)) violations.push(`${path}: stale size-policy entry; file no longer exists`);
}

if (violations.length > 0) {
  console.error("\nRust source-size/cohesion check failed:\n");
  for (const violation of violations) console.error(`  - ${violation}`);
  console.error(
    "\nAGENTS.md Module Structure: use module.rs plus module/ children, and extract named domain concepts when files approach 800 code lines.\n",
  );
  process.exit(1);
}
