import { gcd } from "./tools.js";
import { TimerDriver } from "./timer_driver.js";

export class PcmTimerDriver {
  constructor(sampleRate) {
    this.timerDriver = new TimerDriver();
    this.sampleRate = sampleRate;
    this.numerator = 0;
    this.denominator = 0;
    this.remainder = 0;

    this.timerDriver.setOpmTempo = (opmTempo) => {
      const clock = 4000000;
      const d = gcd(clock, 1024);
      const c1 = Math.floor(clock / d);
      const c2 = Math.floor(1024 / d);
      const s = this.sampleRate * c2;
      const d2 = gcd(c1, s);

      this.numerator = Math.floor((s * (256 - opmTempo)) / d2);
      this.denominator = Math.floor(c1 / d2);
    };
  }

  estimate(samples) {
    if (this.numerator <= 0 || this.denominator <= 0) return samples;

    let denom = this.remainder;
    for (let i = 1; i <= samples; i += 1) {
      denom += this.denominator;
      if (denom >= this.numerator) {
        return i;
      }
    }
    return samples;
  }

  advance(samples) {
    if (this.numerator <= 0 || this.denominator <= 0) return 0;

    let denom = this.remainder;
    let ticks = 0;
    for (let i = 1; i <= samples; i += 1) {
      denom += this.denominator;
      if (denom >= this.numerator) {
        if (this.timerDriver.tick) {
          this.timerDriver.tick(this.timerDriver, this.timerDriver.dataPtr);
        }
        ticks += 1;
        denom -= this.numerator;
      }
    }
    this.remainder = denom;
    return ticks;
  }

  deinit() {
    if (this.timerDriver && typeof this.timerDriver.deinit === "function") {
      this.timerDriver.deinit();
    }
    this.numerator = 0;
    this.denominator = 0;
    this.remainder = 0;
  }
}
