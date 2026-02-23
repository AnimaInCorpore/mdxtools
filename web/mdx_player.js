import { mdxFileLoad, mdxErrorName } from "./mdx.js";
import { pdxFileLoad } from "./pdx.js";
import { PcmTimerDriver } from "./pcm_timer_driver.js";
import { AdpcmPcmMixDriver } from "./adpcm_pcm_mix_driver.js";
import { FmOpmEmuDriver } from "./fm_opm_emu_driver.js";
import { MdxDriver } from "./mdx_driver.js";
import { findPdxInFileIndex, normalizeLookupName } from "./tools.js";

export class BrowserMdxRenderer {
  constructor(sampleRate = 44100, blockSize = 2048) {
    this.sampleRate = sampleRate;
    this.blockSize = blockSize;
  }

  parseMdx(bytes) {
    const { err, file } = mdxFileLoad(bytes);
    if (err !== 0) {
      throw new Error(`MDX parse error: ${mdxErrorName(err)} (${err})`);
    }
    return file;
  }

  parsePdx(bytes) {
    const { err, file } = pdxFileLoad(bytes);
    if (err !== 0) {
      throw new Error(`PDX parse error: ${err}`);
    }
    return file;
  }

  async render(mdxBytes, pdxBytes = null, options = {}) {
    const mdxFile = this.parseMdx(mdxBytes);
    const pdxFile = pdxBytes ? this.parsePdx(pdxBytes) : null;

    const timerDriver = new PcmTimerDriver(this.sampleRate);
    const adpcmDriver = new AdpcmPcmMixDriver(this.sampleRate);
    const fmDriver = new FmOpmEmuDriver(null, this.sampleRate);
    const mdxDriver = new MdxDriver(timerDriver.timerDriver, fmDriver.fmDriver, adpcmDriver.adpcmDriver);
    mdxDriver.load(mdxFile, pdxFile);

    if (typeof options.maxLoops === "number") {
      mdxDriver.maxLoops = Math.max(0, options.maxLoops | 0);
    }

    const maxSeconds = options.maxSeconds || 600;
    const maxSamples = Math.floor(maxSeconds * this.sampleRate);

    const leftChunks = [];
    const rightChunks = [];
    let totalSamples = 0;

    const bufL = new Int32Array(this.blockSize);
    const bufR = new Int32Array(this.blockSize);
    const mixL = new Int32Array(this.blockSize);
    const mixR = new Int32Array(this.blockSize);
    const fmL = new Int32Array(this.blockSize);
    const fmR = new Int32Array(this.blockSize);
    const adpcmL = new Int32Array(this.blockSize);
    const adpcmR = new Int32Array(this.blockSize);

    while (!mdxDriver.ended && totalSamples < maxSamples) {
      mixL.fill(0);
      mixR.fill(0);
      let samplesRemaining = this.blockSize;
      let mixPos = 0;

      while (samplesRemaining > 0) {
        let samples = samplesRemaining;

        const timerSamples = timerDriver.estimate(samplesRemaining);
        if (timerSamples < samples) samples = timerSamples;

        const fmSamples = fmDriver.estimate(samplesRemaining);
        if (fmSamples < samples) samples = fmSamples;

        const adpcmSamples = adpcmDriver.estimate(samplesRemaining);
        if (adpcmSamples < samples) samples = adpcmSamples;

        if (samples <= 0) samples = 1;

        fmL.fill(0, 0, samples);
        fmR.fill(0, 0, samples);
        adpcmL.fill(0, 0, samples);
        adpcmR.fill(0, 0, samples);

        adpcmDriver.run(adpcmL, adpcmR, samples);
        fmDriver.run(fmL, fmR, samples);

        for (let i = 0; i < samples; i += 1) {
          mixL[mixPos + i] = fmL[i] + adpcmL[i];
          mixR[mixPos + i] = fmR[i] + adpcmR[i];
        }

        timerDriver.advance(samples);
        samplesRemaining -= samples;
        mixPos += samples;
      }

      for (let i = 0; i < this.blockSize; i += 1) {
        bufL[i] = mixL[i];
        bufR[i] = mixR[i];
      }

      leftChunks.push(Float32Array.from(bufL, (v) => Math.max(-1, Math.min(1, v / 32768))));
      rightChunks.push(Float32Array.from(bufR, (v) => Math.max(-1, Math.min(1, v / 32768))));
      totalSamples += this.blockSize;

      if (options.onProgress && (leftChunks.length % 12) === 0) {
        options.onProgress({
          totalSamples,
          seconds: totalSamples / this.sampleRate,
          ended: !!mdxDriver.ended,
        });
      }

      // Keep UI responsive on long renders.
      if ((leftChunks.length % 24) === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    const outLeft = new Float32Array(totalSamples);
    const outRight = new Float32Array(totalSamples);
    let pos = 0;
    for (let i = 0; i < leftChunks.length; i += 1) {
      outLeft.set(leftChunks[i], pos);
      outRight.set(rightChunks[i], pos);
      pos += leftChunks[i].length;
    }

    return {
      sampleRate: this.sampleRate,
      left: outLeft,
      right: outRight,
      durationSeconds: totalSamples / this.sampleRate,
      mdx: mdxFile,
      pdx: pdxFile,
      truncated: !mdxDriver.ended,
    };
  }

  async renderFromUploadedFiles(mdxFile, fileIndex, options = {}) {
    const mdxBytes = new Uint8Array(await mdxFile.arrayBuffer());
    const parsed = this.parseMdx(mdxBytes);

    let pdxBytes = null;
    if (parsed.pdxFilename) {
      const pdxFile = findPdxInFileIndex(mdxFile.name, parsed.pdxFilename, fileIndex);
      if (pdxFile) {
        pdxBytes = new Uint8Array(await pdxFile.arrayBuffer());
      }
    }

    const rendered = await this.render(mdxBytes, pdxBytes, options);
    return {
      ...rendered,
      mdxFile,
      pdxResolved: pdxBytes !== null,
      pdxName: parsed.pdxFilename,
    };
  }

  static pickMdxFiles(files) {
    return files
      .filter((f) => normalizeLookupName(f.name).endsWith(".mdx"))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
