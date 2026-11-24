/** Decoded PCM channels. */
export interface DecodedWav {
  sampleRate: number;
  channels: Float32Array[];
}

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

function tag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/** Decodes 16/24/32-bit integer or 32-bit float RIFF WAVE data. */
export function decodeWav(bytes: ArrayBuffer): DecodedWav {
  const view = new DataView(bytes);
  if (view.byteLength < 12 || tag(view, 0) !== "RIFF" || tag(view, 8) !== "WAVE") {
    throw new Error("Not a WAV file.");
  }
  let format = 0;
  let channelCount = 0;
  let sampleRate = 0;
  let bits = 0;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = tag(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channelCount = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      if (format === FORMAT_EXTENSIBLE && size >= 26) format = view.getUint16(body + 24, true);
    } else if (id === "data") {
      if (channelCount === 0) throw new Error("WAV data chunk precedes its format chunk.");
      const bytesPerSample = bits / 8;
      const end = Math.min(view.byteLength, body + size);
      const frames = Math.floor((end - body) / (bytesPerSample * channelCount));
      const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
      const read = sampleReader(view, format, bits);
      let position = body;
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channelCount; c++) {
          channels[c]![i] = read(position);
          position += bytesPerSample;
        }
      }
      return { sampleRate, channels };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV file has no data chunk.");
}

function sampleReader(view: DataView, format: number, bits: number): (offset: number) => number {
  if (format === FORMAT_FLOAT && bits === 32) return (o) => view.getFloat32(o, true);
  if (format === FORMAT_PCM && bits === 16) return (o) => view.getInt16(o, true) / 0x8000;
  if (format === FORMAT_PCM && bits === 24) {
    return (o) => (view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getInt8(o + 2) << 16)) / 0x800000;
  }
  if (format === FORMAT_PCM && bits === 32) return (o) => view.getInt32(o, true) / 0x80000000;
  throw new Error(`Unsupported WAV encoding (format ${format}, ${bits}-bit).`);
}

/** Linearly resamples channels to a new rate. */
export function resampleChannels(channels: Float32Array[], from: number, to: number): Float32Array[] {
  if (from === to) return channels;
  const ratio = from / to;
  return channels.map((input) => {
    const length = Math.max(1, Math.round(input.length / ratio));
    const output = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const position = i * ratio;
      const index = Math.floor(position);
      const a = input[index] ?? 0;
      const b = input[index + 1] ?? 0;
      output[i] = a + (b - a) * (position - index);
    }
    return output;
  });
}
