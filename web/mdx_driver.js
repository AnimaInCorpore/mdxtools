import { mdxCmdLen } from "./mdx.js";
import { toSigned16 } from "./tools.js";

function mdxVolumeToOpm(vol) {
  const table = [
    0x2a, 0x28, 0x25, 0x22,
    0x20, 0x1d, 0x1a, 0x18,
    0x15, 0x12, 0x10, 0x0d,
    0x0a, 0x08, 0x05, 0x02,
  ];
  if (vol <= 15) return table[vol];
  if (vol >= 128) return vol - 128;
  return 0;
}

function mdxAdpcmVolumeFromOpm(volume) {
  const pcmVolTable = [
    0x0f, 0x0f, 0x0f, 0x0e, 0x0e, 0x0e, 0x0d, 0x0d,
    0x0d, 0x0c, 0x0c, 0x0b, 0x0b, 0x0b, 0x0a, 0x0a,
    0x0a, 0x09, 0x09, 0x08, 0x08, 0x08, 0x07, 0x07,
    0x07, 0x06, 0x06, 0x05, 0x05, 0x05, 0x04, 0x04,
    0x04, 0x03, 0x03, 0x02, 0x02, 0x02, 0x01, 0x01,
    0x01, 0x00, 0x00,
  ];
  return volume < pcmVolTable.length ? pcmVolTable[volume] : 0;
}

function lfoInit(lfo, waveform, period, amplitude) {
  lfo.enable = 1;
  lfo.waveform = waveform;
  lfo.period = period;
  lfo.amplitude = amplitude;
}

function lfoStart(lfo) {
  lfo.phase = 0;
  lfo.pitch = 0;
  if (lfo.waveform === 0 || lfo.waveform === 2) {
    lfo.phase = Math.floor(lfo.period / 2);
  }
  if (lfo.waveform === 2) {
    lfo.pitch = lfo.amplitude * 2;
  }
}

function lfoTick(lfo) {
  if (lfo.enable && lfo.period > 0) {
    lfo.phase += 1;
    let phaseReset = false;
    if (lfo.phase >= lfo.period) {
      phaseReset = true;
      lfo.phase = 0;
    }

    if (lfo.waveform === 0) {
      if (phaseReset) lfo.pitch = Math.trunc(-lfo.amplitude * lfo.period / 2);
      else lfo.pitch += lfo.amplitude;
    } else if (lfo.waveform === 1) {
      lfo.pitch = lfo.amplitude;
      if (phaseReset) lfo.amplitude = -lfo.amplitude;
    } else if (lfo.waveform === 2) {
      if (phaseReset) lfo.amplitude = -lfo.amplitude;
      lfo.pitch += lfo.amplitude;
    }
  }
  return lfo.pitch;
}

function makeTrack() {
  return {
    data: new Uint8Array(0),
    len: 0,
    pos: 0,
    used: 0,
    ended: 0,
    waiting: 0,
    loopNum: 0,
    ticksRemaining: 0,
    volume: 8,
    opmVolume: mdxVolumeToOpm(8),
    keyOnDelay: 0,
    keyOnDelayCounter: 0,
    staccato: 8,
    staccatoCounter: 0,
    voiceNum: -1,
    note: -1,
    pan: 3,
    pitch: 0,
    adpcmFreqNum: 4,
    detune: 0,
    portamento: 0,
    skipNoteOff: 0,
    skipNoteOn: 0,
    lfoDelay: 0,
    lfoDelayCounter: 0,
    pitchLfo: { enable: 0, waveform: 0, period: 0, amplitude: 0, phase: 0, pitch: 0 },
    amplitudeLfo: { enable: 0, waveform: 0, period: 0, amplitude: 0, phase: 0, pitch: 0 },
    pmsAms: 0,
    keysync: 0,
    mhon: 0,
    loopCounters: new Map(),
  };
}

function resetTrack(t) {
  const n = makeTrack();
  Object.assign(t, n);
}

export class MdxDriver {
  constructor(timerDriver, fmDriver, adpcmDriver) {
    this.timerDriver = timerDriver;
    this.fmDriver = fmDriver;
    this.adpcmDriver = adpcmDriver;

    this.mdxFile = null;
    this.pdxFile = null;

    this.tracks = new Array(16).fill(null).map(() => makeTrack());

    this.ended = 0;
    this.fadeRate = 0;
    this.fadeCounter = 0;
    this.fadeValue = 0;
    this.trackMask = 0xffff;
    this.curLoop = 0;
    this.maxLoops = 2;

    this.dataPtr = null;
    this.setTempo = null;
    this.unknownCommandCb = null;

    if (this.timerDriver) {
      this.timerDriver.setTickCallback(() => this.tick(), this);
      const bpmTempo = 120;
      const opmTempo = 256 - Math.floor(78125 / (16 * bpmTempo));
      this.timerDriver.setOpmTempoValue(opmTempo);
    }
  }

  startFadeout(rate) {
    if (this.fadeRate !== 0) return -1;
    this.fadeRate = Math.floor(rate / 2) + 1;
    this.fadeCounter = this.fadeRate;
    this.fadeValue = 0;
    return 0;
  }

  _endTrack(trackNum) {
    const track = this.tracks[trackNum];
    track.ended = 1;
    this.ended = 1;

    for (let i = 0; i < 16; i += 1) {
      if (this.tracks[i].used && !this.tracks[i].ended) {
        this.ended = 0;
        break;
      }
    }
  }

  _noteOn(trackNum) {
    if ((this.trackMask & (1 << trackNum)) === 0) return;
    const track = this.tracks[trackNum];

    if (trackNum < 8) {
      if (track.voiceNum >= 0) {
        const v = this.mdxFile?.voices[track.voiceNum] || null;
        if (v) {
          this.fmDriver.setPitch(trackNum, track.pitch);
          this.fmDriver.setTl(trackNum, track.opmVolume + this.fadeValue, v);

          if (track.skipNoteOn) {
            track.skipNoteOn = 0;
          } else {
            if (track.mhon) {
              this.fmDriver.setPmsAms(trackNum, track.pmsAms);
              if (track.keysync) this.fmDriver.resetKeySync(trackNum);
            }

            if (track.pitchLfo.enable) {
              if (track.lfoDelay) track.lfoDelayCounter = track.lfoDelay;
              else lfoStart(track.pitchLfo);
            }

            this.fmDriver.noteOn(trackNum, v[2], v);
          }
        }
      }
    } else if (track.note < 96 && this.pdxFile) {
      const sample = this.pdxFile.samples[track.note];
      if (sample && sample.data && sample.len > 0) {
        this.adpcmDriver.play(
          trackNum - 8,
          sample.data,
          sample.len,
          track.adpcmFreqNum,
          mdxAdpcmVolumeFromOpm(track.opmVolume + this.fadeValue)
        );
      } else {
        // Missing/empty sample entry: keep behavior safe and silent.
        this.adpcmDriver.stop(trackNum - 8);
      }
    }
  }

  _noteOff(trackNum) {
    if ((this.trackMask & (1 << trackNum)) === 0) return;

    const track = this.tracks[trackNum];
    if (track.note >= 0) {
      if (trackNum < 8) {
        if (track.skipNoteOff) {
          track.skipNoteOn = 1;
          track.skipNoteOff = 0;
        } else {
          this.fmDriver.noteOff(trackNum);
        }
      } else {
        this.adpcmDriver.stop(trackNum - 8);
      }
      track.note = -1;
    }
  }

  _trackAdvance(trackNum) {
    const track = this.tracks[trackNum];
    if (track.pos >= track.len) {
      this._endTrack(trackNum);
      return 0;
    }

    const c = track.data[track.pos];
    this._noteOff(trackNum);

    if (c <= 0x7f) {
      track.note = -1;
      track.ticksRemaining = c + 1;
      track.pos += 1;
      return track.ticksRemaining;
    }

    if (c <= 0xdf) {
      track.ticksRemaining = track.data[track.pos + 1] + 1;
      track.keyOnDelayCounter = 0;
      track.pos += 2;
      track.note = c & 0x7f;
      track.pitch = ((5 + (track.note << 6) + track.detune) << 8);

      if (track.staccato <= 8) {
        track.staccatoCounter = Math.floor((track.staccato * track.ticksRemaining) / 8);
      } else {
        track.staccatoCounter = track.ticksRemaining - (256 - track.staccato);
        if (track.staccatoCounter < 0) track.staccatoCounter = 0;
      }

      if (track.keyOnDelay) track.keyOnDelayCounter = track.keyOnDelay;
      else this._noteOn(trackNum);

      return track.ticksRemaining;
    }

    switch (c) {
      case 0xff: {
        const tempo = track.data[track.pos + 1];
        if (this.setTempo) this.setTempo(this, tempo, this.dataPtr);
        if (this.timerDriver) this.timerDriver.setOpmTempoValue(tempo);
        track.pos += 2;
        break;
      }
      case 0xfe:
        this.fmDriver.writeOpmReg(track.data[track.pos + 1], track.data[track.pos + 2]);
        track.pos += 3;
        break;
      case 0xfd:
        if (trackNum < 8) {
          track.voiceNum = track.data[track.pos + 1];
          this.fmDriver.loadVoice(
            trackNum,
            this.mdxFile.voices[track.voiceNum],
            track.voiceNum,
            track.opmVolume,
            track.pan
          );
        }
        track.pos += 2;
        break;
      case 0xfc:
        if (trackNum < 8) {
          const v = (track.voiceNum >= 0) ? this.mdxFile.voices[track.voiceNum] : null;
          if (v) {
            track.pan = track.data[track.pos + 1];
            this.fmDriver.setPan(trackNum, track.pan, v);
          }
        }
        track.pos += 2;
        break;
      case 0xfb:
        track.volume = track.data[track.pos + 1];
        track.opmVolume = mdxVolumeToOpm(track.volume);
        if (trackNum < 8) {
          if (track.voiceNum >= 0) {
            this.fmDriver.setTl(trackNum, track.opmVolume, this.mdxFile.voices[track.voiceNum]);
          }
        } else {
          this.adpcmDriver.setVolume(trackNum - 8, track.opmVolume);
        }
        track.pos += 2;
        break;
      case 0xfa:
        if (track.volume < 16 && track.volume > 0) track.volume -= 1;
        else if (track.volume >= 128 && track.volume < 255) track.volume += 1;
        track.opmVolume = mdxVolumeToOpm(track.volume);
        if (trackNum < 8) {
          if (track.voiceNum >= 0) {
            this.fmDriver.setTl(trackNum, track.opmVolume, this.mdxFile.voices[track.voiceNum]);
          }
        } else {
          this.adpcmDriver.setVolume(trackNum - 8, track.opmVolume);
        }
        track.pos += 1;
        break;
      case 0xf9:
        if (track.volume < 15) track.volume += 1;
        else if (track.volume > 128) track.volume -= 1;
        track.opmVolume = mdxVolumeToOpm(track.volume);
        if (trackNum < 8) {
          if (track.voiceNum >= 0) {
            this.fmDriver.setTl(trackNum, track.opmVolume, this.mdxFile.voices[track.voiceNum]);
          }
        } else {
          this.adpcmDriver.setVolume(trackNum - 8, track.opmVolume);
        }
        track.pos += 1;
        break;
      case 0xf8:
        track.staccato = track.data[track.pos + 1];
        track.pos += 2;
        break;
      case 0xf7:
        if (trackNum < 8) track.skipNoteOff = 1;
        track.pos += 1;
        break;
      case 0xf6:
        track.loopCounters.set(track.pos + 2, track.data[track.pos + 1]);
        track.pos += 3;
        break;
      case 0xf5: {
        const ofs = toSigned16((track.data[track.pos + 1] << 8) | track.data[track.pos + 2]);
        track.pos += 3;
        const counterAddr5 = track.pos + ofs - 1;
        if (counterAddr5 >= 0 && counterAddr5 < track.len) {
          const count5 = track.loopCounters.has(counterAddr5)
            ? track.loopCounters.get(counterAddr5)
            : track.data[counterAddr5];
          if (count5 > 1) {
            track.loopCounters.set(counterAddr5, count5 - 1);
            const newPos = track.pos + ofs;
            if (newPos >= 0 && newPos <= track.len) track.pos = newPos;
          } else {
            track.loopCounters.delete(counterAddr5);
          }
        }
        break;
      }
      case 0xf4: {
        const ofs = toSigned16((track.data[track.pos + 1] << 8) | track.data[track.pos + 2]);
        track.pos += 3;
        const repeatAddr = track.pos + ofs;
        if (repeatAddr >= 0 && repeatAddr + 1 < track.len) {
          const startOfs = toSigned16((track.data[repeatAddr] << 8) | track.data[repeatAddr + 1]);
          const counterAddr4 = track.pos + ofs + startOfs + 1;
          if (counterAddr4 >= 0 && counterAddr4 < track.len) {
            const count4 = track.loopCounters.has(counterAddr4)
              ? track.loopCounters.get(counterAddr4)
              : track.data[counterAddr4];
            if (count4 <= 1) {
              const newPos = track.pos + ofs + 2;
              if (newPos >= 0 && newPos <= track.len) track.pos = newPos;
            }
          }
        }
        break;
      }
      case 0xf3:
        if (trackNum < 8) {
          track.detune = toSigned16((track.data[track.pos + 1] << 8) | track.data[track.pos + 2]);
        }
        track.pos += 3;
        break;
      case 0xf2:
        if (trackNum < 8) {
          track.portamento = toSigned16((track.data[track.pos + 1] << 8) | track.data[track.pos + 2]);
        }
        track.pos += 3;
        break;
      case 0xf1:
        if (track.data[track.pos + 1] === 0) {
          this._endTrack(trackNum);
          track.pos += 2;
        } else {
          const ofs = toSigned16((track.data[track.pos + 1] << 8) | track.data[track.pos + 2]);
          track.loopNum += 1;

          if (this.fadeRate === 0 && this.maxLoops > 0) {
            let haveUnfinishedTrack = 0;
            for (let i = 0; i < this.mdxFile.numTracks; i += 1) {
              if (!this.tracks[i].used) continue;
              if (this.tracks[i].ended) continue;
              if (this.tracks[i].loopNum < this.maxLoops) {
                haveUnfinishedTrack = 1;
                break;
              }
            }
            if (!haveUnfinishedTrack) {
              this.fadeRate = 26;
              this.fadeCounter = this.fadeRate;
              this.fadeValue = 0;
            }
          }

          track.pos += ofs + 3;
        }
        break;
      case 0xf0:
        track.keyOnDelay = track.data[track.pos + 1];
        track.pos += 2;
        break;
      case 0xef: {
        const dst = track.data[track.pos + 1];
        if (dst < this.mdxFile.numTracks) this.tracks[dst].waiting = 0;
        track.pos += 2;
        break;
      }
      case 0xee:
        track.waiting = 1;
        track.pos += 1;
        break;
      case 0xed:
        if (trackNum < 8) {
          this.fmDriver.setNoiseFreq(trackNum, track.data[track.pos + 1]);
        } else {
          this.adpcmDriver.setFreq(trackNum - 8, track.data[track.pos + 1]);
        }
        track.pos += 2;
        break;
      case 0xec:
        if (track.data[track.pos + 1] === 0x80) {
          if (trackNum < 8) track.pitchLfo.enable = 0;
          track.pos += 2;
        } else if (track.data[track.pos + 1] === 0x81) {
          if (trackNum < 8) track.pitchLfo.enable = 1;
          track.pos += 2;
        } else {
          if (trackNum < 8) {
            lfoInit(
              track.pitchLfo,
              track.data[track.pos + 1],
              (track.data[track.pos + 2] << 8) | track.data[track.pos + 3],
              toSigned16((track.data[track.pos + 4] << 8) | track.data[track.pos + 5])
            );
          }
          track.pos += 6;
        }
        break;
      case 0xeb:
        if (track.data[track.pos + 1] === 0x80) {
          if (trackNum < 8) track.amplitudeLfo.enable = 0;
          track.pos += 2;
        } else if (track.data[track.pos + 1] === 0x81) {
          if (trackNum < 8) track.amplitudeLfo.enable = 1;
          track.pos += 2;
        } else {
          if (trackNum < 8) {
            lfoInit(
              track.amplitudeLfo,
              track.data[track.pos + 1],
              (track.data[track.pos + 2] << 8) | track.data[track.pos + 3],
              toSigned16((track.data[track.pos + 4] << 8) | track.data[track.pos + 5])
            );
          }
          track.pos += 6;
        }
        break;
      case 0xea:
        if (track.data[track.pos + 1] === 0x80) {
          track.mhon = 0;
          track.pos += 2;
        } else if (track.data[track.pos + 1] === 0x81) {
          track.mhon = 1;
          track.pos += 2;
        } else {
          track.keysync = track.data[track.pos + 1] & 0x40;
          track.pmsAms = track.data[track.pos + 5];
          track.mhon = 1;
          this.fmDriver.loadLfo(
            trackNum,
            track.data[track.pos + 1] & 0x03,
            track.data[track.pos + 2],
            track.data[track.pos + 3],
            track.data[track.pos + 4]
          );
          track.pos += 6;
        }
        break;
      case 0xe9:
        track.lfoDelay = track.data[track.pos + 1];
        track.pos += 2;
        break;
      default: {
        if (this.unknownCommandCb) {
          this.unknownCommandCb(this, trackNum, track.data[track.pos], this.dataPtr);
        }
        const l = mdxCmdLen(track.data, track.pos, track.len - track.pos);
        if (l < 0) this._endTrack(trackNum);
        else track.pos += l;
        break;
      }
    }

    return 0;
  }

  _trackTick(trackNum) {
    const track = this.tracks[trackNum];
    if (!track.used) return;
    if (track.ended || track.waiting) return;

    if (track.keyOnDelayCounter > 0) {
      track.keyOnDelayCounter -= 1;
      if (track.keyOnDelayCounter === 0 && track.staccatoCounter === 0) {
        this._noteOn(trackNum);
      }
    }

    track.staccatoCounter -= 1;
    if (track.staccatoCounter <= 0 && track.keyOnDelayCounter === 0) {
      this._noteOff(trackNum);
    }

    track.ticksRemaining -= 1;
    if (track.ticksRemaining === 0) track.portamento = 0;

    if (trackNum < 8) {
      if (track.portamento) track.pitch += track.portamento;

      let pitch = track.pitch;
      if (track.lfoDelayCounter) {
        track.lfoDelayCounter -= 1;
        if (track.lfoDelayCounter === 0) {
          if (track.pitchLfo.enable) lfoStart(track.pitchLfo);
          if (track.amplitudeLfo.enable) lfoStart(track.amplitudeLfo);
        }
      }

      if (track.pitchLfo.enable && track.lfoDelayCounter === 0) {
        pitch += track.pitchLfo.pitch;
        lfoTick(track.pitchLfo);
      }

      this.fmDriver.setPitch(trackNum, pitch);

      let opmVol = track.opmVolume + this.fadeValue;
      if (track.amplitudeLfo.enable && track.lfoDelayCounter === 0) {
        lfoTick(track.amplitudeLfo);
        opmVol += track.amplitudeLfo.pitch;
      }

      if (track.voiceNum >= 0) {
        const v = this.mdxFile.voices[track.voiceNum];
        if (v) this.fmDriver.setTl(trackNum, opmVol, v);
      }
    } else if (this.fadeValue) {
      this.adpcmDriver.setVolume(trackNum - 8, mdxAdpcmVolumeFromOpm(track.opmVolume + this.fadeValue));
    }

    while (track.ticksRemaining <= 0 && !track.ended) {
      this._trackAdvance(trackNum);
    }
  }

  tick() {
    if (!this.mdxFile || this.ended) return;

    if (this.fadeRate > 0) {
      this.fadeCounter -= 1;
      if (this.fadeCounter === 0) {
        this.fadeCounter = this.fadeRate;
        this.fadeValue += 1;
        if (this.fadeValue > 72) {
          this.ended = 1;
          return;
        }
      }
    }

    for (let i = 0; i < this.mdxFile.numTracks; i += 1) {
      this._trackTick(i);
    }
  }

  load(mdxFile, pdxFile) {
    if (!mdxFile) return 1;

    this.trackMask = 0xffff;
    this.ended = 0;
    this.maxLoops = 2;
    this.fadeRate = 0;
    this.fadeCounter = 0;
    this.fadeValue = 0;

    for (let i = 0; i < 16; i += 1) resetTrack(this.tracks[i]);

    this.mdxFile = mdxFile;
    this.pdxFile = pdxFile || null;

    for (let i = 0; i < 16; i += 1) {
      if (i < mdxFile.numTracks) {
        this.tracks[i].used = 1;
        this.tracks[i].data = mdxFile.tracks[i].data;
        this.tracks[i].len = mdxFile.tracks[i].dataLen;
      } else {
        this.tracks[i].used = 0;
      }
    }

    return 0;
  }
}
