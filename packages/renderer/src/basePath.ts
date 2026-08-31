let assetBasePathOverride: string | null = null;

/**
 * Override the static asset base used by renderer consumers that cannot rely
 * on a normal web root, such as VS Code webviews.
 */
export function setAssetBasePath(basePath: string | null): void {
  if (!basePath) {
    assetBasePathOverride = null;
    return;
  }

  assetBasePathOverride = basePath.endsWith("/") ? basePath : `${basePath}/`;
}

/**
 * Resolve the base URL path for fetching static assets (WASM, fonts, scores).
 *
 * Priority:
 *  1. Explicit override set by embedding hosts such as VS Code webviews
 *  2. HTML <base> tag (set by Storybook / Vite when using a subpath)
 *  3. Vite's import.meta.env.BASE_URL (set at build time)
 *  4. Fallback to "/"
 *
 * Always returns a path ending with "/".
 */
export function resolveBasePath(): string {
  if (assetBasePathOverride) {
    return assetBasePathOverride;
  }

  // 1. Check for <base href="..."> tag
  if (typeof document !== "undefined") {
    const baseEl = document.querySelector("base");
    if (baseEl) {
      const href = baseEl.getAttribute("href");
      if (href) {
        try {
          const base = new URL(href, window.location.origin).pathname;
          return base.endsWith("/") ? base : base + "/";
        } catch {
          // ignore malformed base href
        }
      }
    }
  }

  // 2. Vite injects BASE_URL at build time
  try {
    const viteBase = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL;
    if (viteBase) {
      return viteBase.endsWith("/") ? viteBase : viteBase + "/";
    }
  } catch {
    // import.meta.env may not exist outside Vite
  }

  // 3. Default
  return "/";
}
