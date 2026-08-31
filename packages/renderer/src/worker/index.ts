/**
 * @viritura/renderer worker layer — off-main-thread WASM layout.
 *
 * Public surface: the main-thread {@link createLayoutService} factory and its
 * async types. The worker entry (`layout.worker.ts`) is not re-exported; it is
 * instantiated internally by the service via `new Worker(new URL(...))`.
 */

export { createLayoutService } from "./layoutService";
export type { LayoutService, AsyncCachedLayoutEngine } from "./layoutService";
export type { LayoutWorkerApi } from "./layoutWorkerApi";
