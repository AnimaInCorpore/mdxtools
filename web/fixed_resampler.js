import { clampI16 } from "./tools.js";

export class FixedResampler {
  constructor(table, tableStep, numZeroCrossings, numerator, denominator) {
    this.table = table;
    this.tableStep = tableStep;
    this.numZeroCrossings = numZeroCrossings;
    this.numerator = numerator;
    this.denominator = denominator;
    this.counter = numerator;
    this.history = new Int32Array(numZeroCrossings * 2);
  }

  estimate(outputSamples) {
    let counter = this.counter;
    let ret = 0;
    for (let i = 0; i < outputSamples; i += 1) {
      counter += this.numerator;
      while (counter >= this.denominator) {
        counter -= this.denominator;
        ret += 1;
      }
    }
    return ret;
  }

  resample(input, inLenRef, output, outLenRef) {
    let ilen = inLenRef.value;
    let olen = outLenRef.value;
    let inPos = 0;
    let outPos = 0;

    while (olen > 0) {
      let x = 0;

      if (this.counter === 0) {
        x = this.history[this.numZeroCrossings - 1] | 0;
      } else {
        let h1 = 0;
        let h2 = this.numZeroCrossings;
        let f1 = ((this.numZeroCrossings - 1) * this.denominator + this.counter) * this.tableStep;
        let f2 = (this.denominator - this.counter) * this.tableStep;

        for (let i = 0; i < this.numZeroCrossings; i += 1) {
          x += ((this.history[h1] * this.table[f1]) / 32767) | 0;
          x += ((this.history[h2] * this.table[f2]) / 32767) | 0;
          h1 += 1;
          h2 += 1;
          f1 -= this.denominator * this.tableStep;
          f2 += this.denominator * this.tableStep;
        }
      }

      this.counter += this.numerator;
      while (this.counter >= this.denominator) {
        if (ilen <= 0) {
          inLenRef.value = inLenRef.value - ilen;
          outLenRef.value = outLenRef.value - olen;
          return 0;
        }

        const sample = input[inPos++] | 0;
        ilen -= 1;
        this.counter -= this.denominator;

        this.history.copyWithin(0, 1);
        this.history[this.history.length - 1] = sample;
      }

      output[outPos++] = clampI16(x);
      olen -= 1;
    }

    inLenRef.value = inLenRef.value - ilen;
    outLenRef.value = outLenRef.value - olen;
    return 0;
  }
}
