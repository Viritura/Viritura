import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { MAX_ARCHIVE_ENTRIES, validateDecodedScoreDat, validateMusxArchive } from "./archiveLimits";

const encoder = new TextEncoder();

function encodeScoreDat(expandedSize: number): Uint8Array {
  const decoded = new Uint8Array(gzipSync(new Uint8Array(expandedSize)));

  const encoded = new Uint8Array(decoded.byteLength);
  let state = 0x28006d45;
  for (let index = 0; index < decoded.byteLength; index += 1) {
    if (index % 0x20000 === 0) state = 0x28006d45;
    state = (Math.imul(state, 0x41c64e6d) + 0x3039) >>> 0;
    const upper = state >>> 16;
    const mask = (upper + Math.floor(upper / 255)) & 0xff;
    encoded[index] = decoded[index]! ^ mask;
  }
  return encoded;
}

function storedZipEntry(payload: Uint8Array, declaredSize = payload.byteLength): Uint8Array {
  const name = encoder.encode("score.dat");
  const localSize = 30 + name.byteLength + payload.byteLength;
  const centralSize = 46 + name.byteLength;
  const bytes = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, 0x04034b50, true);
  view.setUint16(8, 0, true);
  view.setUint32(18, payload.byteLength, true);
  view.setUint32(22, declaredSize, true);
  view.setUint16(26, name.byteLength, true);
  bytes.set(name, 30);
  bytes.set(payload, 30 + name.byteLength);

  const central = localSize;
  view.setUint32(central, 0x02014b50, true);
  view.setUint16(central + 10, 0, true);
  view.setUint32(central + 20, payload.byteLength, true);
  view.setUint32(central + 24, declaredSize, true);
  view.setUint16(central + 28, name.byteLength, true);
  view.setUint32(central + 42, 0, true);
  bytes.set(name, central + 46);

  const end = central + centralSize;
  view.setUint32(end, 0x06054b50, true);
  view.setUint16(end + 8, 1, true);
  view.setUint16(end + 10, 1, true);
  view.setUint32(end + 12, centralSize, true);
  view.setUint32(end + 16, central, true);
  return bytes;
}

describe("validateMusxArchive", () => {
  it("accepts a bounded MUSX archive with stored encoded score data", async () => {
    await expect(validateMusxArchive(storedZipEntry(encodeScoreDat(1_024)))).resolves.toBeUndefined();
  });

  it("rejects excessive nested score expansion", async () => {
    await expect(validateDecodedScoreDat(encodeScoreDat(1_024), 512)).rejects.toThrow("decoded Finale score exceeds");
  });

  it("rejects excessive archive entry counts before reading entries", async () => {
    const bytes = storedZipEntry(encodeScoreDat(1_024));
    const end = bytes.byteLength - 22;
    new DataView(bytes.buffer).setUint16(end + 10, MAX_ARCHIVE_ENTRIES + 1, true);
    await expect(validateMusxArchive(bytes)).rejects.toThrow("more than");
  });

  it("rejects outer archive expansion ratios above the limit", async () => {
    await expect(validateMusxArchive(storedZipEntry(encodeScoreDat(1_024), 10_000))).rejects.toThrow("expansion-ratio");
  });

  it("rejects prefixed ZIP archives whose offsets differ from Minizip interpretation", async () => {
    const archive = storedZipEntry(encodeScoreDat(1_024));
    const prefixed = new Uint8Array(archive.byteLength + 4);
    prefixed.set(archive, 4);

    await expect(validateMusxArchive(prefixed)).rejects.toThrow("prefixed or misaligned");
  });
});
