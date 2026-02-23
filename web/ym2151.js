import {
  RATE_STEPS,
  EG_INC,
  DT2_TAB,
  DT1_TAB,
  PHASEINC_ROM,
  LFO_NOISE_WAVEFORM,
} from "./ym2151_tables.js";

const FREQ_SH = 16;
const EG_SH = 16;
const LFO_SH = 10;
const TIMER_SH = 16;

const FREQ_MASK = (1 << FREQ_SH) - 1;

const ENV_BITS = 10;
const ENV_LEN = 1 << ENV_BITS;
const ENV_STEP = 128.0 / ENV_LEN;

const MAX_ATT_INDEX = ENV_LEN - 1;
const MIN_ATT_INDEX = 0;

const EG_ATT = 4;
const EG_DEC = 3;
const EG_SUS = 2;
const EG_REL = 1;
const EG_OFF = 0;

const SIN_BITS = 10;
const SIN_LEN = 1 << SIN_BITS;
const SIN_MASK = SIN_LEN - 1;

const TL_RES_LEN = 256;
const TL_TAB_LEN = 13 * 2 * TL_RES_LEN;

const ENV_QUIET = TL_TAB_LEN >> 3;

const SAMPLE_BITS = 16;
const FINAL_SH = SAMPLE_BITS === 16 ? 1 : 8;

const EG_RATE_SELECT = (() => {
  const out = [];

  // 32 infinite-time rates.
  for (let i = 0; i < 32; i += 1) out.push(18 * RATE_STEPS);

  // rates 00..11
  for (let r = 0; r < 12; r += 1) {
    out.push(0 * RATE_STEPS, 1 * RATE_STEPS, 2 * RATE_STEPS, 3 * RATE_STEPS);
  }

  // rates 12..15
  out.push(4 * RATE_STEPS, 5 * RATE_STEPS, 6 * RATE_STEPS, 7 * RATE_STEPS);
  out.push(8 * RATE_STEPS, 9 * RATE_STEPS, 10 * RATE_STEPS, 11 * RATE_STEPS);
  out.push(12 * RATE_STEPS, 13 * RATE_STEPS, 14 * RATE_STEPS, 15 * RATE_STEPS);
  out.push(16 * RATE_STEPS, 16 * RATE_STEPS, 16 * RATE_STEPS, 16 * RATE_STEPS);

  // 32 dummy rates (same as 15 3)
  for (let i = 0; i < 32; i += 1) out.push(16 * RATE_STEPS);

  return new Uint16Array(out);
})();

const EG_RATE_SHIFT = (() => {
  const out = [];

  // 32 infinite-time rates.
  for (let i = 0; i < 32; i += 1) out.push(0);

  // rates 00..11
  for (let s = 11; s >= 0; s -= 1) {
    out.push(s, s, s, s);
  }

  // rates 12..15 all zero shift
  out.push(0, 0, 0, 0);
  out.push(0, 0, 0, 0);
  out.push(0, 0, 0, 0);
  out.push(0, 0, 0, 0);

  // 32 dummy rates
  for (let i = 0; i < 32; i += 1) out.push(0);

  return new Uint8Array(out);
})();

const TL_TAB = new Int32Array(TL_TAB_LEN);
const SIN_TAB = new Uint32Array(SIN_LEN);
const D1L_TAB = new Uint32Array(16);
let TABLES_INITIALIZED = false;

const TARGET_MEM = 0;
const TARGET_M2 = 1;
const TARGET_C1 = 2;
const TARGET_C2 = 3;
const TARGET_CHAN_BASE = 4;
const TARGET_NONE = -1;

class Ym2151Operator {
  constructor() {
    this.reset();
  }

  reset() {
    this.phase = 0 >>> 0;
    this.freq = 0 >>> 0;
    this.dt1 = 0 | 0;
    this.mul = 0 >>> 0;
    this.dt1_i = 0 >>> 0;
    this.dt2 = 0 >>> 0;

    this.connectTarget = TARGET_NONE;
    this.memConnectTarget = TARGET_MEM;
    this.mem_value = 0 | 0;

    this.fb_shift = 0 >>> 0;
    this.fb_out_curr = 0 | 0;
    this.fb_out_prev = 0 | 0;
    this.kc = 0 >>> 0;
    this.kc_i = 0 >>> 0;
    this.pms = 0 >>> 0;
    this.ams = 0 >>> 0;

    this.AMmask = 0 >>> 0;
    this.state = EG_OFF >>> 0;
    this.eg_sh_ar = 0;
    this.eg_sel_ar = 0;
    this.tl = 0 >>> 0;
    this.volume = 0 | 0;
    this.eg_sh_d1r = 0;
    this.eg_sel_d1r = 0;
    this.d1l = 0 >>> 0;
    this.eg_sh_d2r = 0;
    this.eg_sel_d2r = 0;
    this.eg_sh_rr = 0;
    this.eg_sel_rr = 0;

    this.key = 0 >>> 0;

    this.ks = 0 >>> 0;
    this.ar = 0 >>> 0;
    this.d1r = 0 >>> 0;
    this.d2r = 0 >>> 0;
    this.rr = 0 >>> 0;
  }
}

function initTables() {
  if (TABLES_INITIALIZED) return;

  for (let x = 0; x < TL_RES_LEN; x += 1) {
    let m = (1 << 16) / Math.pow(2, ((x + 1) * (ENV_STEP / 4.0)) / 8.0);
    m = Math.floor(m);

    let n = m | 0;
    n >>= 4;
    if (n & 1) n = (n >> 1) + 1;
    else n >>= 1;
    n <<= 2;

    TL_TAB[x * 2 + 0] = n;
    TL_TAB[x * 2 + 1] = -n;

    for (let i = 1; i < 13; i += 1) {
      TL_TAB[x * 2 + i * 2 * TL_RES_LEN + 0] = TL_TAB[x * 2 + 0] >> i;
      TL_TAB[x * 2 + i * 2 * TL_RES_LEN + 1] = -TL_TAB[x * 2 + i * 2 * TL_RES_LEN + 0];
    }
  }

  for (let i = 0; i < SIN_LEN; i += 1) {
    const m = Math.sin((((i * 2) + 1) * Math.PI) / SIN_LEN);

    let o;
    if (m > 0.0) o = (8 * Math.log(1.0 / m)) / Math.log(2.0);
    else o = (8 * Math.log(-1.0 / m)) / Math.log(2.0);

    o = o / (ENV_STEP / 4);

    let n = Math.trunc(2.0 * o);
    if (n & 1) n = (n >> 1) + 1;
    else n >>= 1;

    SIN_TAB[i] = ((n * 2) + (m >= 0.0 ? 0 : 1)) >>> 0;
  }

  for (let i = 0; i < 16; i += 1) {
    const m = (i !== 15 ? i : i + 16) * (4.0 / ENV_STEP);
    D1L_TAB[i] = m >>> 0;
  }

  TABLES_INITIALIZED = true;
}

function allocChipState(chip) {
  chip.oper = new Array(32);
  for (let i = 0; i < 32; i += 1) {
    chip.oper[i] = new Ym2151Operator();
  }

  chip.pan = new Int32Array(16);
  chip.Muted = new Uint8Array(8);

  chip.eg_cnt = 0 >>> 0;
  chip.eg_timer = 0 >>> 0;
  chip.eg_timer_add = 0 >>> 0;
  chip.eg_timer_overflow = 0 >>> 0;

  chip.lfo_phase = 0 >>> 0;
  chip.lfo_timer = 0 >>> 0;
  chip.lfo_timer_add = 0 >>> 0;
  chip.lfo_overflow = 0 >>> 0;
  chip.lfo_counter = 0 >>> 0;
  chip.lfo_counter_add = 0 >>> 0;
  chip.lfo_wsel = 0;
  chip.amd = 0;
  chip.pmd = 0;
  chip.lfa = 0 >>> 0;
  chip.lfp = 0 | 0;

  chip.test = 0;
  chip.ct = 0;

  chip.noise = 0 >>> 0;
  chip.noise_rng = 0 >>> 0;
  chip.noise_p = 0 >>> 0;
  chip.noise_f = 0 >>> 0;

  chip.csm_req = 0 >>> 0;

  chip.irq_enable = 0 >>> 0;
  chip.status = 0 >>> 0;
  chip.connect = new Uint8Array(8);

  chip.tim_A = 0;
  chip.tim_B = 0;
  chip.tim_A_val = 0 >>> 0;
  chip.tim_B_val = 0 >>> 0;
  chip.tim_A_tab = new Uint32Array(1024);
  chip.tim_B_tab = new Uint32Array(256);

  chip.timer_A_index = 0 >>> 0;
  chip.timer_B_index = 0 >>> 0;
  chip.timer_A_index_old = 0 >>> 0;
  chip.timer_B_index_old = 0 >>> 0;

  chip.freq = new Uint32Array(11 * 768);
  chip.dt1_freq = new Int32Array(8 * 32);
  chip.noise_tab = new Uint32Array(32);

  chip.clock = 0 >>> 0;
  chip.sampfreq = 44100 >>> 0;

  chip.chanout = new Int32Array(8);
  chip.m2 = 0 | 0;
  chip.c1 = 0 | 0;
  chip.c2 = 0 | 0;
  chip.mem = 0 | 0;
}

function getTarget(chip, target) {
  if (target === TARGET_MEM) return chip.mem | 0;
  if (target === TARGET_M2) return chip.m2 | 0;
  if (target === TARGET_C1) return chip.c1 | 0;
  if (target === TARGET_C2) return chip.c2 | 0;
  if (target >= TARGET_CHAN_BASE) return chip.chanout[target - TARGET_CHAN_BASE] | 0;
  return 0;
}

function setTarget(chip, target, value) {
  const v = value | 0;
  if (target === TARGET_MEM) chip.mem = v;
  else if (target === TARGET_M2) chip.m2 = v;
  else if (target === TARGET_C1) chip.c1 = v;
  else if (target === TARGET_C2) chip.c2 = v;
  else if (target >= TARGET_CHAN_BASE) chip.chanout[target - TARGET_CHAN_BASE] = v;
}

function addTarget(chip, target, value) {
  const v = value | 0;
  if (target === TARGET_MEM) chip.mem = (chip.mem + v) | 0;
  else if (target === TARGET_M2) chip.m2 = (chip.m2 + v) | 0;
  else if (target === TARGET_C1) chip.c1 = (chip.c1 + v) | 0;
  else if (target === TARGET_C2) chip.c2 = (chip.c2 + v) | 0;
  else if (target >= TARGET_CHAN_BASE) {
    const idx = target - TARGET_CHAN_BASE;
    chip.chanout[idx] = (chip.chanout[idx] + v) | 0;
  }
}

function initChipTables(chip) {
  const scaler = (chip.clock / 64.0) / chip.sampfreq;

  const mult = 1 << (FREQ_SH - 10);

  for (let i = 0; i < 768; i += 1) {
    let phaseinc = PHASEINC_ROM[i];
    phaseinc *= scaler;

    chip.freq[768 + (2 * 768) + i] = (Math.trunc(phaseinc * mult) & 0xffffffc0) >>> 0;

    for (let j = 0; j < 2; j += 1) {
      chip.freq[768 + (j * 768) + i] = (chip.freq[768 + (2 * 768) + i] >>> (2 - j)) & 0xffffffc0;
    }

    for (let j = 3; j < 8; j += 1) {
      chip.freq[768 + (j * 768) + i] = (chip.freq[768 + (2 * 768) + i] << (j - 2)) >>> 0;
    }
  }

  for (let i = 0; i < 768; i += 1) {
    chip.freq[0 * 768 + i] = chip.freq[1 * 768 + 0];
  }

  for (let j = 8; j < 10; j += 1) {
    for (let i = 0; i < 768; i += 1) {
      chip.freq[768 + (j * 768) + i] = chip.freq[768 + (8 * 768) - 1];
    }
  }

  const multDt = 1 << FREQ_SH;
  for (let j = 0; j < 4; j += 1) {
    for (let i = 0; i < 32; i += 1) {
      const hz = (DT1_TAB[j * 32 + i] * (chip.clock / 64.0)) / (1 << 20);
      const phaseinc = (hz * SIN_LEN) / chip.sampfreq;

      chip.dt1_freq[(j + 0) * 32 + i] = Math.trunc(phaseinc * multDt) | 0;
      chip.dt1_freq[(j + 4) * 32 + i] = -chip.dt1_freq[(j + 0) * 32 + i];
    }
  }

  const timerMult = 1 << TIMER_SH;
  for (let i = 0; i < 1024; i += 1) {
    const pom = (64.0 * (1024 - i)) / chip.clock;
    chip.tim_A_tab[i] = Math.trunc(pom * chip.sampfreq * timerMult) >>> 0;
  }

  for (let i = 0; i < 256; i += 1) {
    const pom = (1024.0 * (256 - i)) / chip.clock;
    chip.tim_B_tab[i] = Math.trunc(pom * chip.sampfreq * timerMult) >>> 0;
  }

  const noiseScaler = (chip.clock / 64.0) / chip.sampfreq;
  for (let i = 0; i < 32; i += 1) {
    let j = i !== 31 ? i : 30;
    j = 32 - j;
    j = 65536.0 / (j * 32.0);
    chip.noise_tab[i] = Math.trunc(j * 64 * noiseScaler) >>> 0;
  }
}

function keyOn(chip, op, keySet) {
  if (!op.key) {
    op.phase = 0 >>> 0;
    op.state = EG_ATT;
    op.volume = (op.volume + (((~op.volume) * EG_INC[op.eg_sel_ar + ((chip.eg_cnt >> op.eg_sh_ar) & 7)]) >> 4)) | 0;
    if (op.volume <= MIN_ATT_INDEX) {
      op.volume = MIN_ATT_INDEX;
      op.state = EG_DEC;
    }
  }
  op.key = (op.key | keySet) >>> 0;
}

function keyOff(op, keyClr) {
  if (op.key) {
    op.key = (op.key & keyClr) >>> 0;
    if (!op.key) {
      if (op.state > EG_REL) {
        op.state = EG_REL;
      }
    }
  }
}

function envelope_KONKOFF(chip, opBase, v) {
  if (v & 0x08) keyOn(chip, chip.oper[opBase + 0], 1);
  else keyOff(chip.oper[opBase + 0], ~1);

  if (v & 0x20) keyOn(chip, chip.oper[opBase + 1], 1);
  else keyOff(chip.oper[opBase + 1], ~1);

  if (v & 0x10) keyOn(chip, chip.oper[opBase + 2], 1);
  else keyOff(chip.oper[opBase + 2], ~1);

  if (v & 0x40) keyOn(chip, chip.oper[opBase + 3], 1);
  else keyOff(chip.oper[opBase + 3], ~1);
}

function set_connect(chip, opBase, cha, v) {
  const om1 = chip.oper[opBase];
  const om2 = chip.oper[opBase + 1];
  const oc1 = chip.oper[opBase + 2];

  switch (v & 7) {
    case 0:
      om1.connectTarget = TARGET_C1;
      oc1.connectTarget = TARGET_MEM;
      om2.connectTarget = TARGET_C2;
      om1.memConnectTarget = TARGET_M2;
      break;

    case 1:
      om1.connectTarget = TARGET_MEM;
      oc1.connectTarget = TARGET_MEM;
      om2.connectTarget = TARGET_C2;
      om1.memConnectTarget = TARGET_M2;
      break;

    case 2:
      om1.connectTarget = TARGET_C2;
      oc1.connectTarget = TARGET_MEM;
      om2.connectTarget = TARGET_C2;
      om1.memConnectTarget = TARGET_M2;
      break;

    case 3:
      om1.connectTarget = TARGET_C1;
      oc1.connectTarget = TARGET_MEM;
      om2.connectTarget = TARGET_C2;
      om1.memConnectTarget = TARGET_C2;
      break;

    case 4:
      om1.connectTarget = TARGET_C1;
      oc1.connectTarget = TARGET_CHAN_BASE + cha;
      om2.connectTarget = TARGET_C2;
      om1.memConnectTarget = TARGET_MEM;
      break;

    case 5:
      om1.connectTarget = TARGET_NONE;
      oc1.connectTarget = TARGET_CHAN_BASE + cha;
      om2.connectTarget = TARGET_CHAN_BASE + cha;
      om1.memConnectTarget = TARGET_M2;
      break;

    case 6:
      om1.connectTarget = TARGET_C1;
      oc1.connectTarget = TARGET_CHAN_BASE + cha;
      om2.connectTarget = TARGET_CHAN_BASE + cha;
      om1.memConnectTarget = TARGET_MEM;
      break;

    case 7:
    default:
      om1.connectTarget = TARGET_CHAN_BASE + cha;
      oc1.connectTarget = TARGET_CHAN_BASE + cha;
      om2.connectTarget = TARGET_CHAN_BASE + cha;
      om1.memConnectTarget = TARGET_MEM;
      break;
  }
}

function refresh_EG(chip, opBase) {
  for (let n = 0; n < 4; n += 1) {
    const op = chip.oper[opBase + n];
    const v = op.kc >> op.ks;

    if ((op.ar + v) < (32 + 62)) {
      op.eg_sh_ar = EG_RATE_SHIFT[op.ar + v];
      op.eg_sel_ar = EG_RATE_SELECT[op.ar + v];
    } else {
      op.eg_sh_ar = 0;
      op.eg_sel_ar = 17 * RATE_STEPS;
    }

    op.eg_sh_d1r = EG_RATE_SHIFT[op.d1r + v];
    op.eg_sel_d1r = EG_RATE_SELECT[op.d1r + v];
    op.eg_sh_d2r = EG_RATE_SHIFT[op.d2r + v];
    op.eg_sel_d2r = EG_RATE_SELECT[op.d2r + v];
    op.eg_sh_rr = EG_RATE_SHIFT[op.rr + v];
    op.eg_sel_rr = EG_RATE_SELECT[op.rr + v];
  }
}

function ymFreq(chip, idx) {
  return chip.freq[idx];
}

export function ym2151_write_reg(chip, r, v) {
  const rr = r & 0xff;
  const vv = v & 0xff;
  const opIndex = ((rr & 0x07) * 4 + ((rr & 0x18) >> 3)) | 0;
  let op = chip.oper[opIndex];

  switch (rr & 0xe0) {
    case 0x00:
      switch (rr) {
        case 0x01:
          chip.test = vv;
          if (vv & 2) chip.lfo_phase = 0;
          break;

        case 0x08:
          envelope_KONKOFF(chip, (vv & 7) * 4, vv);
          break;

        case 0x0f:
          chip.noise = vv >>> 0;
          chip.noise_f = chip.noise_tab[vv & 0x1f] >>> 0;
          break;

        case 0x10:
          chip.timer_A_index = ((chip.timer_A_index & 0x003) | (vv << 2)) >>> 0;
          break;

        case 0x11:
          chip.timer_A_index = ((chip.timer_A_index & 0x3fc) | (vv & 3)) >>> 0;
          break;

        case 0x12:
          chip.timer_B_index = vv >>> 0;
          break;

        case 0x14:
          chip.irq_enable = vv >>> 0;

          if (vv & 0x10) chip.status &= ~1;
          if (vv & 0x20) chip.status &= ~2;

          if (vv & 0x02) {
            if (!chip.tim_B) {
              chip.tim_B = 1;
              chip.tim_B_val = chip.tim_B_tab[chip.timer_B_index] >>> 0;
            }
          } else {
            chip.tim_B = 0;
          }

          if (vv & 0x01) {
            if (!chip.tim_A) {
              chip.tim_A = 1;
              chip.tim_A_val = chip.tim_A_tab[chip.timer_A_index] >>> 0;
            }
          } else {
            chip.tim_A = 0;
          }
          break;

        case 0x18:
          chip.lfo_overflow = ((1 << ((15 - (vv >> 4)) + 3)) * (1 << LFO_SH)) >>> 0;
          chip.lfo_counter_add = (0x10 + (vv & 0x0f)) >>> 0;
          break;

        case 0x19:
          if (vv & 0x80) chip.pmd = vv & 0x7f;
          else chip.amd = vv & 0x7f;
          break;

        case 0x1b:
          chip.ct = vv >> 6;
          chip.lfo_wsel = vv & 3;
          break;

        default:
          break;
      }
      break;

    case 0x20: {
      const ch = rr & 7;
      const chBase = ch * 4;
      op = chip.oper[chBase];

      switch (rr & 0x18) {
        case 0x00:
          op.fb_shift = ((vv >> 3) & 7) ? (((vv >> 3) & 7) + 6) : 0;
          chip.pan[ch * 2] = (vv & 0x40) ? ~0 : 0;
          chip.pan[ch * 2 + 1] = (vv & 0x80) ? ~0 : 0;
          chip.connect[ch] = vv & 7;
          set_connect(chip, chBase, ch, vv & 7);
          break;

        case 0x08: {
          const keyCode = vv & 0x7f;
          if (keyCode !== op.kc) {
            let kcChannel = (keyCode - (keyCode >> 2)) * 64;
            kcChannel += 768;
            kcChannel |= (op.kc_i & 63);

            for (let n = 0; n < 4; n += 1) {
              const o = chip.oper[chBase + n];
              o.kc = keyCode;
              o.kc_i = kcChannel;
            }

            const kc = keyCode >> 2;
            for (let n = 0; n < 4; n += 1) {
              const o = chip.oper[chBase + n];
              o.dt1 = chip.dt1_freq[o.dt1_i + kc] | 0;
              o.freq = (((ymFreq(chip, kcChannel + o.dt2) + o.dt1) * o.mul) >> 1) >>> 0;
            }

            refresh_EG(chip, chBase);
          }
          break;
        }

        case 0x10: {
          const keyFrac = vv >> 2;
          if (keyFrac !== (op.kc_i & 63)) {
            const kcChannel = keyFrac | (op.kc_i & ~63);

            for (let n = 0; n < 4; n += 1) {
              chip.oper[chBase + n].kc_i = kcChannel;
            }

            for (let n = 0; n < 4; n += 1) {
              const o = chip.oper[chBase + n];
              o.freq = (((ymFreq(chip, kcChannel + o.dt2) + o.dt1) * o.mul) >> 1) >>> 0;
            }
          }
          break;
        }

        case 0x18:
          op.pms = (vv >> 4) & 7;
          op.ams = vv & 3;
          break;

        default:
          break;
      }
      break;
    }

    case 0x40: {
      const olddt1_i = op.dt1_i;
      const oldmul = op.mul;

      op.dt1_i = ((vv & 0x70) << 1) >>> 0;
      op.mul = (vv & 0x0f) ? ((vv & 0x0f) << 1) : 1;

      if (olddt1_i !== op.dt1_i) {
        op.dt1 = chip.dt1_freq[op.dt1_i + (op.kc >> 2)] | 0;
      }

      if (olddt1_i !== op.dt1_i || oldmul !== op.mul) {
        op.freq = (((ymFreq(chip, op.kc_i + op.dt2) + op.dt1) * op.mul) >> 1) >>> 0;
      }
      break;
    }

    case 0x60:
      op.tl = ((vv & 0x7f) << (ENV_BITS - 7)) >>> 0;
      break;

    case 0x80: {
      const oldks = op.ks;
      const oldar = op.ar;

      op.ks = 5 - (vv >> 6);
      op.ar = (vv & 0x1f) ? (32 + ((vv & 0x1f) << 1)) : 0;

      if (op.ar !== oldar || op.ks !== oldks) {
        const idx = op.ar + (op.kc >> op.ks);
        if (idx < (32 + 62)) {
          op.eg_sh_ar = EG_RATE_SHIFT[idx];
          op.eg_sel_ar = EG_RATE_SELECT[idx];
        } else {
          op.eg_sh_ar = 0;
          op.eg_sel_ar = 17 * RATE_STEPS;
        }
      }

      if (op.ks !== oldks) {
        op.eg_sh_d1r = EG_RATE_SHIFT[op.d1r + (op.kc >> op.ks)];
        op.eg_sel_d1r = EG_RATE_SELECT[op.d1r + (op.kc >> op.ks)];
        op.eg_sh_d2r = EG_RATE_SHIFT[op.d2r + (op.kc >> op.ks)];
        op.eg_sel_d2r = EG_RATE_SELECT[op.d2r + (op.kc >> op.ks)];
        op.eg_sh_rr = EG_RATE_SHIFT[op.rr + (op.kc >> op.ks)];
        op.eg_sel_rr = EG_RATE_SELECT[op.rr + (op.kc >> op.ks)];
      }
      break;
    }

    case 0xa0:
      op.AMmask = (vv & 0x80) ? ~0 : 0;
      op.d1r = (vv & 0x1f) ? (32 + ((vv & 0x1f) << 1)) : 0;
      op.eg_sh_d1r = EG_RATE_SHIFT[op.d1r + (op.kc >> op.ks)];
      op.eg_sel_d1r = EG_RATE_SELECT[op.d1r + (op.kc >> op.ks)];
      break;

    case 0xc0: {
      const olddt2 = op.dt2;
      op.dt2 = DT2_TAB[vv >> 6] >>> 0;
      if (op.dt2 !== olddt2) {
        op.freq = (((ymFreq(chip, op.kc_i + op.dt2) + op.dt1) * op.mul) >> 1) >>> 0;
      }

      op.d2r = (vv & 0x1f) ? (32 + ((vv & 0x1f) << 1)) : 0;
      op.eg_sh_d2r = EG_RATE_SHIFT[op.d2r + (op.kc >> op.ks)];
      op.eg_sel_d2r = EG_RATE_SELECT[op.d2r + (op.kc >> op.ks)];
      break;
    }

    case 0xe0:
      op.d1l = D1L_TAB[vv >> 4] >>> 0;
      op.rr = (34 + ((vv & 0x0f) << 2)) >>> 0;
      op.eg_sh_rr = EG_RATE_SHIFT[op.rr + (op.kc >> op.ks)];
      op.eg_sel_rr = EG_RATE_SELECT[op.rr + (op.kc >> op.ks)];
      break;

    default:
      break;
  }
}

export function ym2151_read_status(chip) {
  return chip.status | 0;
}

export function ym2151_new(clock, rate) {
  return new YM2151(clock, rate);
}

export function ym2151_init(chip, clock, rate) {
  allocChipState(chip);
  initTables();

  chip.clock = clock >>> 0;
  chip.sampfreq = (rate ? rate : 44100) >>> 0;

  initChipTables(chip);

  chip.lfo_timer_add = Math.trunc(((1 << LFO_SH) * (clock / 64.0)) / chip.sampfreq) >>> 0;
  chip.eg_timer_add = Math.trunc(((1 << EG_SH) * (clock / 64.0)) / chip.sampfreq) >>> 0;
  chip.eg_timer_overflow = (3 * (1 << EG_SH)) >>> 0;

  chip.tim_A = 0;
  chip.tim_B = 0;

  for (let ch = 0; ch < 8; ch += 1) {
    chip.Muted[ch] = 0;
  }
}

export function ym2151_free(chip) {
  void chip;
}

export function ym2151_reset_chip(chip) {
  for (let i = 0; i < 32; i += 1) {
    chip.oper[i].reset();
    chip.oper[i].volume = MAX_ATT_INDEX;
    chip.oper[i].kc_i = 768;
  }

  chip.eg_timer = 0;
  chip.eg_cnt = 0;

  chip.lfo_timer = 0;
  chip.lfo_counter = 0;
  chip.lfo_phase = 0;
  chip.lfo_wsel = 0;
  chip.pmd = 0;
  chip.amd = 0;
  chip.lfa = 0;
  chip.lfp = 0;

  chip.test = 0;

  chip.irq_enable = 0;
  chip.tim_A = 0;
  chip.tim_B = 0;
  chip.tim_A_val = 0;
  chip.tim_B_val = 0;

  chip.timer_A_index = 0;
  chip.timer_B_index = 0;
  chip.timer_A_index_old = 0;
  chip.timer_B_index_old = 0;

  chip.noise = 0;
  chip.noise_rng = 0;
  chip.noise_p = 0;
  chip.noise_f = chip.noise_tab[0] >>> 0;

  chip.csm_req = 0;
  chip.status = 0;

  ym2151_write_reg(chip, 0x1b, 0);
  ym2151_write_reg(chip, 0x18, 0);
  for (let i = 0x20; i < 0x100; i += 1) {
    ym2151_write_reg(chip, i, 0);
  }
}

function op_calc(op, env, pm) {
  const phase = ((op.phase & 0xffff0000) + ((pm << 15) | 0)) | 0;
  const p = (env << 3) + SIN_TAB[(phase >> FREQ_SH) & SIN_MASK];

  if (p >= TL_TAB_LEN) return 0;
  return TL_TAB[p] | 0;
}

function op_calc1(op, env, pm) {
  const i = ((op.phase & 0xffff0000) + pm) | 0;
  const p = (env << 3) + SIN_TAB[(i >> FREQ_SH) & SIN_MASK];

  if (p >= TL_TAB_LEN) return 0;
  return TL_TAB[p] | 0;
}

function volume_calc(op, AM) {
  return (op.tl + op.volume + (AM & op.AMmask)) >>> 0;
}

function chan_calc(chip, chan) {
  if (chip.Muted[chan]) return;

  chip.m2 = chip.c1 = chip.c2 = chip.mem = 0;

  const base = chan * 4;
  const op0 = chip.oper[base + 0];
  const op1 = chip.oper[base + 1];
  const op2 = chip.oper[base + 2];
  const op3 = chip.oper[base + 3];

  setTarget(chip, op0.memConnectTarget, op0.mem_value);

  let AM = 0;
  if (op0.ams) {
    AM = chip.lfa << (op0.ams - 1);
  }

  let env = volume_calc(op0, AM);
  {
    let out = (op0.fb_out_prev + op0.fb_out_curr) | 0;
    op0.fb_out_prev = op0.fb_out_curr;

    if (op0.connectTarget === TARGET_NONE) {
      chip.mem = chip.c1 = chip.c2 = op0.fb_out_prev;
    } else {
      setTarget(chip, op0.connectTarget, op0.fb_out_prev);
    }

    op0.fb_out_curr = 0;
    if (env < ENV_QUIET) {
      if (!op0.fb_shift) out = 0;
      op0.fb_out_curr = op_calc1(op0, env, (out << op0.fb_shift) | 0);
    }
  }

  env = volume_calc(op1, AM);
  if (env < ENV_QUIET) {
    addTarget(chip, op1.connectTarget, op_calc(op1, env, chip.m2));
  }

  env = volume_calc(op2, AM);
  if (env < ENV_QUIET) {
    addTarget(chip, op2.connectTarget, op_calc(op2, env, chip.c1));
  }

  env = volume_calc(op3, AM);
  if (env < ENV_QUIET) {
    chip.chanout[chan] = (chip.chanout[chan] + op_calc(op3, env, chip.c2)) | 0;
  }

  op0.mem_value = chip.mem;
}

function chan7_calc(chip) {
  if (chip.Muted[7]) return;

  chip.m2 = chip.c1 = chip.c2 = chip.mem = 0;

  const base = 7 * 4;
  const op0 = chip.oper[base + 0];
  const op1 = chip.oper[base + 1];
  const op2 = chip.oper[base + 2];
  const op3 = chip.oper[base + 3];

  setTarget(chip, op0.memConnectTarget, op0.mem_value);

  let AM = 0;
  if (op0.ams) {
    AM = chip.lfa << (op0.ams - 1);
  }

  let env = volume_calc(op0, AM);
  {
    let out = (op0.fb_out_prev + op0.fb_out_curr) | 0;
    op0.fb_out_prev = op0.fb_out_curr;

    if (op0.connectTarget === TARGET_NONE) {
      chip.mem = chip.c1 = chip.c2 = op0.fb_out_prev;
    } else {
      setTarget(chip, op0.connectTarget, op0.fb_out_prev);
    }

    op0.fb_out_curr = 0;
    if (env < ENV_QUIET) {
      if (!op0.fb_shift) out = 0;
      op0.fb_out_curr = op_calc1(op0, env, (out << op0.fb_shift) | 0);
    }
  }

  env = volume_calc(op1, AM);
  if (env < ENV_QUIET) {
    addTarget(chip, op1.connectTarget, op_calc(op1, env, chip.m2));
  }

  env = volume_calc(op2, AM);
  if (env < ENV_QUIET) {
    addTarget(chip, op2.connectTarget, op_calc(op2, env, chip.c1));
  }

  env = volume_calc(op3, AM);
  if (chip.noise & 0x80) {
    let noiseout = 0;
    if (env < 0x3ff) {
      noiseout = ((env ^ 0x3ff) * 2) | 0;
    }
    chip.chanout[7] += (chip.noise_rng & 0x10000) ? noiseout : -noiseout;
  } else if (env < ENV_QUIET) {
    chip.chanout[7] += op_calc(op3, env, chip.c2);
  }

  if (chip.chanout[7] > 16384) chip.chanout[7] = 16384;
  else if (chip.chanout[7] < -16384) chip.chanout[7] = -16384;

  op0.mem_value = chip.mem;
}

function advance_eg(chip) {
  chip.eg_timer = (chip.eg_timer + chip.eg_timer_add) >>> 0;

  while (chip.eg_timer >= chip.eg_timer_overflow) {
    chip.eg_timer = (chip.eg_timer - chip.eg_timer_overflow) >>> 0;
    chip.eg_cnt = (chip.eg_cnt + 1) >>> 0;

    for (let i = 0; i < 32; i += 1) {
      const op = chip.oper[i];
      switch (op.state) {
        case EG_ATT:
          if (!(chip.eg_cnt & ((1 << op.eg_sh_ar) - 1))) {
            op.volume = (op.volume + (((~op.volume) * EG_INC[op.eg_sel_ar + ((chip.eg_cnt >> op.eg_sh_ar) & 7)]) >> 4)) | 0;
            if (op.volume <= MIN_ATT_INDEX) {
              op.volume = MIN_ATT_INDEX;
              op.state = EG_DEC;
            }
          }
          break;

        case EG_DEC:
          if (!(chip.eg_cnt & ((1 << op.eg_sh_d1r) - 1))) {
            op.volume = (op.volume + EG_INC[op.eg_sel_d1r + ((chip.eg_cnt >> op.eg_sh_d1r) & 7)]) | 0;
            if (op.volume >= op.d1l) op.state = EG_SUS;
          }
          break;

        case EG_SUS:
          if (!(chip.eg_cnt & ((1 << op.eg_sh_d2r) - 1))) {
            op.volume = (op.volume + EG_INC[op.eg_sel_d2r + ((chip.eg_cnt >> op.eg_sh_d2r) & 7)]) | 0;
            if (op.volume >= MAX_ATT_INDEX) {
              op.volume = MAX_ATT_INDEX;
              op.state = EG_OFF;
            }
          }
          break;

        case EG_REL:
          if (!(chip.eg_cnt & ((1 << op.eg_sh_rr) - 1))) {
            op.volume = (op.volume + EG_INC[op.eg_sel_rr + ((chip.eg_cnt >> op.eg_sh_rr) & 7)]) | 0;
            if (op.volume >= MAX_ATT_INDEX) {
              op.volume = MAX_ATT_INDEX;
              op.state = EG_OFF;
            }
          }
          break;

        default:
          break;
      }
    }
  }
}

function advance(chip) {
  if (chip.test & 2) {
    chip.lfo_phase = 0;
  } else {
    chip.lfo_timer = (chip.lfo_timer + chip.lfo_timer_add) >>> 0;
    if (chip.lfo_timer >= chip.lfo_overflow) {
      chip.lfo_timer = (chip.lfo_timer - chip.lfo_overflow) >>> 0;
      chip.lfo_counter = (chip.lfo_counter + chip.lfo_counter_add) >>> 0;
      chip.lfo_phase = (chip.lfo_phase + (chip.lfo_counter >> 4)) & 255;
      chip.lfo_counter &= 15;
    }
  }

  const i = chip.lfo_phase;
  let a;
  let p;

  switch (chip.lfo_wsel) {
    case 0:
      a = 255 - i;
      if (i < 128) p = i;
      else p = i - 255;
      break;

    case 1:
      if (i < 128) {
        a = 255;
        p = 128;
      } else {
        a = 0;
        p = -128;
      }
      break;

    case 2:
      if (i < 128) a = 255 - (i * 2);
      else a = (i * 2) - 256;

      if (i < 64) p = i * 2;
      else if (i < 128) p = 255 - (i * 2);
      else if (i < 192) p = 256 - (i * 2);
      else p = (i * 2) - 511;
      break;

    case 3:
    default:
      a = LFO_NOISE_WAVEFORM[i];
      p = a - 128;
      break;
  }

  chip.lfa = Math.trunc((a * chip.amd) / 128) >>> 0;
  chip.lfp = Math.trunc((p * chip.pmd) / 128) | 0;

  chip.noise_p = (chip.noise_p + chip.noise_f) >>> 0;
  let events = chip.noise_p >>> 16;
  chip.noise_p &= 0xffff;
  while (events) {
    const j = (((chip.noise_rng ^ (chip.noise_rng >>> 3)) & 1) ^ 1) >>> 0;
    chip.noise_rng = ((j << 16) | (chip.noise_rng >>> 1)) >>> 0;
    events -= 1;
  }

  for (let ch = 0; ch < 8; ch += 1) {
    const base = ch * 4;
    const op0 = chip.oper[base + 0];
    const op1 = chip.oper[base + 1];
    const op2 = chip.oper[base + 2];
    const op3 = chip.oper[base + 3];

    if (op0.pms) {
      let mod_ind = chip.lfp | 0;
      if (op0.pms < 6) mod_ind >>= (6 - op0.pms);
      else mod_ind <<= (op0.pms - 5);

      if (mod_ind) {
        const kcChannel = (op0.kc_i + mod_ind) | 0;
        op0.phase = (op0.phase + ((((ymFreq(chip, kcChannel + op0.dt2) + op0.dt1) * op0.mul) >> 1) >>> 0)) >>> 0;
        op1.phase = (op1.phase + ((((ymFreq(chip, kcChannel + op1.dt2) + op1.dt1) * op1.mul) >> 1) >>> 0)) >>> 0;
        op2.phase = (op2.phase + ((((ymFreq(chip, kcChannel + op2.dt2) + op2.dt1) * op2.mul) >> 1) >>> 0)) >>> 0;
        op3.phase = (op3.phase + ((((ymFreq(chip, kcChannel + op3.dt2) + op3.dt1) * op3.mul) >> 1) >>> 0)) >>> 0;
      } else {
        op0.phase = (op0.phase + op0.freq) >>> 0;
        op1.phase = (op1.phase + op1.freq) >>> 0;
        op2.phase = (op2.phase + op2.freq) >>> 0;
        op3.phase = (op3.phase + op3.freq) >>> 0;
      }
    } else {
      op0.phase = (op0.phase + op0.freq) >>> 0;
      op1.phase = (op1.phase + op1.freq) >>> 0;
      op2.phase = (op2.phase + op2.freq) >>> 0;
      op3.phase = (op3.phase + op3.freq) >>> 0;
    }
  }

  if (chip.csm_req) {
    if (chip.csm_req === 2) {
      for (let iOp = 0; iOp < 32; iOp += 1) {
        keyOn(chip, chip.oper[iOp], 2);
      }
      chip.csm_req = 1;
    } else {
      for (let iOp = 0; iOp < 32; iOp += 1) {
        keyOff(chip.oper[iOp], ~2);
      }
      chip.csm_req = 0;
    }
  }
}

export function ym2151_update_one(chip, buffers, length) {
  const bufL = buffers[0];
  const bufR = buffers[1];

  if (chip.tim_B) {
    chip.tim_B_val = (chip.tim_B_val - (length << TIMER_SH)) | 0;
    if (chip.tim_B_val <= 0) {
      chip.tim_B_val = (chip.tim_B_val + (chip.tim_B_tab[chip.timer_B_index] | 0)) | 0;
      if (chip.irq_enable & 0x08) {
        chip.status |= 2;
      }
    }
  }

  for (let i = 0; i < length; i += 1) {
    advance_eg(chip);

    chip.chanout[0] = 0;
    chip.chanout[1] = 0;
    chip.chanout[2] = 0;
    chip.chanout[3] = 0;
    chip.chanout[4] = 0;
    chip.chanout[5] = 0;
    chip.chanout[6] = 0;
    chip.chanout[7] = 0;

    chan_calc(chip, 0);
    chan_calc(chip, 1);
    chan_calc(chip, 2);
    chan_calc(chip, 3);
    chan_calc(chip, 4);
    chan_calc(chip, 5);
    chan_calc(chip, 6);
    chan7_calc(chip);

    let outl = chip.chanout[0] & chip.pan[0];
    let outr = chip.chanout[0] & chip.pan[1];
    outl += chip.chanout[1] & chip.pan[2];
    outr += chip.chanout[1] & chip.pan[3];
    outl += chip.chanout[2] & chip.pan[4];
    outr += chip.chanout[2] & chip.pan[5];
    outl += chip.chanout[3] & chip.pan[6];
    outr += chip.chanout[3] & chip.pan[7];
    outl += chip.chanout[4] & chip.pan[8];
    outr += chip.chanout[4] & chip.pan[9];
    outl += chip.chanout[5] & chip.pan[10];
    outr += chip.chanout[5] & chip.pan[11];
    outl += chip.chanout[6] & chip.pan[12];
    outr += chip.chanout[6] & chip.pan[13];
    outl += chip.chanout[7] & chip.pan[14];
    outr += chip.chanout[7] & chip.pan[15];

    outl >>= FINAL_SH;
    outr >>= FINAL_SH;

    let outld = outl / 32767.0;
    if (outld < -1.0) outld = 1.0;
    else if (outld > 1.0) outld = 1.0;
    else outld = outld - (outld * outld * outld) / 3;

    let outrd = outr / 32767.0;
    if (outrd < -1.0) outrd = 1.0;
    else if (outrd > 1.0) outrd = 1.0;
    else outrd = outrd - (outrd * outrd * outrd) / 3;

    bufL[i] = (outld * 32767) | 0;
    bufR[i] = (outrd * 32767) | 0;

    if (chip.tim_A) {
      chip.tim_A_val = (chip.tim_A_val - (1 << TIMER_SH)) | 0;
      if (chip.tim_A_val <= 0) {
        chip.tim_A_val = (chip.tim_A_val + (chip.tim_A_tab[chip.timer_A_index] | 0)) | 0;
        if (chip.irq_enable & 0x04) {
          chip.status |= 1;
        }
        if (chip.irq_enable & 0x80) {
          chip.csm_req = 2;
        }
      }
    }

    advance(chip);
  }
}

export function ym2151_set_mutemask(chip, muteMask) {
  for (let ch = 0; ch < 8; ch += 1) {
    chip.Muted[ch] = (muteMask >> ch) & 0x01;
  }
}

export function ym2151_shutdown(chip) {
  void chip;
}

export function ym2151_postload(chip) {
  // No-op in this port, same behavior as original source (no implementation).
  void chip;
}

export class YM2151 {
  constructor(clock = 4000000, rate = 44100) {
    ym2151_init(this, clock, rate);
    ym2151_reset_chip(this);
  }

  reset() {
    ym2151_reset_chip(this);
  }

  shutdown() {
    ym2151_shutdown(this);
  }

  writeReg(reg, val) {
    ym2151_write_reg(this, reg, val);
  }

  updateOne(buffers, length) {
    ym2151_update_one(this, buffers, length);
  }

  readStatus() {
    return ym2151_read_status(this);
  }

  setMuteMask(mask) {
    ym2151_set_mutemask(this, mask);
  }
}
