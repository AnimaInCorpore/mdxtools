import { decodeAdpcmBytes } from "./adpcm.js";

export const PDX_NUM_SAMPLES = 96;

export function pdxFileLoad(data) {
  if (!(data instanceof Uint8Array) || data.length === 0) {
    return { err: -1, file: null };
  }

  const file = {
    samples: new Array(PDX_NUM_SAMPLES).fill(null).map(() => ({
      data: null,
      len: 0,
      decodedData: null,
      numSamples: 0,
    })),
    numSamples: PDX_NUM_SAMPLES,
  };

  const len = data.length;

  for (let i = 0; i < PDX_NUM_SAMPLES; i += 1) {
    const base = i * 8;
    if (base + 7 >= len) break;

    const ofs =
      (data[base] << 24) |
      (data[base + 1] << 16) |
      (data[base + 2] << 8) |
      data[base + 3];
    const sampleLen =
      (data[base + 4] << 24) |
      (data[base + 5] << 16) |
      (data[base + 6] << 8) |
      data[base + 7];

    if (ofs >= 0 && ofs < len && ofs + sampleLen <= len) {
      const sampleBytes = data.subarray(ofs, ofs + sampleLen);
      const decoded = decodeAdpcmBytes(sampleBytes);
      file.samples[i] = {
        data: sampleBytes,
        len: sampleLen,
        decodedData: decoded,
        numSamples: decoded.length,
      };
    }
  }

  return { err: 0, file };
}
