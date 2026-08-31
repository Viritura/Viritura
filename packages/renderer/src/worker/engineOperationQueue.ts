/**
 * Serializes access to the single retained WASM LayoutEngine instance.
 *
 * Comlink may dispatch another RPC before a caller has finished consuming the
 * previous result. wasm-bindgen rejects overlapping borrows of the same Rust
 * object, so every retained-engine operation (including read-only metrics)
 * passes through this queue.
 */
export class EngineOperationQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
