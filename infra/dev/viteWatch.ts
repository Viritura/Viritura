/**
 * Watch settings for a bind-mounted dev container.
 *
 * Bind mounts from a Windows or macOS host do not deliver inotify events into a
 * Linux container, so Vite's default watcher never fires and edits look like
 * they were ignored. Polling is the only thing that sees them.
 *
 * Polling is not free, and left unscoped it is *ruinous*: chokidar walks and
 * `stat`s every path under the root on every interval. Measured on this repo
 * that burned 32% of a core at idle and dropped Vite's own static file serving
 * from 7 MB/s to 0.19 MB/s — a 37x regression that made the 124 MB soundfont
 * effectively unloadable and left the transport spinning forever. The dev
 * server is single-threaded, so a saturated event loop slows *everything*:
 * module graph requests, HMR, and assets alike.
 *
 * So the rule is: poll only what a human edits. Everything below is either
 * generated, vendored, or enormous, and none of it needs a watcher.
 */
export const CONTAINER_WATCH_IGNORED = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/target/**",
  "**/.turbo/**",
  "**/storybook-static/**",
  "**/coverage/**",
  // Static assets: hundreds of megabytes of soundfont, staged scores and
  // reference images that change only when a build writes them. Keep
  // public/wasm watched so the Docker Rust watcher can trigger a browser reload
  // after rebuilding.
  "**/public/articulations/**",
  "**/public/fonts/**",
  "**/public/reference-images/**",
  "**/public/scores/**",
  "**/public/sounds/**",
  "**/*.sf2",
];

/**
 * Polling interval.
 *
 * Measured on this repo, idle CPU and throughput trade off sharply against it:
 *
 * | interval | idle CPU | static throughput |
 * | -------- | -------- | ----------------- |
 * | 300 ms   | 32%      | 1.9 MB/s          |
 * | 1000 ms  | 11%      | 25 MB/s           |
 * | 2000 ms  | 4%       | 22 MB/s           |
 *
 * Throughput is already saturated at 1 s, so paying 2 s of HMR latency buys
 * nothing a developer can feel. 1 s it is.
 */
export const CONTAINER_WATCH_INTERVAL = 1000;

/**
 * Vite `server.watch` for a container run, or `undefined` on the host.
 *
 * Host runs keep native watching, which is both faster and cheaper.
 */
export function containerWatchOptions(containerHost: string | undefined) {
  if (!containerHost) return undefined;
  return {
    usePolling: true,
    interval: CONTAINER_WATCH_INTERVAL,
    ignored: CONTAINER_WATCH_IGNORED,
  };
}
