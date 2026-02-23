import { FmDriver } from "./fm_driver.js";

function mdxNoteToOpm(note) {
  const tbl = [0x0, 0x1, 0x2, 0x4, 0x5, 0x6, 0x8, 0x9, 0x0a, 0x0c, 0x0d, 0x0e];
  return Math.floor(note / 12) * 16 + tbl[note % 12];
}

export class FmOpmDriver {
  constructor(vgmLogger = null, options = {}) {
    const { autoReset = true } = options;
    this.fmDriver = new FmDriver();
    this.vgmLogger = vgmLogger;
    this.opmCache = new Uint8Array(256);
    this.writeImpl = null;

    this.fmDriver.resetKeySyncImpl = (channel) => {
      void channel;
      this.write(0x01, 0x02);
      this.write(0x01, 0x00);
    };

    this.fmDriver.setPmsAmsImpl = (channel, pmsAms) => {
      this.write(0x38 + channel, pmsAms);
    };

    this.fmDriver.setPitchImpl = (channel, pitch) => {
      this.write(0x28 + channel, mdxNoteToOpm(pitch >> 14));
      this.write(0x30 + channel, (pitch >> 6) & 0xfc);
    };

    this.fmDriver.setTlImpl = (channel, tl, v) => {
      const conMasks = [0x08, 0x08, 0x08, 0x08, 0x0c, 0x0e, 0x0e, 0x0f];
      const conMask = conMasks[v[1] & 0x07];
      let mask = 1;
      for (let i = 0; i < 4; i += 1, mask <<= 1) {
        const opVol = v[7 + i];
        if (conMask & mask) {
          const vol = Math.min(0x7f, tl + opVol);
          this.write(0x60 + i * 8 + channel, vol);
        } else {
          this.write(0x60 + i * 8 + channel, opVol);
        }
      }
    };

    this.fmDriver.noteOnImpl = (channel, opMask) => {
      this.write(0x08, ((opMask & 0x0f) << 3) | (channel & 0x07));
    };

    this.fmDriver.noteOffImpl = (channel) => {
      this.write(0x08, channel & 0x07);
    };

    this.fmDriver.writeOpmRegImpl = (reg, data) => {
      this.write(reg, data);
    };

    this.fmDriver.setPanImpl = (channel, pan, v) => {
      this.write(0x20 + channel, ((pan & 0x03) << 6) | v[1]);
    };

    this.fmDriver.setNoiseFreqImpl = (channel, freq) => {
      void channel;
      this.write(0x0f, freq & 0x1f);
    };

    this.fmDriver.loadVoiceImpl = (channel, v, voiceNum, opmVolume, pan) => {
      void voiceNum;
      if (!v) return;
      for (let i = 0; i < 4; i += 1) this.write(0x40 + i * 8 + channel, v[3 + i]);
      this.fmDriver.setTl(channel, opmVolume, v);
      for (let i = 0; i < 4; i += 1) this.write(0x80 + i * 8 + channel, v[11 + i]);
      for (let i = 0; i < 4; i += 1) this.write(0xa0 + i * 8 + channel, v[15 + i]);
      for (let i = 0; i < 4; i += 1) this.write(0xc0 + i * 8 + channel, v[19 + i]);
      for (let i = 0; i < 4; i += 1) this.write(0xe0 + i * 8 + channel, v[23 + i]);
      this.write(0x20 + channel, ((pan & 0x03) << 6) | v[1]);
    };

    this.fmDriver.loadLfoImpl = (channel, wave, freq, pmd, amd) => {
      void channel;
      this.write(0x19, 0x00);
      this.write(0x1b, wave & 0x03);
      this.write(0x18, freq);
      if (pmd & 0x7f) this.write(0x19, pmd);
      if (amd) this.write(0x19, amd);
    };

    if (autoReset) {
      this.resetRegisters();
    }
  }

  resetRegisters() {
    // Reset registers, ported from fm_opm_driver_init.
    for (let i = 0; i < 0x60; i += 1) this.write(i, 0x00);
    for (let i = 0x60; i < 0x80; i += 1) this.write(i, 0x7f);
    for (let i = 0x80; i < 0xe0; i += 1) this.write(i, 0x00);
    for (let i = 0xe0; i <= 0xff; i += 1) this.write(i, 0x0f);
    for (let i = 0; i < 8; i += 1) this.write(0x08, i);
  }

  write(reg, val) {
    this.opmCache[reg & 0xff] = val & 0xff;
    if (this.writeImpl) {
      this.writeImpl(reg & 0xff, val & 0xff);
    }
    if (this.vgmLogger) {
      this.vgmLogger.writeYm2151(reg & 0xff, val & 0xff);
    }
  }
}
