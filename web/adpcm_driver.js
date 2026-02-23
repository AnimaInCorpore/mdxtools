export class AdpcmDriver {
  constructor() {
    this.pan = 3;
    this.playImpl = null;
    this.stopImpl = null;
    this.setVolumeImpl = null;
    this.setFreqImpl = null;
    this.setPanImpl = null;
  }

  play(channel, data, len, freq, vol) {
    return this.playImpl ? this.playImpl(channel, data, len, freq, vol) : 0;
  }

  stop(channel) {
    if (this.stopImpl) this.stopImpl(channel);
    return 0;
  }

  setFreq(channel, freq) {
    if (this.setFreqImpl) this.setFreqImpl(channel, freq);
    return 0;
  }

  setVolume(channel, vol) {
    if (this.setVolumeImpl) this.setVolumeImpl(channel, vol);
    return 0;
  }

  setPan(pan) {
    if (this.setPanImpl) this.setPanImpl(pan);
    return 0;
  }
}
