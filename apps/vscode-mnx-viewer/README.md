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
- Bundles the WASM engine and SMuFL/text fonts into the VSIX for local/offline use.

## Local development

```bash
corepack pnpm --filter mnx-viewer build
corepack pnpm --filter mnx-viewer test
```

The webview stages fonts from `assets/fonts` and WASM from the canonical
`engine/viritura-wasm/pkg-browser` producer. For an unpackaged local build, run:

```bash
corepack pnpm wasm:build
corepack pnpm --filter mnx-viewer prepare:assets
```

## Build a VSIX for local install

```bash
corepack pnpm build:vsix
```

The preserved package alias `corepack pnpm --filter mnx-viewer package` invokes
the same root coordinator. It builds WASM once, uses Turbo for the extension
host/webview and prepared media outputs, then runs `vsce` as a consumer.

Then in VS Code use **Extensions: Install from VSIX...**.
