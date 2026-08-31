/**
 * Returns true if `dir` directly contains a child entry of the given
 * `name` (file or directory). Uses the FSA `getDirectoryHandle` /
 * `getFileHandle` lookups (O(1) name resolution) and falls back to a key
 * scan if the implementation refuses both. Cheap enough to call on every
 * folder open to detect `.git`.
 */
export async function directoryHasEntry(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  // Fast path: a `.git` is always a directory in our use case, but try the
  // file form too in case callers ask about a file marker (e.g. `.mnx`).
  try {
    await dir.getDirectoryHandle(name);
    return true;
  } catch (err) {
    if ((err as DOMException)?.name !== "NotFoundError" && (err as DOMException)?.name !== "TypeMismatchError") {
      // Permission errors etc. — don't pretend it's missing.
      return false;
    }
  }
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}
