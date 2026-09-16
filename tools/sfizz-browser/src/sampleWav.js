const riffHeaderBytes = 12;
const chunkHeaderBytes = 8;
const pcmFormat = 0x0001;
const ieeeFloatFormat = 0x0003;
const extensibleFormat = 0xfffe;
const pcmGuidSuffix = "00001000800000aa00389b71";
const supportedPcmBits = new Set([16, 24, 32]);
const supportedFloatBits = new Set([32]);

export function validateWavBytes(bytes, samplePath = "sample.wav") {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    return parseWav(view, samplePath);
  } catch (error) {
    if (error instanceof WavValidationError) {
      throw new Error(`${error.kind} WAV sample ${samplePath}: ${error.message}`);
    }
    throw error;
  }
}

function parseWav(bytes, samplePath) {
  if (bytes.byteLength < riffHeaderBytes) {
    throw new WavValidationError("Corrupt", "file is shorter than a RIFF/WAVE header");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WAVE") {
    throw new WavValidationError("Corrupt", "missing RIFF/WAVE signature");
  }
  const riffSize = view.getUint32(4, true);
  const riffEnd = riffSize + 8;
  if (riffEnd < riffHeaderBytes) {
    throw new WavValidationError("Corrupt", "RIFF size is shorter than the WAVE header");
  }
  if (riffSize + 8 > bytes.byteLength) {
    throw new WavValidationError("Corrupt", "RIFF size extends past the selected file");
  }

  let format = null;
  let dataBytes = 0;
  for (let offset = riffHeaderBytes; offset < riffEnd; ) {
    if (offset + chunkHeaderBytes > riffEnd) {
      throw new WavValidationError("Corrupt", "truncated chunk header");
    }
    const chunkId = readAscii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + chunkHeaderBytes;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > riffEnd) {
      throw new WavValidationError("Corrupt", `${chunkId.trim() || "unknown"} chunk extends past the file`);
    }
    if (chunkId === "fmt ") {
      format = parseFormatChunk(view, chunkStart, chunkSize);
    } else if (chunkId === "data") {
      dataBytes += chunkSize;
    }
    offset = chunkEnd + (chunkSize % 2);
    if (offset > riffEnd) {
      throw new WavValidationError("Corrupt", "missing chunk padding");
    }
  }

  if (!format) {
    throw new WavValidationError("Corrupt", "missing fmt chunk");
  }
  if (dataBytes === 0) {
    throw new WavValidationError("Corrupt", "missing non-empty data chunk");
  }
  validateFormat(format, dataBytes, samplePath);
  return { ...format, dataBytes };
}

function parseFormatChunk(view, offset, size) {
  if (size < 16) {
    throw new WavValidationError("Corrupt", "fmt chunk is shorter than 16 bytes");
  }
  const rawFormat = view.getUint16(offset, true);
  const channels = view.getUint16(offset + 2, true);
  const sampleRate = view.getUint32(offset + 4, true);
  const byteRate = view.getUint32(offset + 8, true);
  const blockAlign = view.getUint16(offset + 12, true);
  const bitsPerSample = view.getUint16(offset + 14, true);
  const format = rawFormat === extensibleFormat ? parseExtensibleFormat(view, offset, size) : rawFormat;
  return { bitsPerSample, blockAlign, byteRate, channels, format, sampleRate };
}

function parseExtensibleFormat(view, offset, size) {
  if (size < 40) {
    throw new WavValidationError("Corrupt", "WAVE_FORMAT_EXTENSIBLE fmt chunk is shorter than 40 bytes");
  }
  const validBits = view.getUint16(offset + 18, true);
  if (validBits === 0) {
    throw new WavValidationError("Corrupt", "WAVE_FORMAT_EXTENSIBLE has no valid-bit count");
  }
  const subtype = view.getUint32(offset + 24, true);
  const suffix = bytesToHex(view, offset + 28, 12);
  if (suffix !== pcmGuidSuffix) {
    throw new WavValidationError("Unsupported", "WAVE_FORMAT_EXTENSIBLE subtype GUID is not PCM/IEEE float");
  }
  return subtype;
}

function validateFormat(format, dataBytes, samplePath) {
  if (format.channels < 1 || format.channels > 2) {
    throw new WavValidationError("Unsupported", `${format.channels} channels are not supported by this prototype`);
  }
  if (format.sampleRate < 8000 || format.sampleRate > 192000) {
    throw new WavValidationError("Unsupported", `sample rate ${format.sampleRate} Hz is outside 8-192 kHz`);
  }
  if (!isSupportedSampleFormat(format.format, format.bitsPerSample)) {
    throw new WavValidationError(
      "Unsupported",
      `format ${format.format} with ${format.bitsPerSample}-bit samples is not accepted`,
    );
  }
  const expectedBlockAlign = (format.channels * format.bitsPerSample) / 8;
  if (!Number.isInteger(expectedBlockAlign) || format.blockAlign !== expectedBlockAlign) {
    throw new WavValidationError("Corrupt", "blockAlign does not match channel count and bit depth");
  }
  if (format.byteRate !== format.sampleRate * format.blockAlign) {
    throw new WavValidationError("Corrupt", "byteRate does not match sample rate and blockAlign");
  }
  if (dataBytes % format.blockAlign !== 0) {
    throw new WavValidationError("Corrupt", "data chunk size is not aligned to whole frames");
  }
  if (!samplePath.toLowerCase().endsWith(".wav")) {
    throw new WavValidationError("Unsupported", "sample path does not end with .wav");
  }
}

function isSupportedSampleFormat(format, bitsPerSample) {
  if (format === pcmFormat) {
    return supportedPcmBits.has(bitsPerSample);
  }
  if (format === ieeeFloatFormat) {
    return supportedFloatBits.has(bitsPerSample);
  }
  return false;
}

function readAscii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function bytesToHex(view, offset, length) {
  let hex = "";
  for (let index = 0; index < length; index += 1) {
    hex += view
      .getUint8(offset + index)
      .toString(16)
      .padStart(2, "0");
  }
  return hex;
}

class WavValidationError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}
