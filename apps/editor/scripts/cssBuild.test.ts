import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import postcss from "postcss";
import { build } from "vite";
import { cssBuildOptions } from "../../../scripts/cssBuild";

const repoRoot = resolve(import.meta.dirname, "../../..");

test("production CSS preserves floating glass filters and CSS Module composition", async () => {
  const tokensPath = resolve(repoRoot, "packages/ui/src/tokens.css");
  const menuPath = resolve(repoRoot, "apps/editor/src/components/MenuBar.module.css");
  const statusPath = resolve(repoRoot, "packages/ui/src/StatusBar/StatusSelect.module.css");
  const entry = "virtual:css-build-regression";
  const result = await build({
    configFile: false,
    root: repoRoot,
    publicDir: false,
    logLevel: "silent",
    plugins: [
      {
        name: "css-build-regression",
        resolveId: (id) => (id === entry ? `\0${entry}` : undefined),
        load: (id) =>
          id === `\0${entry}`
            ? `import ${JSON.stringify(tokensPath)};
               import menu from ${JSON.stringify(menuPath)};
               import status from ${JSON.stringify(statusPath)};
               console.log(menu.dropdown, menu.submenu, status);`
            : undefined,
      },
    ],
    build: {
      ...cssBuildOptions,
      write: false,
      rollupOptions: { input: entry },
    },
  });
  assert.ok(!Array.isArray(result) && "output" in result);
  const cssAsset = result.output.find((item) => item.type === "asset" && item.fileName.endsWith(".css"));
  assert.ok(cssAsset?.type === "asset" && typeof cssAsset.source === "string");
  const css = postcss.parse(cssAsset.source);
  const glassRules: postcss.Rule[] = [];
  css.walkRules(".vi-glass-floating", (rule) => {
    glassRules.push(rule);
  });
  assert.equal(glassRules.length, 1);
  const glass = glassRules[0];
  assert.ok(glass);
  const filter = glass.nodes.find((node) => node.type === "decl" && node.prop === "backdrop-filter");
  assert.ok(filter?.type === "decl");
  assert.equal(filter.value, "var(--glass-floating-filter)");
  const prefixedFilter = glass.nodes.find((node) => node.type === "decl" && node.prop === "-webkit-backdrop-filter");
  assert.ok(prefixedFilter?.type === "decl");
  assert.equal(prefixedFilter.value, "var(--glass-floating-filter)");
  const background = glass.nodes.find((node) => node.type === "decl" && node.prop === "background");
  assert.ok(background?.type === "decl");
  assert.equal(background.value, "var(--glass-floating-bg)");
  const filterRules: postcss.Rule[] = [];
  css.walkDecls("backdrop-filter", (decl) => {
    assert.equal(decl.value, "var(--glass-floating-filter)");
    if (decl.parent?.type === "rule") filterRules.push(decl.parent);
  });
  assert.ok(filterRules.length >= 2, "both shared glass and status dropdown filters must survive");
  const js = result.output
    .filter((item) => item.type === "chunk")
    .map((item) => item.code)
    .join("\n");
  assert.ok(js.includes("vi-glass-floating"), "CSS Module exports must include the global material class");
});
