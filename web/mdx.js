import { decodeShiftJisFallback } from "./tools.js";

export const MDX_SUCCESS = 0;
export const MDX_ERR_BAD_TITLE = 1;
export const MDX_ERR_BAD_PCM_FILENAME = 2;
export const MDX_ERR_LZX = 3;

export function mdxCmdLen(data, pos, len) {
  if (len <= 0) return -1;
  const c = data[pos];
  if (c <= 0x7f) return 1;
  if (c <= 0xdf) return 2;

  if (c === 0xea || c === 0xeb || c === 0xec) {
    if (len < 2) return -1;
    const n = data[pos + 1];
    if (n === 0x80 || n === 0x81) return 2;
    if (len < 6) return -1;
    return 6;
  }

  switch (c) {
    case 0xfe:
    case 0xf6:
    case 0xf5:
    case 0xf4:
    case 0xf3:
    case 0xf2:
    case 0xf1:
    case 0xe7:
      return 3;
    case 0xff:
    case 0xfd:
    case 0xfc:
    case 0xfb:
    case 0xf8:
    case 0xf0:
    case 0xef:
    case 0xed:
    case 0xe9:
      return 2;
    default:
      return 1;
  }
}

export function mdxFileLoad(data) {
  if (!(data instanceof Uint8Array)) {
    throw new TypeError("mdxFileLoad expects Uint8Array");
  }

  const len = data.length;
  const file = {
    dataStartOfs: 0,
    title: "",
    titleBytes: null,
    pdxFilename: "",
    pdxFilenameBytes: null,
    data,
    dataLen: len,
    voices: new Array(256).fill(null),
    numVoices: 0,
    tracks: new Array(16).fill(null).map(() => ({ data: new Uint8Array(0), dataLen: 0, pos: 0 })),
    numTracks: 0,
  };

  let i = 2;
  let foundTitle = false;
  for (; i < len; i += 1) {
    if (data[i] === 0x1a && data[i - 1] === 0x0a && data[i - 2] === 0x0d) {
      const titleEnd = i - 2;
      file.titleBytes = data.subarray(0, titleEnd);
      file.title = decodeShiftJisFallback(file.titleBytes);
      i += 1;
      foundTitle = true;
      break;
    }
  }
  if (!foundTitle) {
    return { err: MDX_ERR_BAD_TITLE, file: null };
  }

  const pdxStart = i;
  let foundPdx = false;
  for (; i < len; i += 1) {
    if (data[i] === 0x00) {
      file.pdxFilenameBytes = data.subarray(pdxStart, i);
      file.pdxFilename = new TextDecoder("ascii").decode(file.pdxFilenameBytes);
      i += 1;
      foundPdx = true;
      break;
    }
  }
  if (!foundPdx) {
    return { err: MDX_ERR_BAD_PCM_FILENAME, file: null };
  }

  const offsetStart = i;
  file.dataStartOfs = offsetStart;

  if (
    offsetStart + 6 < len &&
    data[offsetStart + 4] === 0x4c &&
    data[offsetStart + 5] === 0x5a &&
    data[offsetStart + 6] === 0x58
  ) {
    return { err: MDX_ERR_LZX, file: null };
  }

  const chunks = new Array(17).fill(null).map(() => ({ offset: 0, len: 0 }));
  let minOfs = len - offsetStart;

  for (let c = 0; c < 17; c += 1) {
    const p = offsetStart + c * 2;
    if (p + 1 >= len) {
      chunks[c].offset = 0;
      chunks[c].len = 0;
      continue;
    }
    const ofs = (data[p] << 8) | data[p + 1];
    chunks[c].offset = ofs;
    if (ofs + offsetStart >= len) {
      chunks[c].len = 0;
    } else {
      chunks[c].len = len - offsetStart - ofs;
      if (c < 10 && ofs < minOfs) minOfs = ofs;
    }
  }

  file.numTracks = Math.floor((minOfs - 2) / 2);
  if (file.numTracks > 16) file.numTracks = 16;
  if (file.numTracks < 0) file.numTracks = 0;

  for (let c = 0; c < 17; c += 1) {
    if (!chunks[c].len) continue;
    if (c > file.numTracks + 1) {
      chunks[c].len = 0;
      continue;
    }
    for (let j = 0; j <= file.numTracks; j += 1) {
      if (!chunks[j].len) continue;
      if (
        chunks[c].offset < chunks[j].offset &&
        chunks[c].len > chunks[j].offset - chunks[c].offset
      ) {
        chunks[c].len = chunks[j].offset - chunks[c].offset;
      }
    }
  }

  for (let c = 0; c <= file.numTracks; c += 1) {
    if (!chunks[c].len) continue;
    for (let j = 0; j <= file.numTracks; j += 1) {
      if (!chunks[j].len) continue;
      if (
        chunks[c].offset > chunks[j].offset &&
        chunks[c].offset < chunks[j].offset + chunks[j].len
      ) {
        chunks[c].len = 0;
      }
    }
  }

  const voiceDataOffset = offsetStart + chunks[0].offset;
  const voiceDataLen = chunks[0].len;

  for (let t = 0; t < file.numTracks; t += 1) {
    const chunk = chunks[t + 1];
    const s = offsetStart + chunk.offset;
    const e = s + chunk.len;
    file.tracks[t] = {
      data: data.subarray(s, e),
      dataLen: chunk.len,
      pos: 0,
    };
  }

  file.numVoices = Math.floor(voiceDataLen / 27);
  for (let v = 0; v < file.numVoices; v += 1) {
    const base = voiceDataOffset + v * 27;
    if (base + 27 > len) break;
    const voiceId = data[base];
    file.voices[voiceId] = data.subarray(base, base + 27);
  }

  return { err: MDX_SUCCESS, file };
}

export function mdxErrorName(err) {
  const names = [
    "Success",
    "MDX title does not end before EOF",
    "PDX ending zero not found before EOF",
    "File is LZX compressed",
  ];
  return names[err] || "Unknown";
}

const NOTE_NAMES = ["c", "c+", "d", "d+", "e", "f", "f+", "g", "g+", "a", "a+", "b"];

export function mdxNoteName(note) {
  return NOTE_NAMES[(note + 3) % 12];
}

export function mdxNoteOctave(note) {
  return Math.floor((note + 3) / 12);
}

export function mdxVoiceGetId(v) { return v[0]; }
export function mdxVoiceGetFl(v) { return (v[1] >> 3) & 0x07; }
export function mdxVoiceGetCon(v) { return v[1] & 0x07; }
export function mdxVoiceGetSlotMask(v) { return v[2] & 0x0f; }
export function mdxVoiceOscGetDt1(v, osc) { return (v[3 + osc] >> 4) & 0x07; }
export function mdxVoiceOscGetMul(v, osc) { return v[3 + osc] & 0x0f; }
export function mdxVoiceOscGetTl(v, osc) { return v[7 + osc] & 0x7f; }
export function mdxVoiceOscGetKs(v, osc) { return v[11 + osc] >> 6; }
export function mdxVoiceOscGetAr(v, osc) { return v[11 + osc] & 0x1f; }
export function mdxVoiceOscGetAme(v, osc) { return v[15 + osc] >> 7; }
export function mdxVoiceOscGetD1r(v, osc) { return v[15 + osc] & 0x1f; }
export function mdxVoiceOscGetDt2(v, osc) { return v[19 + osc] >> 6; }
export function mdxVoiceOscGetD2r(v, osc) { return v[19 + osc] & 0x1f; }
export function mdxVoiceOscGetD1l(v, osc) { return v[23 + osc] >> 4; }
export function mdxVoiceOscGetRr(v, osc) { return v[23 + osc] & 0x0f; }
