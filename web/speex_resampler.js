// Port of speex_resampler.c (fixed-point path) used by mdxplay.

export const SPEEX_RESAMPLER_QUALITY_MAX = 10;
export const SPEEX_RESAMPLER_QUALITY_MIN = 0;
export const SPEEX_RESAMPLER_QUALITY_DEFAULT = 4;
export const SPEEX_RESAMPLER_QUALITY_VOIP = 3;
export const SPEEX_RESAMPLER_QUALITY_DESKTOP = 5;

export const RESAMPLER_ERR_SUCCESS = 0;
export const RESAMPLER_ERR_ALLOC_FAILED = 1;
export const RESAMPLER_ERR_BAD_STATE = 2;
export const RESAMPLER_ERR_INVALID_ARG = 3;
export const RESAMPLER_ERR_PTR_OVERLAP = 4;
export const RESAMPLER_ERR_OVERFLOW = 5;

const FIXED_STACK_ALLOC = 1024;
const INT_MAX = 2147483647;
const UINT32_MAX = 0xffffffff;

const kaiser12_table = [
  0.99859849, 1.0, 0.99859849, 0.99440475, 0.98745105, 0.97779076,
  0.9654977, 0.95066529, 0.93340547, 0.91384741, 0.89213598, 0.86843014,
  0.84290116, 0.81573067, 0.78710866, 0.75723148, 0.7262997, 0.69451601,
  0.66208321, 0.62920216, 0.59606986, 0.56287762, 0.52980938, 0.49704014,
  0.46473455, 0.43304576, 0.40211431, 0.37206735, 0.343018, 0.3150649,
  0.28829195, 0.26276832, 0.23854851, 0.21567274, 0.19416736, 0.17404546,
  0.15530766, 0.13794294, 0.12192957, 0.10723616, 0.09382272, 0.08164178,
  0.0706395, 0.06075685, 0.05193064, 0.04409466, 0.03718069, 0.03111947,
  0.02584161, 0.02127838, 0.0173625, 0.01402878, 0.01121463, 0.00886058,
  0.00691064, 0.00531256, 0.00401805, 0.00298291, 0.00216702, 0.00153438,
  0.00105297, 0.00069463, 0.00043489, 0.00025272, 0.00013031, 0.0000527734,
  0.00001, 0.0,
];

const kaiser10_table = [
  0.99537781, 1.0, 0.99537781, 0.98162644, 0.95908712, 0.92831446,
  0.89005583, 0.84522401, 0.79486424, 0.74011713, 0.68217934, 0.62226347,
  0.56155915, 0.5011968, 0.44221549, 0.38553619, 0.33194107, 0.28205962,
  0.23636152, 0.19515633, 0.15859932, 0.1267028, 0.09935205, 0.07632451,
  0.05731132, 0.0419398, 0.02979584, 0.0204451, 0.01345224, 0.00839739,
  0.00488951, 0.00257636, 0.00115101, 0.00035515, 0.0, 0.0,
];

const kaiser8_table = [
  0.99635258, 1.0, 0.99635258, 0.98548012, 0.96759014, 0.943022,
  0.91223751, 0.87580811, 0.83439927, 0.78875245, 0.73966538, 0.68797126,
  0.6345175, 0.58014482, 0.52566725, 0.47185369, 0.4194115, 0.36897272,
  0.32108304, 0.27619388, 0.23465776, 0.1967267, 0.1625538, 0.13219758,
  0.10562887, 0.08273982, 0.06335451, 0.04724088, 0.03412321, 0.0236949,
  0.01563093, 0.00959968, 0.00527363, 0.00233883, 0.0005, 0.0,
];

const kaiser6_table = [
  0.99733006, 1.0, 0.99733006, 0.98935595, 0.97618418, 0.95799003,
  0.93501423, 0.90755855, 0.87598009, 0.84068475, 0.80211977, 0.76076565,
  0.71712752, 0.67172623, 0.62508937, 0.57774224, 0.53019925, 0.48295561,
  0.43647969, 0.39120616, 0.34752997, 0.30580127, 0.26632152, 0.22934058,
  0.19505503, 0.16360756, 0.13508755, 0.10953262, 0.0869312, 0.067226,
  0.0503182, 0.03607231, 0.02432151, 0.01487334, 0.00752, 0.0,
];

const KAISER12 = { table: kaiser12_table, oversample: 64 };
const KAISER10 = { table: kaiser10_table, oversample: 32 };
const KAISER8 = { table: kaiser8_table, oversample: 32 };
const KAISER6 = { table: kaiser6_table, oversample: 32 };

const quality_map = [
  { base_length: 8, oversample: 4, downsample_bandwidth: 0.83, upsample_bandwidth: 0.86, window_func: KAISER6 },
  { base_length: 16, oversample: 4, downsample_bandwidth: 0.85, upsample_bandwidth: 0.88, window_func: KAISER6 },
  { base_length: 32, oversample: 4, downsample_bandwidth: 0.882, upsample_bandwidth: 0.91, window_func: KAISER6 },
  { base_length: 48, oversample: 8, downsample_bandwidth: 0.895, upsample_bandwidth: 0.917, window_func: KAISER8 },
  { base_length: 64, oversample: 8, downsample_bandwidth: 0.921, upsample_bandwidth: 0.94, window_func: KAISER8 },
  { base_length: 80, oversample: 16, downsample_bandwidth: 0.922, upsample_bandwidth: 0.94, window_func: KAISER10 },
  { base_length: 96, oversample: 16, downsample_bandwidth: 0.94, upsample_bandwidth: 0.945, window_func: KAISER10 },
  { base_length: 128, oversample: 16, downsample_bandwidth: 0.95, upsample_bandwidth: 0.95, window_func: KAISER10 },
  { base_length: 160, oversample: 16, downsample_bandwidth: 0.96, upsample_bandwidth: 0.96, window_func: KAISER10 },
  { base_length: 192, oversample: 32, downsample_bandwidth: 0.968, upsample_bandwidth: 0.968, window_func: KAISER12 },
  { base_length: 256, oversample: 32, downsample_bandwidth: 0.975, upsample_bandwidth: 0.975, window_func: KAISER12 },
];

function word2int(x) {
  if (x < -32767) return -32768;
  if (x > 32766) return 32767;
  return x | 0;
}

function ashr(x, shift) {
  const d = 2 ** shift;
  if (x >= 0) return Math.floor(x / d);
  return -Math.ceil((-x) / d);
}

function pshr32(x, shift) {
  return ashr(x + ((1 << shift) >> 1), shift);
}

function saturate32pshr(x, shift, a) {
  const hi = a * (2 ** shift);
  if (x >= hi) return a;
  if (x <= -hi) return -a;
  return pshr32(x, shift);
}

function qconst16(x, bits) {
  return Math.trunc(0.5 + x * (2 ** bits));
}

function compute_func(x, func) {
  const y = x * func.oversample;
  const ind = Math.floor(y);
  const frac = y - ind;

  const interp3 = -0.1666666667 * frac + 0.1666666667 * frac * frac * frac;
  const interp2 = frac + 0.5 * frac * frac - 0.5 * frac * frac * frac;
  const interp0 = -0.3333333333 * frac + 0.5 * frac * frac - 0.1666666667 * frac * frac * frac;
  const interp1 = 1.0 - interp3 - interp2 - interp0;

  return (
    interp0 * func.table[ind] +
    interp1 * func.table[ind + 1] +
    interp2 * func.table[ind + 2] +
    interp3 * func.table[ind + 3]
  );
}

function sinc(cutoff, x, N, window_func) {
  const xx = x * cutoff;
  if (Math.abs(x) < 1e-6) {
    return word2int(Math.trunc(32768 * cutoff));
  }
  if (Math.abs(x) > 0.5 * N) {
    return 0;
  }

  const val = 32768 * cutoff * (Math.sin(Math.PI * xx) / (Math.PI * xx)) * compute_func(Math.abs((2 * x) / N), window_func);
  return word2int(Math.trunc(val));
}

function cubic_coef(x, interp) {
  const x2 = ashr(16384 + x * x, 15);
  const x3 = ashr(16384 + x * x2, 15);

  interp[0] = pshr32(qconst16(-0.16667, 15) * x + qconst16(0.16667, 15) * x3, 15);
  interp[1] = x + ashr(x2 - x3, 1);
  interp[3] = pshr32(qconst16(-0.33333, 15) * x + qconst16(0.5, 15) * x2 - qconst16(0.16667, 15) * x3, 15);
  interp[2] = 32767 - interp[0] - interp[1] - interp[3];
  if (interp[2] < 32767) interp[2] += 1;
}

function _muldiv(resultRef, value, mul, div) {
  const major = Math.floor(value / div);
  const remainder = value % div;
  if (
    remainder > Math.floor(UINT32_MAX / mul) ||
    major > Math.floor(UINT32_MAX / mul) ||
    major * mul > UINT32_MAX - Math.floor((remainder * mul) / div)
  ) {
    return RESAMPLER_ERR_OVERFLOW;
  }
  resultRef.value = Math.floor((remainder * mul) / div) + major * mul;
  return RESAMPLER_ERR_SUCCESS;
}

function gcd(a, b) {
  let x = a >>> 0;
  let y = b >>> 0;
  while (y !== 0) {
    const t = x;
    x = y;
    y = t % y;
  }
  return x >>> 0;
}

function reallocInt32(oldArray, newSize) {
  const arr = new Int32Array(newSize);
  if (oldArray) {
    arr.set(oldArray.subarray(0, Math.min(oldArray.length, newSize)));
  }
  return arr;
}

function reallocUint32(oldArray, newSize) {
  const arr = new Uint32Array(newSize);
  if (oldArray) {
    arr.set(oldArray.subarray(0, Math.min(oldArray.length, newSize)));
  }
  return arr;
}

class SpeexResamplerState {
  constructor(nbChannels) {
    this.initialised = 0;
    this.started = 0;

    this.in_rate = 0;
    this.out_rate = 0;
    this.num_rate = 0;
    this.den_rate = 0;

    this.quality = -1;
    this.sinc_table_length = 0;
    this.mem_alloc_size = 0;
    this.filt_len = 0;

    this.mem = null;
    this.sinc_table = null;
    this.resampler_ptr = resampler_basic_zero;

    this.cutoff = 1.0;
    this.nb_channels = nbChannels >>> 0;
    this.in_stride = 1;
    this.out_stride = 1;

    this.buffer_size = 160;

    this.last_sample = new Int32Array(nbChannels);
    this.magic_samples = new Uint32Array(nbChannels);
    this.samp_frac_num = new Uint32Array(nbChannels);

    this.int_advance = 0;
    this.frac_advance = 0;
    this.oversample = 0;
  }
}

function resampler_basic_direct_single(st, channel_index, inArr, inBase, in_len_ref, out, outBase, out_len_ref) {
  const N = st.filt_len;
  let out_sample = 0;
  let last_sample = st.last_sample[channel_index] | 0;
  let samp_frac_num = st.samp_frac_num[channel_index] >>> 0;

  const out_stride = st.out_stride;
  const int_advance = st.int_advance;
  const frac_advance = st.frac_advance;
  const den_rate = st.den_rate;

  while (!(last_sample >= in_len_ref.value || out_sample >= out_len_ref.value)) {
    const sinctBase = (samp_frac_num * N) | 0;
    const iptrBase = (inBase + last_sample) | 0;

    let sum = 0;
    for (let j = 0; j < N; j += 1) {
      sum += st.sinc_table[sinctBase + j] * inArr[iptrBase + j];
    }
    sum = saturate32pshr(sum, 15, 32767);

    out[outBase + out_stride * out_sample] = sum;
    out_sample += 1;

    last_sample += int_advance;
    samp_frac_num += frac_advance;
    if (samp_frac_num >= den_rate) {
      samp_frac_num -= den_rate;
      last_sample += 1;
    }
  }

  st.last_sample[channel_index] = last_sample;
  st.samp_frac_num[channel_index] = samp_frac_num;
  return out_sample;
}

function resampler_basic_interpolate_single(st, channel_index, inArr, inBase, in_len_ref, out, outBase, out_len_ref) {
  const N = st.filt_len;
  let out_sample = 0;
  let last_sample = st.last_sample[channel_index] | 0;
  let samp_frac_num = st.samp_frac_num[channel_index] >>> 0;

  const out_stride = st.out_stride;
  const int_advance = st.int_advance;
  const frac_advance = st.frac_advance;
  const den_rate = st.den_rate;

  while (!(last_sample >= in_len_ref.value || out_sample >= out_len_ref.value)) {
    const iptrBase = inBase + last_sample;

    const offset = Math.floor((samp_frac_num * st.oversample) / st.den_rate);
    const fracNumer = ((samp_frac_num * st.oversample) % st.den_rate) << 15;
    const frac = Math.floor((fracNumer + (st.den_rate >> 1)) / st.den_rate);

    const accum = [0, 0, 0, 0];

    for (let j = 0; j < N; j += 1) {
      const curr_in = inArr[iptrBase + j];
      const base = 4 + (j + 1) * st.oversample - offset;
      accum[0] += curr_in * st.sinc_table[base - 2];
      accum[1] += curr_in * st.sinc_table[base - 1];
      accum[2] += curr_in * st.sinc_table[base];
      accum[3] += curr_in * st.sinc_table[base + 1];
    }

    const interp = [0, 0, 0, 0];
    cubic_coef(frac, interp);

    const sum = saturate32pshr(
      ashr(interp[0] * ashr(accum[0], 1), 15) +
      ashr(interp[1] * ashr(accum[1], 1), 15) +
      ashr(interp[2] * ashr(accum[2], 1), 15) +
      ashr(interp[3] * ashr(accum[3], 1), 15),
      15,
      32767,
    );

    out[outBase + out_stride * out_sample] = sum;
    out_sample += 1;

    last_sample += int_advance;
    samp_frac_num += frac_advance;
    if (samp_frac_num >= den_rate) {
      samp_frac_num -= den_rate;
      last_sample += 1;
    }
  }

  st.last_sample[channel_index] = last_sample;
  st.samp_frac_num[channel_index] = samp_frac_num;
  return out_sample;
}

function resampler_basic_zero(st, channel_index, _inArr, _inBase, in_len_ref, out, outBase, out_len_ref) {
  let out_sample = 0;
  let last_sample = st.last_sample[channel_index] | 0;
  let samp_frac_num = st.samp_frac_num[channel_index] >>> 0;

  const out_stride = st.out_stride;
  const int_advance = st.int_advance;
  const frac_advance = st.frac_advance;
  const den_rate = st.den_rate;

  while (!(last_sample >= in_len_ref.value || out_sample >= out_len_ref.value)) {
    out[outBase + out_stride * out_sample] = 0;
    out_sample += 1;

    last_sample += int_advance;
    samp_frac_num += frac_advance;
    if (samp_frac_num >= den_rate) {
      samp_frac_num -= den_rate;
      last_sample += 1;
    }
  }

  st.last_sample[channel_index] = last_sample;
  st.samp_frac_num[channel_index] = samp_frac_num;
  return out_sample;
}

function update_filter(st) {
  const old_length = st.filt_len >>> 0;
  const old_alloc_size = st.mem_alloc_size >>> 0;

  st.int_advance = Math.floor(st.num_rate / st.den_rate);
  st.frac_advance = st.num_rate % st.den_rate;
  st.oversample = quality_map[st.quality].oversample;
  st.filt_len = quality_map[st.quality].base_length;

  if (st.num_rate > st.den_rate) {
    st.cutoff = quality_map[st.quality].downsample_bandwidth * st.den_rate / st.num_rate;

    const filtLenRef = { value: st.filt_len };
    if (_muldiv(filtLenRef, st.filt_len, st.num_rate, st.den_rate) !== RESAMPLER_ERR_SUCCESS) {
      st.resampler_ptr = resampler_basic_zero;
      st.filt_len = old_length;
      return RESAMPLER_ERR_ALLOC_FAILED;
    }
    st.filt_len = filtLenRef.value;

    st.filt_len = (((st.filt_len - 1) & (~0x7)) + 8) >>> 0;

    if (2 * st.den_rate < st.num_rate) st.oversample >>= 1;
    if (4 * st.den_rate < st.num_rate) st.oversample >>= 1;
    if (8 * st.den_rate < st.num_rate) st.oversample >>= 1;
    if (16 * st.den_rate < st.num_rate) st.oversample >>= 1;
    if (st.oversample < 1) st.oversample = 1;
  } else {
    st.cutoff = quality_map[st.quality].upsample_bandwidth;
  }

  const use_direct = (st.filt_len * st.den_rate) <= (st.filt_len * st.oversample + 8)
    && Math.floor(INT_MAX / 4 / st.den_rate) >= st.filt_len;

  let min_sinc_table_length;
  if (use_direct) {
    min_sinc_table_length = st.filt_len * st.den_rate;
  } else {
    if (Math.floor((INT_MAX / 4 - 8) / st.oversample) < st.filt_len) {
      st.resampler_ptr = resampler_basic_zero;
      st.filt_len = old_length;
      return RESAMPLER_ERR_ALLOC_FAILED;
    }
    min_sinc_table_length = st.filt_len * st.oversample + 8;
  }

  if (st.sinc_table_length < min_sinc_table_length) {
    st.sinc_table = reallocInt32(st.sinc_table, min_sinc_table_length);
    st.sinc_table_length = min_sinc_table_length;
  }

  if (use_direct) {
    for (let i = 0; i < st.den_rate; i += 1) {
      for (let j = 0; j < st.filt_len; j += 1) {
        st.sinc_table[i * st.filt_len + j] = sinc(
          st.cutoff,
          (j - (st.filt_len >> 1) + 1) - (i / st.den_rate),
          st.filt_len,
          quality_map[st.quality].window_func,
        );
      }
    }
    st.resampler_ptr = resampler_basic_direct_single;
  } else {
    for (let i = -4; i < st.oversample * st.filt_len + 4; i += 1) {
      st.sinc_table[i + 4] = sinc(
        st.cutoff,
        i / st.oversample - st.filt_len / 2,
        st.filt_len,
        quality_map[st.quality].window_func,
      );
    }
    st.resampler_ptr = resampler_basic_interpolate_single;
  }

  const min_alloc_size = st.filt_len - 1 + st.buffer_size;
  if (min_alloc_size > st.mem_alloc_size) {
    if (Math.floor(INT_MAX / 4 / st.nb_channels) < min_alloc_size) {
      st.resampler_ptr = resampler_basic_zero;
      st.filt_len = old_length;
      return RESAMPLER_ERR_ALLOC_FAILED;
    }
    st.mem = reallocInt32(st.mem, st.nb_channels * min_alloc_size);
    st.mem_alloc_size = min_alloc_size;
  }

  if (!st.started) {
    st.mem.fill(0);
  } else if (st.filt_len > old_length) {
    for (let i = st.nb_channels - 1; i >= 0; i -= 1) {
      let olen = old_length;

      // Keep behavior identical to C code: always execute this block.
      olen = old_length + 2 * st.magic_samples[i];
      for (let j = old_length - 1 + st.magic_samples[i]; j > 0; j -= 1) {
        st.mem[i * st.mem_alloc_size + (j - 1) + st.magic_samples[i]] = st.mem[i * old_alloc_size + (j - 1)];
      }
      for (let j = 0; j < st.magic_samples[i]; j += 1) {
        st.mem[i * st.mem_alloc_size + j] = 0;
      }
      st.magic_samples[i] = 0;

      if (st.filt_len > olen) {
        let j = 0;
        for (; j < olen - 1; j += 1) {
          st.mem[i * st.mem_alloc_size + (st.filt_len - 2 - j)] = st.mem[i * st.mem_alloc_size + (olen - 2 - j)];
        }
        for (; j < st.filt_len - 1; j += 1) {
          st.mem[i * st.mem_alloc_size + (st.filt_len - 2 - j)] = 0;
        }
        st.last_sample[i] += Math.floor((st.filt_len - olen) / 2);
      } else {
        st.magic_samples[i] = Math.floor((olen - st.filt_len) / 2);
        for (let j = 0; j < st.filt_len - 1 + st.magic_samples[i]; j += 1) {
          st.mem[i * st.mem_alloc_size + j] = st.mem[i * st.mem_alloc_size + j + st.magic_samples[i]];
        }
      }
    }
  } else if (st.filt_len < old_length) {
    for (let i = 0; i < st.nb_channels; i += 1) {
      const old_magic = st.magic_samples[i];
      st.magic_samples[i] = Math.floor((old_length - st.filt_len) / 2);
      for (let j = 0; j < st.filt_len - 1 + st.magic_samples[i] + old_magic; j += 1) {
        st.mem[i * st.mem_alloc_size + j] = st.mem[i * st.mem_alloc_size + j + st.magic_samples[i]];
      }
      st.magic_samples[i] += old_magic;
    }
  }

  return RESAMPLER_ERR_SUCCESS;
}

function speex_resampler_process_native(st, channel_index, in_len_ref, out, outBase, out_len_ref) {
  const N = st.filt_len;
  const memBase = channel_index * st.mem_alloc_size;

  st.started = 1;

  const out_sample = st.resampler_ptr(st, channel_index, st.mem, memBase, in_len_ref, out, outBase, out_len_ref);

  if (st.last_sample[channel_index] < in_len_ref.value) {
    in_len_ref.value = st.last_sample[channel_index];
  }
  out_len_ref.value = out_sample;
  st.last_sample[channel_index] -= in_len_ref.value;

  const ilen = in_len_ref.value;
  for (let j = 0; j < N - 1; j += 1) {
    st.mem[memBase + j] = st.mem[memBase + j + ilen];
  }

  return RESAMPLER_ERR_SUCCESS;
}

function speex_resampler_magic(st, channel_index, out, outBase, out_len) {
  const tmp_in_len_ref = { value: st.magic_samples[channel_index] };
  const out_len_ref = { value: out_len };

  speex_resampler_process_native(st, channel_index, tmp_in_len_ref, out, outBase, out_len_ref);

  st.magic_samples[channel_index] -= tmp_in_len_ref.value;

  if (st.magic_samples[channel_index]) {
    const memBase = channel_index * st.mem_alloc_size;
    const N = st.filt_len;
    for (let i = 0; i < st.magic_samples[channel_index]; i += 1) {
      st.mem[memBase + N - 1 + i] = st.mem[memBase + N - 1 + i + tmp_in_len_ref.value];
    }
  }

  return out_len_ref.value;
}

function resampler_basic_zero_estimate(st, channel_index, in_len_ref, out_len_ref, out_last_sample_ref, out_samp_frac_num_ref) {
  let out_sample = 0;
  let last_sample = out_last_sample_ref.value;
  let samp_frac_num = out_samp_frac_num_ref.value >>> 0;

  const int_advance = st.int_advance;
  const frac_advance = st.frac_advance;
  const den_rate = st.den_rate;

  while (!(last_sample >= in_len_ref.value || out_sample >= out_len_ref.value)) {
    out_sample += 1;
    last_sample += int_advance;
    samp_frac_num += frac_advance;
    if (samp_frac_num >= den_rate) {
      samp_frac_num -= den_rate;
      last_sample += 1;
    }
  }

  out_last_sample_ref.value = last_sample;
  out_samp_frac_num_ref.value = samp_frac_num;
  return out_sample;
}

function speex_resampler_process_native_estimate(st, channel_index, in_len_ref, out_len_ref, out_last_sample_ref, out_samp_frac_num_ref) {
  st.started = 1;
  const out_sample = resampler_basic_zero_estimate(st, channel_index, in_len_ref, out_len_ref, out_last_sample_ref, out_samp_frac_num_ref);

  if (out_last_sample_ref.value < in_len_ref.value) {
    in_len_ref.value = out_last_sample_ref.value;
  }
  out_len_ref.value = out_sample;
  out_last_sample_ref.value -= in_len_ref.value;

  return RESAMPLER_ERR_SUCCESS;
}

function speex_resampler_magic_estimate(st, channel_index, out_len, out_magic_sample_ref, out_last_sample_ref, out_samp_frac_num_ref) {
  const tmp_in_len_ref = { value: out_magic_sample_ref.value };
  const out_len_ref = { value: out_len };

  speex_resampler_process_native_estimate(
    st,
    channel_index,
    tmp_in_len_ref,
    out_len_ref,
    out_last_sample_ref,
    out_samp_frac_num_ref,
  );

  out_magic_sample_ref.value -= tmp_in_len_ref.value;
  return out_len_ref.value;
}

export function speex_resampler_init(nb_channels, in_rate, out_rate, quality, errRef) {
  return speex_resampler_init_frac(nb_channels, in_rate, out_rate, in_rate, out_rate, quality, errRef);
}

export function speex_resampler_init_frac(nb_channels, ratio_num, ratio_den, in_rate, out_rate, quality, errRef) {
  if (
    nb_channels === 0 ||
    ratio_num === 0 ||
    ratio_den === 0 ||
    quality > SPEEX_RESAMPLER_QUALITY_MAX ||
    quality < SPEEX_RESAMPLER_QUALITY_MIN
  ) {
    if (errRef) errRef.value = RESAMPLER_ERR_INVALID_ARG;
    return null;
  }

  const st = new SpeexResamplerState(nb_channels >>> 0);

  let ret = speex_resampler_set_quality(st, quality);
  if (ret !== RESAMPLER_ERR_SUCCESS) {
    if (errRef) errRef.value = ret;
    return null;
  }

  ret = speex_resampler_set_rate_frac(st, ratio_num >>> 0, ratio_den >>> 0, in_rate >>> 0, out_rate >>> 0);
  if (ret !== RESAMPLER_ERR_SUCCESS) {
    if (errRef) errRef.value = ret;
    return null;
  }

  const filter_err = update_filter(st);
  if (filter_err === RESAMPLER_ERR_SUCCESS) {
    st.initialised = 1;
  } else {
    if (errRef) errRef.value = filter_err;
    return null;
  }

  if (errRef) errRef.value = RESAMPLER_ERR_SUCCESS;
  return st;
}

export function speex_resampler_destroy(st) {
  if (!st) return;
  st.mem = null;
  st.sinc_table = null;
  st.last_sample = null;
  st.magic_samples = null;
  st.samp_frac_num = null;
}

export function speex_resampler_process_int(st, channel_index, input, in_len_ref, output, out_len_ref) {
  if (!st || !in_len_ref || !out_len_ref) return RESAMPLER_ERR_BAD_STATE;
  if (channel_index >= st.nb_channels) return RESAMPLER_ERR_INVALID_ARG;

  let ilen = in_len_ref.value >>> 0;
  let olen = out_len_ref.value >>> 0;

  const xBase = channel_index * st.mem_alloc_size;
  const filt_offs = st.filt_len - 1;
  const xlen = st.mem_alloc_size - filt_offs;
  const istride = st.in_stride;

  let outPos = 0;
  let inPos = 0;

  if (st.magic_samples[channel_index]) {
    const producedMagic = speex_resampler_magic(st, channel_index, output, outPos, olen);
    olen -= producedMagic;
    outPos += producedMagic * st.out_stride;
  }

  if (!st.magic_samples[channel_index]) {
    while (ilen && olen) {
      const ichunkRef = { value: ilen > xlen ? xlen : ilen };
      const ochunkRef = { value: olen };

      if (input) {
        for (let j = 0; j < ichunkRef.value; j += 1) {
          st.mem[xBase + j + filt_offs] = input[inPos + j * istride] | 0;
        }
      } else {
        for (let j = 0; j < ichunkRef.value; j += 1) {
          st.mem[xBase + j + filt_offs] = 0;
        }
      }

      speex_resampler_process_native(st, channel_index, ichunkRef, output, outPos, ochunkRef);

      ilen -= ichunkRef.value;
      olen -= ochunkRef.value;
      outPos += ochunkRef.value * st.out_stride;
      if (input) inPos += ichunkRef.value * istride;
    }
  }

  in_len_ref.value -= ilen;
  out_len_ref.value -= olen;

  return st.resampler_ptr === resampler_basic_zero ? RESAMPLER_ERR_ALLOC_FAILED : RESAMPLER_ERR_SUCCESS;
}

export function speex_resampler_process_float(st, channel_index, input, in_len_ref, output, out_len_ref) {
  // mdxplay uses integer path; keep compatible wrapper.
  const inTmp = input ? Int32Array.from(input, (v) => v | 0) : null;
  const outTmp = new Int32Array(out_len_ref.value >>> 0);
  const ret = speex_resampler_process_int(st, channel_index, inTmp, in_len_ref, outTmp, out_len_ref);
  for (let i = 0; i < out_len_ref.value; i += 1) output[i * st.out_stride] = outTmp[i * st.out_stride];
  return ret;
}

export function speex_resampler_process_interleaved_int(st, input, in_len_ref, output, out_len_ref) {
  const istride_save = st.in_stride;
  const ostride_save = st.out_stride;
  const bak_out_len = out_len_ref.value;
  const bak_in_len = in_len_ref.value;

  st.in_stride = st.nb_channels;
  st.out_stride = st.nb_channels;

  for (let i = 0; i < st.nb_channels; i += 1) {
    out_len_ref.value = bak_out_len;
    in_len_ref.value = bak_in_len;
    speex_resampler_process_int(st, i, input ? input.subarray(i) : null, in_len_ref, output.subarray(i), out_len_ref);
  }

  st.in_stride = istride_save;
  st.out_stride = ostride_save;
  return st.resampler_ptr === resampler_basic_zero ? RESAMPLER_ERR_ALLOC_FAILED : RESAMPLER_ERR_SUCCESS;
}

export function speex_resampler_process_interleaved_float(st, input, in_len_ref, output, out_len_ref) {
  const inTmp = input ? Int32Array.from(input, (v) => v | 0) : null;
  const outTmp = new Int32Array(output.length);
  const ret = speex_resampler_process_interleaved_int(st, inTmp, in_len_ref, outTmp, out_len_ref);
  for (let i = 0; i < output.length; i += 1) output[i] = outTmp[i];
  return ret;
}

export function speex_resampler_estimate(st, channel_index, in_len_ref, out_len_ref) {
  let ilen = in_len_ref.value >>> 0;
  let olen = out_len_ref.value >>> 0;

  const filt_offs = st.filt_len - 1;
  const xlen = st.mem_alloc_size - filt_offs;

  const magic_sample_ref = { value: st.magic_samples[channel_index] | 0 };
  const last_sample_ref = { value: st.last_sample[channel_index] | 0 };
  const samp_frac_num_ref = { value: st.samp_frac_num[channel_index] | 0 };

  if (magic_sample_ref.value) {
    olen -= speex_resampler_magic_estimate(st, channel_index, olen, magic_sample_ref, last_sample_ref, samp_frac_num_ref);
  }

  if (!magic_sample_ref.value) {
    while (ilen && olen) {
      const ichunkRef = { value: ilen > xlen ? xlen : ilen };
      const ochunkRef = { value: olen };

      speex_resampler_process_native_estimate(st, channel_index, ichunkRef, ochunkRef, last_sample_ref, samp_frac_num_ref);

      ilen -= ichunkRef.value;
      olen -= ochunkRef.value;
    }
  }

  in_len_ref.value -= ilen;
  out_len_ref.value -= olen;

  return RESAMPLER_ERR_SUCCESS;
}

export function speex_resampler_set_rate(st, in_rate, out_rate) {
  return speex_resampler_set_rate_frac(st, in_rate >>> 0, out_rate >>> 0, in_rate >>> 0, out_rate >>> 0);
}

export function speex_resampler_get_rate(st, in_rate_ref, out_rate_ref) {
  in_rate_ref.value = st.in_rate;
  out_rate_ref.value = st.out_rate;
}

export function speex_resampler_set_rate_frac(st, ratio_num, ratio_den, in_rate, out_rate) {
  if (!ratio_num || !ratio_den) return RESAMPLER_ERR_INVALID_ARG;

  if (
    st.in_rate === in_rate &&
    st.out_rate === out_rate &&
    st.num_rate === ratio_num &&
    st.den_rate === ratio_den
  ) {
    return RESAMPLER_ERR_SUCCESS;
  }

  const old_den = st.den_rate;
  st.in_rate = in_rate;
  st.out_rate = out_rate;
  st.num_rate = ratio_num;
  st.den_rate = ratio_den;

  const fact = gcd(st.num_rate, st.den_rate);
  st.num_rate = Math.floor(st.num_rate / fact);
  st.den_rate = Math.floor(st.den_rate / fact);

  if (old_den > 0) {
    for (let i = 0; i < st.nb_channels; i += 1) {
      const fracRef = { value: st.samp_frac_num[i] };
      const ret = _muldiv(fracRef, st.samp_frac_num[i], st.den_rate, old_den);
      if (ret !== RESAMPLER_ERR_SUCCESS) {
        return RESAMPLER_ERR_OVERFLOW;
      }
      st.samp_frac_num[i] = fracRef.value;
      if (st.samp_frac_num[i] >= st.den_rate) {
        st.samp_frac_num[i] = st.den_rate - 1;
      }
    }
  }

  if (st.initialised) {
    return update_filter(st);
  }
  return RESAMPLER_ERR_SUCCESS;
}

export function speex_resampler_get_ratio(st, ratio_num_ref, ratio_den_ref) {
  ratio_num_ref.value = st.num_rate;
  ratio_den_ref.value = st.den_rate;
}

export function speex_resampler_set_quality(st, quality) {
  if (quality > SPEEX_RESAMPLER_QUALITY_MAX || quality < SPEEX_RESAMPLER_QUALITY_MIN) {
    return RESAMPLER_ERR_INVALID_ARG;
  }
  if (st.quality === quality) return RESAMPLER_ERR_SUCCESS;
  st.quality = quality;
  if (st.initialised) {
    return update_filter(st);
  }
  return RESAMPLER_ERR_SUCCESS;
}

export function speex_resampler_get_quality(st, quality_ref) {
  quality_ref.value = st.quality;
}

export function speex_resampler_set_input_stride(st, stride) {
  st.in_stride = stride | 0;
}

export function speex_resampler_get_input_stride(st, stride_ref) {
  stride_ref.value = st.in_stride;
}

export function speex_resampler_set_output_stride(st, stride) {
  st.out_stride = stride | 0;
}

export function speex_resampler_get_output_stride(st, stride_ref) {
  stride_ref.value = st.out_stride;
}

export function speex_resampler_get_input_latency(st) {
  return Math.floor(st.filt_len / 2);
}

export function speex_resampler_get_output_latency(st) {
  return Math.floor((Math.floor(st.filt_len / 2) * st.den_rate + (st.num_rate >> 1)) / st.num_rate);
}

export function speex_resampler_skip_zeros(st) {
  for (let i = 0; i < st.nb_channels; i += 1) {
    st.last_sample[i] = Math.floor(st.filt_len / 2);
  }
  return RESAMPLER_ERR_SUCCESS;
}

export function speex_resampler_reset_mem(st) {
  for (let i = 0; i < st.nb_channels; i += 1) {
    st.last_sample[i] = 0;
    st.magic_samples[i] = 0;
    st.samp_frac_num[i] = 0;
  }
  for (let i = 0; i < st.nb_channels * (st.filt_len - 1); i += 1) {
    st.mem[i] = 0;
  }
  return RESAMPLER_ERR_SUCCESS;
}

export function speex_resampler_strerror(err) {
  switch (err) {
    case RESAMPLER_ERR_SUCCESS: return "Success.";
    case RESAMPLER_ERR_ALLOC_FAILED: return "Memory allocation failed.";
    case RESAMPLER_ERR_BAD_STATE: return "Bad resampler state.";
    case RESAMPLER_ERR_INVALID_ARG: return "Invalid argument.";
    case RESAMPLER_ERR_PTR_OVERLAP: return "Input and output buffers overlap.";
    default: return "Unknown error. Bad error code or strange version mismatch.";
  }
}
