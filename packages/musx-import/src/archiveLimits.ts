const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const ZIP64_U16 = 0xffff;
const ZIP64_U32 = 0xffffffff;

export const MAX_MUSX_BYTES = 64 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 2_048;
const MAX_ARCHIVE_EXPANDED_BYTES = 192 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_EXPANSION_RATIO = 200;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  expandedSize: number;
  localHeaderOffset: number;
}

function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView): number {
  if (bytes.byteLength < 22) throw new Error("The MUSX file is not a supported ZIP archive.");
  const minimumOffset = Math.max(0, bytes.byteLength - (ZIP64_U16 + 22));
  for (let offset = bytes.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === bytes.byteLength) return offset;
  }
  throw new Error("The MUSX file is not a supported ZIP archive.");
}

function readCentralDirectory(bytes: Uint8Array, view: DataView): ZipEntry[] {
  const endOffset = findEndOfCentralDirectory(bytes, view);
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (entryCount === ZIP64_U16 || centralSize === ZIP64_U32 || centralOffset === ZIP64_U32) {
    throw new Error("ZIP64 MUSX archives are not accepted.");
  }
  if (entryCount > MAX_ARCHIVE_ENTRIES) {
    throw new Error(`The MUSX archive contains more than ${MAX_ARCHIVE_ENTRIES} entries.`);
  }
  if (centralOffset + centralSize !== endOffset) {
    throw new Error("The MUSX archive has a prefixed or misaligned central directory.");
  }

  const entries: ZipEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new Error("The MUSX central directory contains an invalid entry.");
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const expandedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    if (
      compressedSize === ZIP64_U32 ||
      expandedSize === ZIP64_U32 ||
      localHeaderOffset === ZIP64_U32 ||
      offset + 46 + nameLength + extraLength + commentLength > bytes.byteLength
    ) {
      throw new Error("The MUSX archive uses unsupported ZIP64 or invalid entry metadata.");
    }
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.push({ name, method, compressedSize, expandedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function compressedEntryBytes(bytes: Uint8Array, view: DataView, entry: ZipEntry): Uint8Array {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > bytes.byteLength || view.getUint32(offset, true) !== LOCAL_FILE_HEADER) {
    throw new Error("The MUSX score.dat local header is invalid.");
  }
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  if (dataEnd > bytes.byteLength || entry.compressedSize < 18) {
    throw new Error("The MUSX score.dat payload is invalid.");
  }
  return bytes.subarray(dataOffset, dataEnd);
}

async function readScoreDat(bytes: Uint8Array, view: DataView, entry: ZipEntry): Promise<Uint8Array> {
  const compressed = compressedEntryBytes(bytes, view, entry);
  if (entry.method === 0) {
    if (compressed.byteLength !== entry.expandedSize) {
      throw new Error("The stored MUSX score.dat size does not match its directory entry.");
    }
    return compressed;
  }
  if (entry.method !== 8) throw new Error(`The MUSX score.dat compression method ${entry.method} is unsupported.`);

  const stream = new Blob([Uint8Array.from(compressed)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const output = new Uint8Array(entry.expandedSize);
  let offset = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (offset + value.byteLength > output.byteLength) {
      await reader.cancel();
      throw new Error("The MUSX score.dat data exceeds its declared expanded size.");
    }
    output.set(value, offset);
    offset += value.byteLength;
  }
  if (offset !== output.byteLength) {
    throw new Error("The MUSX score.dat data does not match its declared expanded size.");
  }
  return output;
}

function decodeScoreDat(scoreDat: Uint8Array): Uint8Array {
  let state = 0x28006d45;
  const decoded = new Uint8Array(scoreDat.byteLength);
  for (let index = 0; index < scoreDat.byteLength; index += 1) {
    if (index % 0x20000 === 0) state = 0x28006d45;
    state = (Math.imul(state, 0x41c64e6d) + 0x3039) >>> 0;
    const upper = state >>> 16;
    const mask = (upper + Math.floor(upper / 255)) & 0xff;
    decoded[index] = scoreDat[index]! ^ mask;
  }
  if (decoded[0] !== 0x1f || decoded[1] !== 0x8b) {
    throw new Error("The MUSX score.dat payload is not an encoded gzip stream.");
  }
  return decoded;
}

export async function validateDecodedScoreDat(
  scoreDat: Uint8Array,
  maxDecodedBytes = MAX_ARCHIVE_ENTRY_BYTES,
): Promise<number> {
  const decoded = decodeScoreDat(scoreDat);
  let stream: ReadableStream<Uint8Array>;
  try {
    const blobBytes = new Uint8Array(decoded.byteLength);
    blobBytes.set(decoded);
    stream = new Blob([blobBytes.buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  } catch {
    throw new Error("The MUSX score.dat gzip stream is invalid.");
  }

  const reader = stream.getReader();
  let expandedSize = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      expandedSize += value.byteLength;
      if (expandedSize > maxDecodedBytes) {
        await reader.cancel();
        throw new Error("The decoded Finale score exceeds the 128 MiB safety limit.");
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("safety limit")) throw error;
    throw new Error("The MUSX score.dat gzip stream is invalid.");
  }
  assertExpansionRatio(expandedSize, scoreDat.byteLength, "The decoded Finale score");
  return expandedSize;
}

function assertExpansionRatio(expandedSize: number, compressedSize: number, label: string): void {
  if (expandedSize > 0 && (compressedSize === 0 || expandedSize / compressedSize > MAX_EXPANSION_RATIO)) {
    throw new Error(`${label} exceeds the ${MAX_EXPANSION_RATIO}:1 expansion-ratio limit.`);
  }
}

export async function validateMusxArchive(bytes: Uint8Array): Promise<void> {
  if (bytes.byteLength > MAX_MUSX_BYTES) {
    throw new Error("MUSX input exceeds the 64 MiB safety limit.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = readCentralDirectory(bytes, view);
  let totalExpandedBytes = 0;
  for (const entry of entries) {
    if (entry.expandedSize > MAX_ARCHIVE_ENTRY_BYTES) {
      throw new Error(`MUSX entry "${entry.name}" exceeds the 128 MiB expanded-size limit.`);
    }
    assertExpansionRatio(entry.expandedSize, entry.compressedSize, `MUSX entry "${entry.name}"`);
    totalExpandedBytes += entry.expandedSize;
    if (totalExpandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) {
      throw new Error("The MUSX archive exceeds the 192 MiB cumulative expanded-size limit.");
    }
  }

  const scoreEntries = entries.filter((entry) => entry.name === "score.dat");
  if (scoreEntries.length !== 1) {
    throw new Error(`The MUSX archive must contain exactly one score.dat entry; found ${scoreEntries.length}.`);
  }
  await validateDecodedScoreDat(await readScoreDat(bytes, view, scoreEntries[0]!));
}
