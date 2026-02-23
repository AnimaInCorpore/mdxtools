export function gcd(a, b) {
  let x = Math.abs(a | 0);
  let y = Math.abs(b | 0);
  if (x === 0) return y;
  if (y === 0) return x;
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

export function clampI16(v) {
  if (v > 32767) return 32767;
  if (v < -32768) return -32768;
  return v | 0;
}

export function toSigned16(v) {
  const x = v & 0xffff;
  return (x & 0x8000) ? (x - 0x10000) : x;
}

export function basename(path) {
  const p = String(path || "").replace(/\\/g, "/");
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.slice(idx + 1) : p;
}

export function dirname(path) {
  const p = String(path || "").replace(/\\/g, "/");
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.slice(0, idx) : "";
}

export function normalizeLookupName(path) {
  return basename(path).toLowerCase();
}

export function findPdxInFileIndex(mdxPath, pdxName, fileIndex) {
  if (!pdxName) return null;
  const direct = normalizeLookupName(pdxName);
  if (fileIndex.has(direct)) return fileIndex.get(direct);

  const withExt = normalizeLookupName(`${pdxName}.PDX`);
  if (fileIndex.has(withExt)) return fileIndex.get(withExt);

  const mdxDir = dirname(mdxPath);
  if (mdxDir) {
    const d0 = normalizeLookupName(`${mdxDir}/${pdxName}`);
    if (fileIndex.has(d0)) return fileIndex.get(d0);
    const d1 = normalizeLookupName(`${mdxDir}/${pdxName}.PDX`);
    if (fileIndex.has(d1)) return fileIndex.get(d1);
  }

  return null;
}

export function extractCString(bytes, start, endExclusive) {
  let i = start;
  while (i < endExclusive && bytes[i] !== 0) i += 1;
  return {
    value: new TextDecoder("ascii").decode(bytes.subarray(start, i)),
    end: i,
  };
}

export function decodeShiftJisFallback(bytes) {
  try {
    return new TextDecoder("shift-jis").decode(bytes);
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}

export function makeFileIndex(files) {
  const index = new Map();
  for (const file of files) {
    index.set(normalizeLookupName(file.name), file);
  }
  return index;
}

export function formatSeconds(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
