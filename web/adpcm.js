const STEP_SIZE = new Int16Array([
  16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41,
  45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173,
  190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658,
  724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552,
]);

const STEP_ADJUST = new Int8Array([-1, -1, -1, -1, 2, 4, 6, 8]);

export function adpcmInit(status) {
  status.last = 0;
  status.stepIndex = 0;
}

export function adpcmDecode(code, status) {
  const c = code & 0x0f;
  const ss = STEP_SIZE[status.stepIndex];
  let e = ss >> 3;
  if (c & 0x01) e += ss >> 2;
  if (c & 0x02) e += ss >> 1;
  if (c & 0x04) e += ss;

  const diff = (c & 0x08) ? -e : e;
  let samp = status.last + diff;

  if (samp > 2047) samp = 2047;
  if (samp < -2048) samp = -2048;

  status.last = samp;
  status.stepIndex += STEP_ADJUST[c & 0x07];
  if (status.stepIndex < 0) status.stepIndex = 0;
  if (status.stepIndex > 48) status.stepIndex = 48;

  return samp;
}

export function adpcmEncode(sample, status) {
  let code = 0;
  const ss = STEP_SIZE[status.stepIndex];
  let diff = sample - status.last;
  if (diff < 0) {
    code = 0x08;
    diff = -diff;
  }
  if (diff >= ss) {
    code |= 0x04;
    diff -= ss;
  }
  if (diff >= (ss >> 1)) {
    code |= 0x02;
    diff -= (ss >> 1);
  }
  if (diff >= (ss >> 2)) {
    code |= 0x01;
  }
  status.last = adpcmDecode(code, status);
  return code;
}

export function decodeAdpcmBytes(data) {
  const st = { last: 0, stepIndex: 0 };
  adpcmInit(st);
  const out = new Int16Array(data.length * 2);
  let w = 0;
  for (let i = 0; i < data.length; i += 1) {
    const c = data[i];
    out[w++] = adpcmDecode(c & 0x0f, st);
    out[w++] = adpcmDecode((c >> 4) & 0x0f, st);
  }
  return out;
}
