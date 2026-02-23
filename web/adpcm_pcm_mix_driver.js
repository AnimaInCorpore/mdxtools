import { AdpcmDriver } from "./adpcm_driver.js";
import { adpcmDecode, adpcmInit } from "./adpcm.js";
import { clampI16 } from "./tools.js";
import { FixedResampler } from "./fixed_resampler.js";
import { SINCTBL3 } from "./sinctbl3.js";
import { SINCTBL4 } from "./sinctbl4.js";
import {
  speex_resampler_init,
  speex_resampler_estimate,
  speex_resampler_process_int,
  SPEEX_RESAMPLER_QUALITY_DEFAULT,
} from "./speex_resampler.js";

function adpcmMixerCalcVol(vol) {
  const vol00To0f = [
    0x6b, 0x6f, 0x71, 0x74, 0x76, 0x79, 0x7b, 0x7d,
    0x80, 0x82, 0x84, 0x87, 0x8a, 0x8c, 0x8f, 0x91,
  ];
  const vol40ToA0 = [
    5, 6, 6, 7, 7, 8, 9, 10, 10, 11, 12, 14, 15, 16, 18, 20, 21,
    23, 25, 29, 31, 33, 37, 41, 46, 50, 54, 60, 66, 72, 80, 89,
    97, 107, 117, 130, 142, 156, 173, 189, 205, 226, 246, 267,
    308, 328, 369, 410, 431, 492, 533, 594, 656, 717, 799, 861,
    963, 1045, 1147, 1270, 1393, 1536, 1700, 1864, 2048, 2253,
    2479, 2724, 2991, 3298, 3625, 3994, 4383, 4834, 5325, 5837,
    6431, 7087, 7783, 8561, 9442, 10363, 11387, 12555, 13824,
    15217, 16733, 18371, 20255, 22221, 24454, 26932, 29696,
    32768, 36127, 39732, 43541,
  ];

  if (vol <= 15) {
    return vol40ToA0[vol00To0f[vol] - 0x40];
  }
  if (vol >= 0x40 && vol <= 0xa0) {
    return vol40ToA0[vol - 0x40];
  }
  return 0;
}

function decodeAdpcmData(data, len) {
  const src = data.subarray(0, len);
  const out = new Int16Array(src.length * 2);
  const st = { last: 0, stepIndex: 0 };
  adpcmInit(st);
  let w = 0;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    out[w++] = adpcmDecode(c & 0x0f, st);
    out[w++] = adpcmDecode((c >> 4) & 0x0f, st);
  }
  return out;
}

class MixChannel {
  constructor() {
    this.freqNum = 4;
    this.volume = adpcmMixerCalcVol(15);
    this.decoded = null;
    this.srcPos = 0;
  }

  active() {
    return !!this.decoded && this.srcPos < this.decoded.length;
  }

  stop() {
    this.decoded = null;
    this.srcPos = 0;
  }
}

export class AdpcmPcmMixDriver {
  constructor(sampleRate = 44100) {
    this.sampleRate = sampleRate;
    this.adpcmDriver = new AdpcmDriver();
    this.channels = new Array(8).fill(null).map(() => new MixChannel());
    this.sampleCache = new WeakMap();

    // Fixed-point sinc resamplers: upsample each ADPCM clock to 15625 Hz.
    // Parameters match C: fixed_resampler_init(table, tableStep, numZeroCrossings, numerator, denominator)
    this.resamplers = [
      new FixedResampler(SINCTBL4, 1, 26, 1, 4), //  3906.25 Hz → 15625 Hz
      new FixedResampler(SINCTBL3, 1, 26, 1, 3), //  5208.33 Hz → 15625 Hz
      new FixedResampler(SINCTBL4, 2, 26, 1, 2), //  7812.50 Hz → 15625 Hz
      new FixedResampler(SINCTBL3, 1, 26, 2, 3), // 10416.67 Hz → 15625 Hz
    ];

    // Final resampler: 15625 Hz → output sample rate (2 channels: L=0, R=1).
    const errRef = { value: 0 };
    this.outputResampler = speex_resampler_init(
      2, 15625, sampleRate, SPEEX_RESAMPLER_QUALITY_DEFAULT, errRef
    );

    this.adpcmDriver.playImpl = (channel, data, len, freq, vol) => this.play(channel, data, len, freq, vol);
    this.adpcmDriver.stopImpl = (channel) => this.stop(channel);
    this.adpcmDriver.setFreqImpl = (channel, freq) => this.setFreq(channel, freq);
    this.adpcmDriver.setVolumeImpl = (channel, vol) => this.setVolume(channel, vol);
    this.adpcmDriver.setPanImpl = (pan) => {
      this.adpcmDriver.pan = pan & 0x03;
      return 0;
    };
  }

  play(channel, data, len, freqNum, volume) {
    const ch = this.channels[channel & 0x07];
    let decoded = this.sampleCache.get(data);
    if (!decoded || decoded.__len !== len) {
      decoded = decodeAdpcmData(data, len);
      decoded.__len = len;
      this.sampleCache.set(data, decoded);
    }

    ch.decoded = decoded;
    ch.srcPos = 0;
    ch.freqNum = Math.max(0, Math.min(4, freqNum | 0));
    ch.volume = adpcmMixerCalcVol(volume & 0xff);
    return 0;
  }

  stop(channel) {
    this.channels[channel & 0x07].stop();
    return 0;
  }

  setFreq(channel, freqNum) {
    const ch = this.channels[channel & 0x07];
    ch.freqNum = Math.max(0, Math.min(4, freqNum | 0));
    return 0;
  }

  setVolume(channel, vol) {
    this.channels[channel & 0x07].volume = adpcmMixerCalcVol(vol & 0xff);
    return 0;
  }

  estimate(bufSize) {
    const inLen = { value: 1 };
    const outLen = { value: bufSize };
    speex_resampler_estimate(this.outputResampler, 0, inLen, outLen);
    return outLen.value;
  }

  run(bufL, bufR, bufSize) {
    // Intermediate buffer size at 15625 Hz.
    // +1 ensures the output resampler always has enough input to produce bufSize samples.
    const interSize = Math.ceil(bufSize * 15625 / this.sampleRate) + 1;

    // Accumulate all ADPCM channels into a 15625 Hz stereo intermediate buffer.
    const mixL = new Int32Array(interSize);
    const mixR = new Int32Array(interSize);
    const pan = this.adpcmDriver.pan;

    // Stage 1: freqs 0–3 — decode ADPCM source samples, upsample to 15625 Hz via sinc resampler.
    for (let freqNum = 0; freqNum < 4; freqNum += 1) {
      const resampler = this.resamplers[freqNum];
      // How many source (ADPCM-rate) samples are needed to produce interSize intermediate samples?
      const srcNeeded = resampler.estimate(interSize);
      const srcBuf = new Int32Array(srcNeeded);
      let anyActive = false;

      for (let c = 0; c < 8; c += 1) {
        const ch = this.channels[c];
        if (!ch.active() || ch.freqNum !== freqNum) continue;
        anyActive = true;
        const data = ch.decoded;
        const vol = ch.volume;
        let pos = ch.srcPos;

        for (let k = 0; k < srcNeeded; k += 1) {
          if (pos >= data.length) { ch.stop(); break; }
          srcBuf[k] += (vol * data[pos++]) / 1024 | 0;
        }
        if (ch.active()) ch.srcPos = pos;
      }

      if (!anyActive) continue;

      const dstBuf = new Int16Array(interSize);
      const inLenRef = { value: srcNeeded };
      const outLenRef = { value: interSize };
      resampler.resample(srcBuf, inLenRef, dstBuf, outLenRef);
      const produced = outLenRef.value;

      for (let k = 0; k < produced; k += 1) {
        if (pan & 0x01) mixL[k] += dstBuf[k];
        if (pan & 0x02) mixR[k] += dstBuf[k];
      }
    }

    // Stage 2: freq 4 (15625 Hz) — direct mix; defer srcPos update until after speex call
    // so we only advance by the number of intermediate samples actually consumed.
    const freq4Indices = [];
    const freq4StartPos = [];

    for (let c = 0; c < 8; c += 1) {
      const ch = this.channels[c];
      if (!ch.active() || ch.freqNum !== 4) continue;
      freq4Indices.push(c);
      freq4StartPos.push(ch.srcPos);
      const data = ch.decoded;
      const vol = ch.volume;
      let pos = ch.srcPos;

      for (let k = 0; k < interSize; k += 1) {
        if (pos >= data.length) { ch.stop(); break; }
        const sample = (vol * data[pos++]) / 1024 | 0;
        if (pan & 0x01) mixL[k] += sample;
        if (pan & 0x02) mixR[k] += sample;
      }
      // srcPos will be updated after the speex call.
    }

    // Clamp intermediate mix buffer to 16-bit range before final resampling.
    for (let i = 0; i < interSize; i += 1) {
      mixL[i] = clampI16(mixL[i]);
      mixR[i] = clampI16(mixR[i]);
    }

    // Stage 3: resample from 15625 Hz to output sample rate.
    const inLenL = { value: interSize };
    const outLenL = { value: bufSize };
    speex_resampler_process_int(this.outputResampler, 0, mixL, inLenL, bufL, outLenL);

    const inLenR = { value: interSize };
    const outLenR = { value: bufSize };
    speex_resampler_process_int(this.outputResampler, 1, mixR, inLenR, bufR, outLenR);

    // Now update freq-4 channel positions by the number of intermediate samples consumed.
    // Use the smaller of the two channel consumed counts to stay in sync.
    const consumedInter = Math.min(inLenL.value, inLenR.value);
    for (let i = 0; i < freq4Indices.length; i += 1) {
      const ch = this.channels[freq4Indices[i]];
      if (!ch.active()) continue; // already stopped during mixing
      const newPos = freq4StartPos[i] + consumedInter;
      if (newPos >= ch.decoded.length) {
        ch.stop();
      } else {
        ch.srcPos = newPos;
      }
    }

    // Zero any output samples the resampler didn't fill (should not happen in normal operation).
    for (let i = outLenL.value; i < bufSize; i += 1) bufL[i] = 0;
    for (let i = outLenR.value; i < bufSize; i += 1) bufR[i] = 0;

    return 0;
  }
}
