/**
 * Holds one Denigma WebAssembly instance for reuse across conversions.
 *
 * A failed conversion can leave the instance unusable: a stack overflow aborts
 * it, and an exhausted heap stays at its maximum size. Callers discard the
 * instance after a failure, so the next conversion loads a fresh one. A load
 * that fails is not cached either, so a later conversion retries it.
 */
export interface ModuleCache<T> {
  get(): Promise<T>;
  discard(): void;
}

export function createModuleCache<T>(load: () => Promise<T>): ModuleCache<T> {
  let pending: Promise<T> | undefined;
  return {
    get() {
      if (!pending) {
        const loading = load();
        pending = loading;
        loading.catch(() => {
          if (pending === loading) pending = undefined;
        });
      }
      return pending;
    },
    discard() {
      pending = undefined;
    },
  };
}
