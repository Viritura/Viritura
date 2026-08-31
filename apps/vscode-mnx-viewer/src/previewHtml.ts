function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export interface PreviewHtmlOptions {
  readonly scriptUri: string;
  readonly styleUri?: string;
  readonly assetBaseUri: string;
  readonly cspSource: string;
  readonly fileName: string;
}

function nonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function buildPreviewHtml({
  scriptUri,
  styleUri,
  assetBaseUri,
  cspSource,
  fileName,
}: PreviewHtmlOptions): string {
  const scriptNonce = nonce();
  const styleLink = styleUri ? `\n    <link rel="stylesheet" href="${escapeHtml(styleUri)}" />` : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${cspSource} data:; font-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}' blob: 'wasm-unsafe-eval'; connect-src ${cspSource};"
    />
    <title>MNX Preview: ${escapeHtml(fileName)}</title>
    ${styleLink}
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${scriptNonce}">
      window.__VIRITURA_MNX_VIEWER__ = {
        assetBaseUrl: ${scriptJson(assetBaseUri)},
        fileName: ${scriptJson(fileName)}
      };
    </script>
    <script nonce="${scriptNonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}
