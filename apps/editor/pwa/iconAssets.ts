import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";

export function stagePwaIcons(brandingRoot: string, publicRoot: string): void {
  const source = readFileSync(resolve(brandingRoot, "favicon.svg"), "utf8");
  const output = resolve(publicRoot, "pwa-icons");
  mkdirSync(output, { recursive: true });
  const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect width="64" height="64" fill="#215e4e"/>
    ${source.replace("<svg ", '<svg x="12" y="12" width="40" height="40" ')}
  </svg>`;
  for (const [name, size, svg] of [
    ["icon-192.png", 192, source],
    ["icon-512.png", 512, source],
    ["apple-touch-icon.png", 180, source],
    ["maskable-512.png", 512, maskable],
  ] as const) {
    const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
    writeFileSync(resolve(output, name), png);
  }
}
