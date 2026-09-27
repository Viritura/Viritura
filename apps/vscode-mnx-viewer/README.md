# Viritura MNX Viewer

VS Code extension package for MNX preview support.

## Install

Install from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=Viritura.mnx-viewer).

## Current capabilities

- Registers `.mnx` files as `mnx` language.
- Opens `.mnx` files in the rendered MNX Viewer by default, with VS Code's **Reopen Editor With...** available for source text.
- Adds **MNX: Open Preview** command in editor title and explorer context menu.
- Opens a side preview panel that renders MNX through the Viritura WASM layout engine and Canvas painter.
- Refreshes the preview as the source document changes.
- Provides zoom, fit-to-width, and Ctrl+wheel zoom controls.
- Supports page, horizontal, spread, horizontal spread, and continuous Horizon arrangements.
- Offers page-size and staff-size controls for paged arrangements.
- Lets you select among multiple scores in an MNX document.
- Reports loading, parse, layout, and runtime errors inside the preview.
- Bundles the WASM engine and SMuFL/text fonts into the VSIX for local/offline use.

## Local development

```bash
corepack pnpm --filter mnx-viewer build
corepack pnpm --filter mnx-viewer test
```

The webview renders with the published `@viritura/score-viewer-react` and
`@viritura/score-engine` packages from npm, pinned in `package.json`. Their
WASM, fonts and OFL notices are staged from the installed engine package, so no
Rust toolchain is needed. For an unpackaged local build, run:

```bash
corepack pnpm --filter mnx-viewer prepare:assets
```

To try unreleased engine or viewer changes, temporarily point both pins at
`workspace:*`, run `corepack pnpm install`, `corepack pnpm wasm:build` and
`corepack pnpm build:npm-packages` (which fills the engine's `dist/` with the
WASM and fonts this script stages), and restore the pins before committing. Updating to a new release is a normal
dependency bump of both pins.

## Build a VSIX for local install

```bash
corepack pnpm build:vsix
```

The preserved package alias `corepack pnpm --filter mnx-viewer package` invokes
the same root coordinator. It uses Turbo for the extension host/webview and
prepared media outputs, then runs `vsce` as a consumer.

Then in VS Code use **Extensions: Install from VSIX...**.
