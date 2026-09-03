// Flat ESLint config for the whole workspace.
// Includes recommended JS + TS rules, React rules for .tsx, React-Compiler-
// aware rules, and complexity / file-size rules at thresholds chosen to
// mirror the Rust clippy bar (`too-many-lines = 200`,
// `too-many-arguments = allow`).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.turbo/**",
      "**/.astro/**",
      "**/.venv*/**",
      "**/coverage/**",
      "**/storybook-static/**",
      "**/storybook-mnx-static/**",
      "**/public/wasm/**",
      "engine/viritura-wasm/pkg-browser/**",
      "engine/target/**",
      "server/**",
      "tmp/**",
      "**/*.min.js",
      "**/*.map",
      // Generated config .d.ts (from tsc with declaration) and stale config .js (from a prior tsc)
      "**/*.config.d.ts",
      "**/*.config.js",
      "!eslint.config.js",
      // Codegen output (owned by `pnpm gen:raw`; carries its own eslint-disable
      // banner — linting it only yields spurious unused-directive warnings).
      "packages/core/src/raw/raw.ts",
      "packages/core/src/raw/raw-viritura.ts",
      // Bundled webview output (generated, not source)
      "apps/vscode-mnx-viewer/media/**",
    ],
  },

  // Base JS recommended for all JS/TS files
  js.configs.recommended,

  // TypeScript recommended (non-type-checked — fast, no project references needed)
  ...tseslint.configs.recommended,

  // unused-imports plugin: provides autofix-capable rules that replace the
  // built-in @typescript-eslint/no-unused-vars handling for imports + lets
  // us still flag truly unused locals (prefix with `_` to opt out).
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}"],
    plugins: { "unused-imports": unusedImports },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "error",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  // Language options shared by all source files
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2024,
      },
    },
  },

  // React rules for TSX/JSX files only
  {
    files: ["**/*.{jsx,tsx}"],
    ...react.configs.flat.recommended,
    settings: { react: { version: "detect" } },
  },
  {
    files: ["**/*.{jsx,tsx}"],
    ...react.configs.flat["jsx-runtime"],
  },
  {
    files: ["**/*.{jsx,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Classic correctness rules (kept at recommended level — usually "error").
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      // React-Compiler-aware rules added in eslint-plugin-react-hooks v7.
      // React Compiler IS adopted across all three Vite apps (editor, website,
      // vscode-mnx-viewer) via `babel-plugin-react-compiler`, wired through
      // `@rolldown/plugin-babel` + `reactCompilerPreset()` alongside
      // `@vitejs/plugin-react` (Vite 8's plugin-react dropped Babel support).
      // These rules flag patterns the compiler can still compile but cannot
      // memoize optimally — they're post-adoption refactor hints, not blockers.
      // Promoted to "error" so violations fail the build; any deliberate
      // exceptions carry an inline `// eslint-disable-next-line <rule> -- <why>`
      // at the call site.
      "react-hooks/refs": "error",
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/immutability": "error",
      "react-hooks/purity": "error",
      "react-refresh/only-export-components": ["error", { allowConstantExport: true }],
    },
  },

  // Config / build files: relax a few rules
  {
    files: ["**/*.config.{js,mjs,cjs,ts}", "**/vite.config.*", "**/vitest.config.*"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // CommonJS modules (`.cjs` / `.cts`): the package is `"type": "module"`, so
  // these extensions are explicitly CommonJS — `require()` is the correct idiom.
  {
    files: ["**/*.{cjs,cts}"],
    languageOptions: { sourceType: "commonjs", globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // Storybook story files: relax rules-of-hooks. Stories declare inline
  // `render: () => { … }` arrow functions that aren't named components, but
  // Storybook re-renders them as components on every state change, so calling
  // hooks inside is safe. Extracting each render to a named component would
  // bloat the story files without changing behaviour.
  {
    files: ["**/*.stories.{ts,tsx,js,jsx}"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },

  // ── Complexity & file-size rules ──────────────────────────────────────────
  // Mirrors the Rust clippy bar (`too-many-lines = 200`). Thresholds chosen
  // conservatively so they catch genuinely oversized code without flagging
  // legitimately complex code paths (canvas painters, MNX parsers, layout
  // orchestrators).
  //
  // Tests, stories, and config files are exempted (loops over fixtures and
  // declarative story arrays inflate the metrics without indicating debt).
  //
  // All `error`-level: `warn` is theater when the writer is an LLM that
  // ignores warnings. `max-depth` is set to 6 (not the default 5) because
  // the music-domain tree (score → part → measure → voice → event → note →
  // tie) naturally reaches depth 6 during walks; depth 7+ is the real
  // signal. `max-lines` is 800 (not 600) because cohesive single-concern
  // modules in the 600–800 range don't benefit from being split just to
  // satisfy a threshold.
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}"],
    rules: {
      // File-level
      "max-lines": ["error", { max: 800, skipBlankLines: true, skipComments: true }],
      // Function-level (matches Rust `too-many-lines-threshold = 200`)
      "max-lines-per-function": ["error", { max: 200, skipBlankLines: true, skipComments: true, IIFEs: true }],
      // Cyclomatic complexity
      complexity: ["error", { max: 25 }],
      // Block-nesting depth (6, not 5 — see header comment)
      "max-depth": ["error", { max: 6 }],
      // Callback nesting (catches promise-chain / handler pyramids)
      "max-nested-callbacks": ["error", { max: 5 }],
      // Statements per function (loose — anything >50 likely needs splitting)
      "max-statements": ["error", { max: 50 }],
      // Parameters per function — matches Rust `too_many_arguments = allow`
      // ethos: we have legitimate wide layout/audio APIs. Keep generous.
      "max-params": ["error", { max: 10 }],
    },
  },
  // Exempt tests, stories, fixtures, and config files from complexity rules.
  {
    files: [
      "**/*.test.{ts,tsx,js,jsx}",
      "**/*.spec.{ts,tsx,js,jsx}",
      "**/__tests__/**/*.{ts,tsx,js,jsx}",
      "**/*.stories.{ts,tsx,js,jsx}",
      "**/*.config.{js,mjs,cjs,ts}",
      "**/vite.config.*",
      "**/vitest.config.*",
    ],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
      complexity: "off",
      "max-depth": "off",
      "max-nested-callbacks": "off",
      "max-statements": "off",
      "max-params": "off",
    },
  },

  // ── Barrel discipline ─────────────────────────────────────────────────────
  // Enforces folder-as-module convention (see AGENTS.md → "Module Structure").
  // External code must import each Viritura package via its barrel
  // (`@viritura/<pkg>`); deep imports into internal files
  // (e.g. `@viritura/midi/timeline`) are forbidden. The packages listed below
  // have zero deep-imports today and are safe to enforce strictly. When a new
  // package becomes barrel-disciplined, add it here.
  {
    files: ["{apps,packages}/**/*.{ts,tsx,js,jsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex:
                "^@viritura/(audio|crdt|format|midi|musicxml|playback|renderer|score-engine|score-viewer-react|sound-profiles)/(?!.*\\.css$).+",
              message:
                "Import the package barrel only (e.g. `@viritura/midi`). Deep imports into a package's internals are forbidden — see AGENTS.md → Module Structure. (Raw `.css` deep imports are allowed for stylesheet entry points.)",
            },
            {
              regex: "^@viritura/ui/(?!tokens\\.css$|reset\\.css$).+",
              message:
                "Import @viritura/ui via its barrel. The only public stylesheet entry points are `@viritura/ui/tokens.css` and `@viritura/ui/reset.css`.",
            },
            {
              // @viritura/core is a special case: it declares `/raw` and
              // `/raw-viritura` as explicit subpath exports (see
              // packages/core/package.json) so codegen consumers can opt
              // into the raw MNX/Viritura schema types and JSON schema
              // without going through the trimmed barrel. Everything else
              // under @viritura/core must still flow through the barrel.
              regex: "^@viritura/core/(?!raw($|/|-viritura$))(?!.*\\.css$).+",
              message:
                "Import @viritura/core via its barrel. The only sanctioned deep entry points are `@viritura/core/raw` and `@viritura/core/raw-viritura` (declared as subpath exports in packages/core/package.json).",
            },
          ],
        },
      ],
    },
  },

  // ── Native dialog ban ─────────────────────────────────────────────────────
  // `alert` / `confirm` / `prompt` block the main thread, can't be styled,
  // ignore the theme, are unusable on touch, and are suppressible by the
  // browser ("prevent this page from creating additional dialogs"), which can
  // silently strand an `await`ed flow. Use the dialog system instead:
  // `PromptDialog` for text entry, `Dialog` + `DialogActions` for confirmation,
  // and `toast` (sonner) for one-way notices.
  //
  // Both spellings are covered: the bare global (`alert(...)`) and the explicit
  // member call (`window.alert(...)`).
  {
    files: ["packages/**/*.{ts,tsx,js,jsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "alert",
          message: "Use `toast` (sonner) for notices, or a Dialog from @viritura/ui. Native alerts block the thread.",
        },
        {
          name: "confirm",
          message: "Use a Dialog from @viritura/ui with explicit confirm/cancel actions instead of native confirm().",
        },
        {
          name: "prompt",
          message: "Use PromptDialog from @viritura/ui instead of native prompt().",
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "window",
          property: "alert",
          message: "Use `toast` (sonner) for notices, or a Dialog from @viritura/ui. Native alerts block the thread.",
        },
        {
          object: "window",
          property: "confirm",
          message: "Use a Dialog from @viritura/ui with explicit confirm/cancel actions instead of native confirm().",
        },
        {
          object: "window",
          property: "prompt",
          message: "Use PromptDialog from @viritura/ui instead of native prompt().",
        },
      ],
    },
  },

  // ── Styling discipline ────────────────────────────────────────────────────
  // Convention: all component styles live in colocated `*.module.css` files.
  // Static `style={{ ... }}` object literals are forbidden — they fragment
  // the design system, dodge tokens, and inflate component file size. Dynamic
  // styles (animated transforms, computed positions) should pass through a
  // named variable: `style={cursorStyle}` is permitted because the named
  // identifier signals intent. Truly unavoidable per-render literals can use
  // `// eslint-disable-next-line no-restricted-syntax` with a comment.
  //
  // See `packages/ui/src/docs/Introduction.mdx` ("CSS modules for component
  // styling, never inline styles").
  {
    files: ["packages/**/*.{jsx,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression",
          message:
            "Inline static style props are forbidden. Move the styles to a colocated *.module.css file. For genuinely dynamic styles, pass a named variable (style={someStyle}) rather than an object literal.",
        },
        {
          // Raw <dialog> elements bypass the @viritura/ui Dialog primitive,
          // which owns focus trap / scrim / a11y semantics. Always use the
          // primitive so behavior stays consistent across the app.
          selector: "JSXOpeningElement[name.name='dialog']",
          message: "Use the Dialog primitive from @viritura/ui instead of a raw <dialog> element.",
        },
      ],
    },
  },

  // ── Editor-only raw-element bans ──────────────────────────────────────────
  // Editor code must go through @viritura/ui primitives so styling, a11y, and
  // keyboard semantics stay consistent. UI-library internals are exempt — they
  // are the implementations these primitives wrap.
  //
  // Raw <button> is also banned. The handful of remaining sites carry an
  // inline `// eslint-disable-next-line no-restricted-syntax -- <reason>`
  // directive — they are genuinely bespoke chrome (MixerPanel M/S capsules,
  // GitHubAccountButton, GhostRailOverlay positional triggers, the publish
  // export CTA with pseudo-element shine, ColorSection swatches, etc.) whose
  // styling doesn't map onto Button/IconButton without significant rework.
  ...(() => {
    const EDITOR_RAW_ELEMENT_BANS = [
      {
        selector: "JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression",
        message:
          "Inline static style props are forbidden. Move the styles to a colocated *.module.css file. For genuinely dynamic styles, pass a named variable (style={someStyle}) rather than an object literal.",
      },
      {
        selector: "JSXOpeningElement[name.name='dialog']",
        message: "Use the Dialog primitive from @viritura/ui instead of a raw <dialog> element.",
      },
      {
        selector: "JSXOpeningElement[name.name='select']",
        message: "Use Select from @viritura/ui (or FormSelect for form rows) instead of a raw <select> element.",
      },
      {
        selector: "JSXOpeningElement[name.name='textarea']",
        message: "Use FormTextarea from @viritura/ui instead of a raw <textarea> element.",
      },
      {
        selector: "JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'][value.value='radio']",
        message: 'Use Radio / RadioGroup from @viritura/ui instead of a raw <input type="radio"> element.',
      },
      {
        selector: "JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'][value.value='checkbox']",
        message: 'Use Checkbox from @viritura/ui instead of a raw <input type="checkbox"> element.',
      },
      {
        selector: "JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'][value.value='range']",
        message: 'Use Slider from @viritura/ui instead of a raw <input type="range"> element.',
      },
      {
        selector: "JSXOpeningElement[name.name='input']",
        message:
          "Use FormInput from @viritura/ui instead of a raw <input> element. (FormInput passes through all native input props including type, value, ref, className, style, and data-*.)",
      },
      {
        selector: "JSXOpeningElement[name.name='button']",
        message:
          "Use Button / IconButton / ListRow / ButtonGroup from @viritura/ui instead of a raw <button> element. For genuinely bespoke chrome (mixer M/S capsules, positional canvas triggers, CTAs with pseudo-element effects), add an inline `// eslint-disable-next-line no-restricted-syntax -- <reason>` justification.",
      },
      {
        // Native `title=` shows the OS-rendered browser tooltip, which has
        // none of our design-system styling, no consistent positioning,
        // and is invisible to touch / keyboard users. Use <Tooltip> from
        // @viritura/ui (or the `tooltip` prop baked into our primitives).
        // The selector targets `title=` on intrinsic JSX elements only
        // (lowercase tag names) so that primitive components — whose
        // `title` prop is a routed tooltip — remain unaffected.
        // Exception: the HTML `pattern` validation message on
        // <input pattern> is read by the browser when the pattern fails.
        // Add `// eslint-disable-next-line no-restricted-syntax -- HTML
        // pattern mismatch message` at those sites.
        selector: "JSXOpeningElement[name.type='JSXIdentifier'][name.name=/^[a-z]/] > JSXAttribute[name.name='title']",
        message:
          "Use <Tooltip> from @viritura/ui (or a primitive's `tooltip` prop) instead of native `title=` on intrinsic elements — native tooltips bypass our design system and are inaccessible to touch / keyboard users. For HTML <input pattern> validation messages, add an inline `// eslint-disable-next-line no-restricted-syntax -- HTML pattern mismatch message` directive.",
      },
    ];

    // ── Selector-policy bans (a11y over data-testid) ────────────────────────
    // Tests should query by accessible role / name / label / text — what a
    // real user perceives — not by opaque `data-testid` strings. testids are
    // a code smell signalling that the element lacks the a11y affordances
    // it should have. Scoped here to new code (currently `apps/editor/
    // src/live/**`) so the policy can be ratcheted folder-by-folder without
    // requiring a workspace-wide refactor of the ~100 existing testids.
    const TESTID_BANS = [
      {
        selector: "JSXAttribute[name.name='data-testid']",
        message:
          "Avoid data-testid — use accessible selectors (getByRole + name, getByLabelText, getByText). data-testid is a code smell signalling missing a11y semantics. If the element genuinely can't be queried any other way, add `// eslint-disable-next-line no-restricted-syntax -- <reason>` with a real justification.",
      },
      {
        selector: "JSXAttribute[name.name='testId']",
        message:
          "Avoid the testId prop (forwards to data-testid). Use accessible selectors instead — see the data-testid message above.",
      },
    ];

    return [
      {
        files: ["apps/editor/**/*.{jsx,tsx}"],
        ignores: ["**/*.stories.{ts,tsx,js,jsx}"],
        rules: {
          "no-restricted-syntax": ["error", ...EDITOR_RAW_ELEMENT_BANS],
        },
      },
      {
        // Native `title=` ban also applies to website and the UI package
        // internals (the primitive `title` prop alias was removed; all
        // remaining `title=` in @viritura/ui must be the routed `tooltip`
        // prop). Stories are exempt.
        files: ["packages/{website,ui}/**/*.{jsx,tsx}"],
        ignores: ["**/*.stories.{ts,tsx,js,jsx}"],
        rules: {
          "no-restricted-syntax": [
            "error",
            EDITOR_RAW_ELEMENT_BANS[EDITOR_RAW_ELEMENT_BANS.length - 1], // title-on-intrinsic ban
          ],
        },
      },
      {
        // Stricter rules for new code: forbid data-testid / testId. New
        // editor folders should be added to this `files` glob as they are
        // brought into compliance; older code stays under the editor-wide
        // block above without flagging on testids.
        files: ["apps/editor/src/live/**/*.{jsx,tsx}"],
        rules: {
          "no-restricted-syntax": ["error", ...EDITOR_RAW_ELEMENT_BANS, ...TESTID_BANS],
        },
      },
    ];
  })(),

  // ── Patch-IR discipline (commands/) ───────────────────────────────────────
  // Editor commands must produce a new Score via `applyPatchesToScore` (see
  // `packages/core/src/patches/`) rather than mutating the input score in
  // place. This rule is a tripwire for the most direct anti-patterns:
  //
  //   score.foo = bar      ← banned
  //   score[idx] = bar     ← banned
  //
  // Most legitimate command code creates a new Score via `cloneScore`,
  // `structuredClone`, `produce`, or by returning the result of
  // `applyPatchesToScore` — none of which trip this rule. The rule does NOT
  // catch mutations through local aliases (e.g. `const part = score.parts[0];
  // part.name = "x"`); a custom alias-tracking rule is future work. The
  // intent here is to prevent the most obvious regression while the
  // command-by-command patch conversion proceeds.
  //
  // For unconverted commands that genuinely need to mutate during a transitional
  // clone-then-mutate pattern, the mutation is on a clone (not on `score`
  // itself), so this rule does not trip.
  {
    files: ["apps/editor/src/commands/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "AssignmentExpression[left.type='MemberExpression'][left.object.name='score']",
          message:
            "Direct mutation of `score.*` is forbidden in commands. Plan a `ScorePatch[]` and call `applyPatchesToScore` (see packages/core/src/patches), or clone first.",
        },
      ],
    },
  },

  // All grandfather blocks (inline-style, React-Compiler-aware, size /
  // complexity) have been burned down: every former entry now has an inline
  // `// eslint-disable-next-line <rule> -- <justification>` directive at the
  // actual violation site (or, where the violation sits inside a JSX
  // attribute list and can't take an inline comment, a file-level
  // `/* eslint-disable <rule> -- … */` at the top of the file). This is
  // strictly narrower than per-file grandfather lists and forces every
  // suppression to carry a real reason (AGENTS.md → rule 6).
);
