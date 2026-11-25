// Gists hold text only, so large MNX files are stored as base64-encoded gzip.
// Anyone can recover the MNX with `base64 -d file.mnx.gz.b64 | gunzip`.
export const COMPRESSED_MNX_SUFFIX = ".gz.b64";

const BASE64_CHUNK_BYTES = 0x8000;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export function isCompressedMnxName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(`.mnx${COMPRESSED_MNX_SUFFIX}`);
}

export function isGistMnxName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".mnx") || isCompressedMnxName(fileName);
}

export function mnxNameFromGistName(fileName: string): string {
  return isCompressedMnxName(fileName) ? fileName.slice(0, -COMPRESSED_MNX_SUFFIX.length) : fileName;
}

export async function compressMnx(mnx: string): Promise<string> {
  const stream = new Blob([mnx]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return bytesToBase64(bytes);
}

export async function decompressMnx(
  encoded: string,
  maxBytes: number,
  label: string,
  limitMessage: string,
): Promise<string> {
  const compact = encoded.replace(/\s+/g, "");
  if (compact.length % 4 !== 0 || !BASE64_PATTERN.test(compact)) {
    throw new Error(`${label} is not valid compressed MNX.`);
  }

  const reader = new Blob([base64ToBytes(compact)]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteCount = 0;
  let result = "";
  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
      if (chunk.done) return result + decoder.decode();
      result += decoder.decode(chunk.value, { stream: true });
    } catch {
      throw new Error(`${label} is not valid compressed MNX.`);
    }
    byteCount += chunk.value.byteLength;
    if (byteCount > maxBytes) {
      await reader.cancel();
      throw new Error(limitMessage);
    }
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES));
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array<ArrayBuffer> {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
