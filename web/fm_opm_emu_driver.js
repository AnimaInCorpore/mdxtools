import { FmOpmDriver } from "./fm_opm_driver.js";
import { YM2151 } from "./ym2151.js";

export class FmOpmEmuDriver {
  constructor(vgmLogger = null, sampleRate = 44100) {
    this.sampleRate = sampleRate;
    this.opm = new YM2151(4000000, sampleRate);
    this.fmOpmDriver = new FmOpmDriver(vgmLogger, { autoReset: false });
    this.fmDriver = this.fmOpmDriver.fmDriver;

    this.fmOpmDriver.writeImpl = (reg, val) => {
      this.opm.writeReg(reg, val);
    };
    this.fmOpmDriver.resetRegisters();
  }

  deinit() {
    this.opm.shutdown();
  }

  estimate(numSamples) {
    return numSamples;
  }

  run(outL, outR, numSamples) {
    this.opm.updateOne([outL, outR], numSamples);
    for (let i = 0; i < numSamples; i += 1) {
      outL[i] = (outL[i] / 2) | 0;
      outR[i] = (outR[i] / 2) | 0;
    }
  }
}
