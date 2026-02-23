export class TimerDriver {
  constructor() {
    this.dataPtr = null;
    this.tick = null;
    this.setOpmTempo = null;
  }

  setTickCallback(tick, dataPtr) {
    this.tick = tick;
    this.dataPtr = dataPtr;
  }

  setOpmTempoValue(opmTimer) {
    if (this.setOpmTempo) {
      this.setOpmTempo(opmTimer);
    }
  }
}
