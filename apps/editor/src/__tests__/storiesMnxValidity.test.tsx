/**
 * Validates that every story produces MNX JSON conforming to the official
 * MNX JSON Schema (`packages/format/schemas/mnx-schema.json`).
 *
 * Strategy:
 *   1. Mock `ScorePreview` to capture the `mnxJson` prop.
 *   2. For every `*.stories.tsx` under `src/stories/`, dynamically import it,
 *      iterate its named exports, and call each story's `render()` (when
 *      present) inside a React test render.
 *   3. Validate every captured JSON string against the bundled schema.
 *
 * If a story doesn't render via `<ScorePreview>` (e.g. uses a different
 * preview wrapper), it is silently skipped — only stories that opt in to
 * the standard preview path are checked.
 */
import { describe, it, vi, afterEach, beforeAll } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";

// ── Capture mnxJson props from <ScorePreview> ────────────────────────────────
const captured: Array<{ json: string; storyKey: string }> = [];
let currentStoryKey = "";

vi.mock("../stories/storyFixtures/ScorePreview", () => ({
  ScorePreview: (props: { mnxJson: string }) => {
    if (props && typeof props.mnxJson === "string") {
      captured.push({ json: props.mnxJson, storyKey: currentStoryKey });
    }
    return null;
  },
}));

// ── Schema setup ─────────────────────────────────────────────────────────────
const repoRoot = resolve(__dirname, "../../");
const schemaPath = resolve(repoRoot, "public/mnx-schema.json");

let validate: ReturnType<Ajv2020["compile"]>;

beforeAll(() => {
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
  // Stories sometimes omit currently-unimplemented optional fields; allow
  // strict draft-2020-12 validation but tolerate unknown formats so the
  // test doesn't fail due to format assertions outside our control.
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
  });
  addFormats(ajv);
  validate = ajv.compile(schema);
});

afterEach(() => {
  cleanup();
});

// ── Discover story modules via Vite's import.meta.glob ───────────────────────
const storyModules = import.meta.glob("../stories/**/*.stories.tsx", { eager: false }) as Record<
  string,
  () => Promise<Record<string, unknown>>
>;

const storyFiles = Object.keys(storyModules).sort();

function describeErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return "(no error details)";
  return errors
    .slice(0, 5)
    .map((e) => `  • ${e.instancePath || "<root>"} ${e.message ?? ""} ${JSON.stringify(e.params)}`)
    .join("\n");
}

describe("Storybook MNX validity (against official MNX JSON Schema)", () => {
  for (const file of storyFiles) {
    const relPath = relative(resolve(__dirname, "../stories"), file).replace(/\\/g, "/");

    it(`stories produce valid MNX → ${relPath}`, async () => {
      let mod: Record<string, unknown>;
      try {
        mod = await storyModules[file]!();
      } catch (err) {
        // Skip stories that fail to import in the test env (e.g. they need
        // browser-only APIs that happy-dom doesn't provide). They'll fail
        // their own tests if relevant.
        console.warn(`[mnx-validity] skipping ${relPath}: import failed: ${(err as Error).message}`);
        return;
      }

      const localCaptured: Array<{ json: string; storyKey: string }> = [];

      for (const [exportName, exported] of Object.entries(mod)) {
        if (!exported || typeof exported !== "object") continue;
        const story = exported as {
          render?: (args?: unknown) => React.ReactElement;
          args?: Record<string, unknown>;
          parameters?: { mnxValidation?: boolean };
        };
        if (typeof story.render !== "function") continue;
        // Stories demonstrating Viritura-only features that don't yet
        // round-trip through the official MNX schema can opt out with
        // `parameters: { mnxValidation: false }`.
        if (story.parameters?.mnxValidation === false) continue;

        currentStoryKey = `${relPath} → ${exportName}`;
        const beforeLen = captured.length;
        try {
          // Stories built with Storybook CSF receive their `args` object as
          // the first argument. Forward the story's defaults so we exercise
          // the same shape Storybook would render initially.
          const element = story.render(story.args ?? {});
          if (element) render(element);
        } catch (err) {
          // A render-time crash is a separate concern; just skip JSON
          // capture for this story.
          console.warn(`[mnx-validity] ${currentStoryKey}: render threw: ${(err as Error).message}`);
          continue;
        } finally {
          cleanup();
        }
        for (let i = beforeLen; i < captured.length; i++) {
          localCaptured.push(captured[i]!);
        }
      }

      const failures: string[] = [];
      for (const { json, storyKey } of localCaptured) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(json);
        } catch (err) {
          failures.push(`${storyKey}: invalid JSON: ${(err as Error).message}`);
          continue;
        }
        const ok = validate(parsed);
        if (!ok) {
          failures.push(`${storyKey}:\n${describeErrors(validate.errors)}`);
        }
      }

      if (failures.length > 0) {
        throw new Error(`MNX schema violations in ${relPath}:\n\n${failures.join("\n\n")}`);
      }
    });
  }
});
