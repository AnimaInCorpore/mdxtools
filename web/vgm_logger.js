export class VgmLogger {
  constructor() {
    this.totalSamples = 0;
    this.totalBytes = 0;
    this.waitCumulative = 0;
    this.enabled = false;
    this.events = [];
  }

  init() {
    this.totalSamples = 0;
    this.totalBytes = 0;
    this.waitCumulative = 0;
    this.events = [];
    this.enabled = true;
    return 0;
  }

  writeWait(wait) {
    this.waitCumulative += wait;
    return this.waitCumulative;
  }

  writeYm2151(reg, val) {
    if (!this.enabled) return 0;
    this.events.push({ t: this.totalSamples + this.waitCumulative, type: "ym2151", reg, val });
    return this.events.length;
  }

  writeOkim6258(port, val) {
    if (!this.enabled) return 0;
    this.events.push({ t: this.totalSamples + this.waitCumulative, type: "okim6258", port, val });
    return this.events.length;
  }

  end() {
    this.enabled = false;
    return 0;
  }
}
