export class FmDriver {
  constructor() {
    this.dataPtr = null;
    this.resetKeySyncImpl = null;
    this.setPmsAmsImpl = null;
    this.setPitchImpl = null;
    this.setTlImpl = null;
    this.noteOnImpl = null;
    this.noteOffImpl = null;
    this.writeOpmRegImpl = null;
    this.setPanImpl = null;
    this.setNoiseFreqImpl = null;
    this.loadVoiceImpl = null;
    this.loadLfoImpl = null;
  }

  resetKeySync(channel) { if (this.resetKeySyncImpl) this.resetKeySyncImpl(channel); }
  setPmsAms(channel, pmsAms) { if (this.setPmsAmsImpl) this.setPmsAmsImpl(channel, pmsAms); }
  setPitch(channel, pitch) { if (this.setPitchImpl) this.setPitchImpl(channel, pitch); }
  setTl(channel, tl, v) { if (this.setTlImpl) this.setTlImpl(channel, tl, v); }
  noteOn(channel, opMask, v) { if (this.noteOnImpl) this.noteOnImpl(channel, opMask, v); }
  noteOff(channel) { if (this.noteOffImpl) this.noteOffImpl(channel); }
  writeOpmReg(reg, val) { if (this.writeOpmRegImpl) this.writeOpmRegImpl(reg, val); }
  setPan(channel, pan, v) { if (this.setPanImpl) this.setPanImpl(channel, pan, v); }
  setNoiseFreq(channel, freq) { if (this.setNoiseFreqImpl) this.setNoiseFreqImpl(channel, freq); }
  loadVoice(channel, v, voiceNum, opmVolume, pan) {
    if (this.loadVoiceImpl) this.loadVoiceImpl(channel, v, voiceNum, opmVolume, pan);
  }
  loadLfo(channel, wave, freq, pmd, amd) {
    if (this.loadLfoImpl) this.loadLfoImpl(channel, wave, freq, pmd, amd);
  }
}
