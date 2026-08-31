/**
 * Room id helpers — used by the editor to mint share-link slugs and parse
 * incoming <c>?live=</c> URL parameters.
 *
 * Rules:
 *  - URL-safe ASCII (no encoding needed): a-z, 0-9, dash.
 *  - 16 chars of base32-style entropy ≈ 80 bits, which is well above the
 *    "guessable" floor for a non-listed ephemeral session.
 *  - Lowercase only — case-insensitive so paste-from-Notes-app doesn't break.
 */

const ROOM_ID_LENGTH = 16;
const ROOM_ID_CHARSET = "abcdefghijkmnpqrstuvwxyz23456789"; // crockford base32-ish, omits look-alikes
const ROOM_ID_PATTERN = /^[a-z2-9]{16}$/;

/**
 * Generate a fresh random room id. Uses <c>crypto.getRandomValues</c> for
 * unbiased sampling.
 */
export function generateRoomId(): string {
  const bytes = new Uint8Array(ROOM_ID_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < ROOM_ID_LENGTH; i++) {
    out += ROOM_ID_CHARSET[bytes[i]! % ROOM_ID_CHARSET.length];
  }
  return out;
}

/**
 * Return <c>true</c> iff <c>candidate</c> matches the room id format. The
 * editor's URL parser uses this to reject malformed <c>?live=</c> values
 * without trying to join a hostile signaling room.
 */
export function isValidRoomId(candidate: string): boolean {
  return ROOM_ID_PATTERN.test(candidate);
}
