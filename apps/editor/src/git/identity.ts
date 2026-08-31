/**
 * Git author identity persisted in localStorage.
 *
 * Existing user-provided identities are retained for compatibility. New
 * installations use the anonymous local identity until identity management
 * is exposed through settings.
 */

const STORAGE_KEY = "viritura.git.identity.v1";

export interface GitIdentity {
  name: string;
  email: string;
}

interface StoredIdentity {
  /** True if the user filled in non-empty values. */
  provided: boolean;
  name?: string;
  email?: string;
}

const ANONYMOUS: GitIdentity = { name: "local", email: "local@viritura.app" };

function read(): StoredIdentity {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { provided: false };
    const parsed = JSON.parse(raw) as StoredIdentity;
    return parsed ?? { provided: false };
  } catch {
    return { provided: false };
  }
}

/** Returns the identity that should be used for new commits. */
export function getIdentity(): GitIdentity {
  const s = read();
  if (s.provided && s.name && s.email) {
    return { name: s.name, email: s.email };
  }
  return ANONYMOUS;
}

/** Test/dev helper: clear the stored identity. */
export function _clearIdentityForTesting(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
