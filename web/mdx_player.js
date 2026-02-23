import { mdxFileLoad, mdxErrorName } from "./mdx.js";
import { pdxFileLoad } from "./pdx.js";
import { PcmTimerDriver } from "./pcm_timer_driver.js";
import { AdpcmPcmMixDriver } from "./adpcm_pcm_mix_driver.js";
import { FmOpmEmuDriver } from "./fm_opm_emu_driver.js";
import { MdxDriver } from "./mdx_driver.js";
import { findPdxInFileIndex, normalizeLookupName } from "./tools.js";

function clampAudioSample(v) {
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}

function toValidMaxSamples(maxSeconds, sampleRate) {
  const seconds = Number.isFinite(maxSeconds) && maxSeconds > 0 ? maxSeconds : 600;
  return Math.max(1, Math.floor(seconds * sampleRate));
}

export class BrowserMdxStreamSession {
  constructor(sampleRate, blockSize, mdxFile, pdxFile, options = {}) {
    this.sampleRate = sampleRate;
    this.blockSize = blockSize;
    this.maxSamples = toValidMaxSamples(options.maxSeconds, sampleRate);

    this.timerDriver = new PcmTimerDriver(sampleRate);
    this.adpcmDriver = new AdpcmPcmMixDriver(sampleRate);
    this.fmDriver = new FmOpmEmuDriver(null, sampleRate);
    this.mdxDriver = new MdxDriver(
      this.timerDriver.timerDriver,
      this.fmDriver.fmDriver,
      this.adpcmDriver.adpcmDriver
    );
    this.mdxDriver.load(mdxFile, pdxFile);

    if (typeof options.maxLoops === "number") {
      this.mdxDriver.maxLoops = Math.max(0, options.maxLoops | 0);
    }

    this.totalSamples = 0;
    this.finished = false;
    this.truncated = false;

    this.tempCapacity = 0;
    this.fmL = null;
    this.fmR = null;
    this.adpcmL = null;
    this.adpcmR = null;
  }

  _ensureTempBuffers(size) {
    if (this.tempCapacity >= size) return;
    this.tempCapacity = size;
    this.fmL = new Int32Array(size);
    this.fmR = new Int32Array(size);
    this.adpcmL = new Int32Array(size);
    this.adpcmR = new Int32Array(size);
  }

  _refreshFinishedState() {
    if (this.finished) return;
    if (!this.mdxDriver) {
      this.finished = true;
      return;
    }
    if (this.mdxDriver.ended) {
      this.finished = true;
      return;
    }
    if (this.totalSamples >= this.maxSamples) {
      this.truncated = !this.mdxDriver.ended;
      this.finished = true;
    }
  }

  progress(producedSamples = 0) {
    return {
      producedSamples,
      totalSamples: this.totalSamples,
      seconds: this.totalSamples / this.sampleRate,
      finished: this.finished,
      ended: !!this.mdxDriver.ended,
      truncated: this.truncated,
    };
  }

  renderFloatBlock(outL, outR) {
    const blockSamples = Math.min(outL?.length || 0, outR?.length || 0);
    if (!this.mdxDriver || !this.timerDriver || !this.fmDriver || !this.adpcmDriver) {
      if (blockSamples > 0) {
        outL.fill(0);
        outR.fill(0);
      }
      this._refreshFinishedState();
      return this.progress(0);
    }

    if (blockSamples <= 0) {
      this._refreshFinishedState();
      return this.progress(0);
    }

    this._ensureTempBuffers(blockSamples);
    outL.fill(0);
    outR.fill(0);

    let produced = 0;
    while (produced < blockSamples) {
      this._refreshFinishedState();
      if (this.finished) break;

      let samples = blockSamples - produced;
      const sampleBudget = this.maxSamples - this.totalSamples;
      if (sampleBudget < samples) samples = sampleBudget;
      if (samples <= 0) break;

      const timerSamples = this.timerDriver.estimate(samples);
      if (timerSamples < samples) samples = timerSamples;

      const fmSamples = this.fmDriver.estimate(samples);
      if (fmSamples < samples) samples = fmSamples;

      const adpcmSamples = this.adpcmDriver.estimate(samples);
      if (adpcmSamples < samples) samples = adpcmSamples;

      if (samples <= 0) samples = 1;

      this.fmL.fill(0, 0, samples);
      this.fmR.fill(0, 0, samples);
      this.adpcmL.fill(0, 0, samples);
      this.adpcmR.fill(0, 0, samples);

      this.adpcmDriver.run(this.adpcmL, this.adpcmR, samples);
      this.fmDriver.run(this.fmL, this.fmR, samples);

      for (let i = 0; i < samples; i += 1) {
        outL[produced + i] = clampAudioSample((this.fmL[i] + this.adpcmL[i]) / 32768);
        outR[produced + i] = clampAudioSample((this.fmR[i] + this.adpcmR[i]) / 32768);
      }

      this.timerDriver.advance(samples);
      this.totalSamples += samples;
      produced += samples;
    }

    this._refreshFinishedState();
    return this.progress(produced);
  }

  dispose() {
    try {
      if (this.adpcmDriver && typeof this.adpcmDriver.deinit === "function") {
        this.adpcmDriver.deinit();
      }
    } finally {
      try {
        if (this.fmDriver && typeof this.fmDriver.deinit === "function") {
          this.fmDriver.deinit();
        }
      } finally {
        if (this.timerDriver && typeof this.timerDriver.deinit === "function") {
          this.timerDriver.deinit();
        }
      }
    }

    this.finished = true;
    this.mdxDriver = null;
    this.adpcmDriver = null;
    this.fmDriver = null;
    this.timerDriver = null;
    this.fmL = null;
    this.fmR = null;
    this.adpcmL = null;
    this.adpcmR = null;
  }
}

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

  _newSession(mdxFile, pdxFile, options = {}) {
    return new BrowserMdxStreamSession(
      this.sampleRate,
      this.blockSize,
      mdxFile,
      pdxFile,
      options
    );
  }

  async _renderSession(session, options = {}) {
    const leftChunks = [];
    const rightChunks = [];
    const blockL = new Float32Array(this.blockSize);
    const blockR = new Float32Array(this.blockSize);

    let blocks = 0;
    while (!session.finished) {
      const p = session.renderFloatBlock(blockL, blockR);
      if (p.producedSamples > 0) {
        leftChunks.push(blockL.slice(0, p.producedSamples));
        rightChunks.push(blockR.slice(0, p.producedSamples));
      }

      blocks += 1;

      if (options.onProgress && (blocks % 12) === 0) {
        options.onProgress({
          totalSamples: p.totalSamples,
          seconds: p.seconds,
          ended: p.ended,
        });
      }

      // Keep UI responsive on long renders.
      if ((blocks % 24) === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      if (p.finished && p.producedSamples === 0) {
        break;
      }
    }

    const outLeft = new Float32Array(session.totalSamples);
    const outRight = new Float32Array(session.totalSamples);
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
      durationSeconds: session.totalSamples / this.sampleRate,
      truncated: session.truncated,
    };
  }

  createStreamSession(mdxBytes, pdxBytes = null, options = {}) {
    const mdxFile = this.parseMdx(mdxBytes);
    const pdxFile = pdxBytes ? this.parsePdx(pdxBytes) : null;

    return {
      session: this._newSession(mdxFile, pdxFile, options),
      mdx: mdxFile,
      pdx: pdxFile,
    };
  }

  async createStreamSessionFromUploadedFiles(mdxFile, fileIndex, options = {}) {
    const mdxBytes = new Uint8Array(await mdxFile.arrayBuffer());
    const parsedMdx = this.parseMdx(mdxBytes);

    let pdxBytes = null;
    if (parsedMdx.pdxFilename) {
      const pdxFile = findPdxInFileIndex(mdxFile.name, parsedMdx.pdxFilename, fileIndex);
      if (pdxFile) {
        pdxBytes = new Uint8Array(await pdxFile.arrayBuffer());
      }
    }

    const parsedPdx = pdxBytes ? this.parsePdx(pdxBytes) : null;
    return {
      session: this._newSession(parsedMdx, parsedPdx, options),
      mdx: parsedMdx,
      pdx: parsedPdx,
      mdxFile,
      pdxResolved: pdxBytes !== null,
      pdxName: parsedMdx.pdxFilename,
    };
  }

  async render(mdxBytes, pdxBytes = null, options = {}) {
    const { session, mdx, pdx } = this.createStreamSession(mdxBytes, pdxBytes, options);
    try {
      const rendered = await this._renderSession(session, options);
      return {
        ...rendered,
        mdx,
        pdx,
      };
    } finally {
      session.dispose();
    }
  }

  async renderFromUploadedFiles(mdxFile, fileIndex, options = {}) {
    const prepared = await this.createStreamSessionFromUploadedFiles(mdxFile, fileIndex, options);
    try {
      const rendered = await this._renderSession(prepared.session, options);
      return {
        ...rendered,
        mdx: prepared.mdx,
        pdx: prepared.pdx,
        mdxFile,
        pdxResolved: prepared.pdxResolved,
        pdxName: prepared.pdxName,
      };
    } finally {
      prepared.session.dispose();
    }
  }

  static pickMdxFiles(files) {
    return files
      .filter((f) => normalizeLookupName(f.name).endsWith(".mdx"))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
