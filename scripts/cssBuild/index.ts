// Lightning CSS drops unprefixed backdrop-filter with var() when a prefixed
// declaration follows it. Keep PostCSS/Autoprefixer output intact.
export const cssBuildOptions = { cssMinify: "esbuild" as const };
