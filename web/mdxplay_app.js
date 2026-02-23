import { BrowserMdxRenderer } from "./mdx_player.js";
import { mdxFileLoad, mdxCmdLen, mdxErrorName } from "./mdx.js";
import { makeFileIndex, formatSeconds, normalizeLookupName, findPdxInFileIndex } from "./tools.js";

const DEFAULT_SAMPLE_RATE = 44100;
const DEFAULT_BLOCK_SIZE = 2048;

const els = {
  drop: document.getElementById("drop-zone"),
  picker: document.getElementById("file-picker"),
  browseBtn: document.getElementById("browse-btn"),
  clearBtn: document.getElementById("clear-btn"),
  tracks: document.getElementById("track-list"),
  status: document.getElementById("status"),
  nowPlaying: document.getElementById("now-playing"),
  stopBtn: document.getElementById("stop-btn"),
  loops: document.getElementById("loops"),
  maxSeconds: document.getElementById("max-seconds"),
};

const state = {
  files: [],
  fileIndex: new Map(),
  mdxFiles: [],
  trackInfoByKey: new Map(),
  trackInfoToken: 0,
  playTimeQueue: Promise.resolve(),
  audioContext: null,
  renderer: null,
  infoRenderer: null,
  playback: null,
  playingName: null,
  renderToken: 0,
};

function setStatus(msg) {
  els.status.textContent = msg;
}

function getRenderer(sampleRate) {
  if (!state.renderer || state.renderer.sampleRate !== sampleRate) {
    state.renderer = new BrowserMdxRenderer(sampleRate, DEFAULT_BLOCK_SIZE);
  }
  return state.renderer;
}

function getInfoRenderer() {
  if (!state.infoRenderer || state.infoRenderer.sampleRate !== DEFAULT_SAMPLE_RATE) {
    state.infoRenderer = new BrowserMdxRenderer(DEFAULT_SAMPLE_RATE, DEFAULT_BLOCK_SIZE);
  }
  return state.infoRenderer;
}

function buildPdxInfo(pdxName, pdxResolved) {
  if (!pdxName) return "No PDX";
  return pdxResolved ? `PDX: ${pdxName}` : `PDX missing: ${pdxName}`;
}

function fileKey(file) {
  return normalizeLookupName(file.name);
}

function formatBytes(numBytes) {
  if (!Number.isFinite(numBytes) || numBytes < 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  let value = numBytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  if (unit === 0) {
    return `${Math.floor(value)} ${units[unit]}`;
  }
  if (value >= 100) {
    return `${value.toFixed(0)} ${units[unit]}`;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function analyzeTrackCommands(mdxFile) {
  const cmdCounts = new Array(16).fill(0);
  let pcm8 = false;

  for (let i = 0; i < mdxFile.numTracks; i += 1) {
    const track = mdxFile.tracks[i];
    for (let pos = 0; pos < track.dataLen;) {
      const cmdLen = mdxCmdLen(track.data, pos, track.dataLen - pos);
      if (cmdLen < 0) break;

      cmdCounts[i] += 1;
      const cmd = track.data[pos];
      if (cmd === 0xe8) pcm8 = true;
      if (cmd === 0xf1 && pos < track.dataLen - 1 && track.data[pos + 1] === 0) {
        break;
      }

      pos += cmdLen;
    }
  }

  let totalCommands = 0;
  for (let i = 0; i < mdxFile.numTracks; i += 1) {
    totalCommands += cmdCounts[i];
  }

  return { pcm8, totalCommands };
}

function getTrackInfoOptions() {
  const loops = Number.parseInt(els.loops.value, 10);
  const maxSeconds = Number.parseInt(els.maxSeconds.value, 10);
  const maxLoops = Number.isFinite(loops) ? Math.max(0, loops | 0) : 2;
  const maxSecs = Number.isFinite(maxSeconds) && maxSeconds > 0 ? maxSeconds : 600;
  return { maxLoops, maxSeconds: maxSecs };
}

async function estimatePlayTimeSeconds(mdxBytes, pdxBytes, options) {
  const renderer = getInfoRenderer();
  const prepared = renderer.createStreamSession(mdxBytes, pdxBytes, {
    maxLoops: options.maxLoops,
    maxSeconds: options.maxSeconds,
  });

  const session = prepared.session;
  const outL = new Float32Array(DEFAULT_BLOCK_SIZE);
  const outR = new Float32Array(DEFAULT_BLOCK_SIZE);
  let p = session.progress(0);
  let blocks = 0;

  try {
    while (!p.finished) {
      p = session.renderFloatBlock(outL, outR);
      blocks += 1;

      // Yield periodically while estimating many tracks.
      if ((blocks % 24) === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  } finally {
    session.dispose();
  }

  return {
    seconds: p.seconds,
    truncated: p.truncated,
  };
}

async function loadTrackInfoBase(file, fileIndex) {
  const mdxBytes = new Uint8Array(await file.arrayBuffer());
  const parsed = mdxFileLoad(mdxBytes);

  if (parsed.err !== 0 || !parsed.file) {
    return {
      info: {
        error: mdxErrorName(parsed.err),
        fileSize: file.size,
      },
      mdxBytes: null,
      pdxBytes: null,
    };
  }

  const mdx = parsed.file;
  const cmdStats = analyzeTrackCommands(mdx);
  const pdxName = mdx.pdxFilename || "";
  let pdxResolved = !pdxName;
  let pdxBytes = null;
  if (pdxName) {
    const pdxFile = findPdxInFileIndex(file.name, pdxName, fileIndex);
    if (pdxFile) {
      pdxResolved = true;
      pdxBytes = new Uint8Array(await pdxFile.arrayBuffer());
    }
  }

  return {
    info: {
      title: String(mdx.title || "").trim(),
      pdxName,
      pdxResolved,
      fileSize: mdx.dataLen,
      dataSize: Math.max(0, mdx.dataLen - mdx.dataStartOfs),
      numTracks: mdx.numTracks,
      numVoices: mdx.numVoices,
      pcm8: cmdStats.pcm8,
      totalCommands: cmdStats.totalCommands,
      playTimePending: true,
      playTimeSeconds: null,
      playTimeTruncated: false,
      playTimeError: "",
    },
    mdxBytes,
    pdxBytes,
  };
}

function queuePlayTimeEstimate(token, key, mdxBytes, pdxBytes, options) {
  state.playTimeQueue = state.playTimeQueue.then(async () => {
    if (token !== state.trackInfoToken) return;

    let info = state.trackInfoByKey.get(key);
    if (!info || info.error) return;

    try {
      const playTime = await estimatePlayTimeSeconds(mdxBytes, pdxBytes, options);
      if (token !== state.trackInfoToken) return;

      info = state.trackInfoByKey.get(key);
      if (!info || info.error) return;
      info.playTimeSeconds = playTime.seconds;
      info.playTimeTruncated = playTime.truncated;
      info.playTimeError = "";
    } catch (err) {
      if (token !== state.trackInfoToken) return;

      info = state.trackInfoByKey.get(key);
      if (!info || info.error) return;
      info.playTimeError = err instanceof Error ? err.message : String(err);
    }

    if (token !== state.trackInfoToken) return;
    info = state.trackInfoByKey.get(key);
    if (!info || info.error) return;
    info.playTimePending = false;
    renderTrackList();
  });
}

async function populateTrackInfo(token, options) {
  for (const file of state.mdxFiles) {
    if (token !== state.trackInfoToken) return;

    const key = fileKey(file);
    if (state.trackInfoByKey.has(key)) continue;

    let loaded;
    try {
      loaded = await loadTrackInfoBase(file, state.fileIndex);
    } catch (err) {
      loaded = {
        info: {
          error: err instanceof Error ? err.message : String(err),
          fileSize: file.size,
        },
        mdxBytes: null,
        pdxBytes: null,
      };
    }

    if (token !== state.trackInfoToken) return;
    state.trackInfoByKey.set(key, loaded.info);
    renderTrackList();

    if (!loaded.info.error && loaded.mdxBytes) {
      queuePlayTimeEstimate(token, key, loaded.mdxBytes, loaded.pdxBytes, options);
    }
  }
}

function appendMetaLine(parent, className, text) {
  const line = document.createElement("div");
  line.className = className;
  line.textContent = text;
  parent.append(line);
}

function getTotalTimeLabel(fileName) {
  const info = state.trackInfoByKey.get(normalizeLookupName(fileName));
  if (!info || info.error || info.playTimePending || info.playTimeError) return "";
  const total = formatSeconds(info.playTimeSeconds || 0);
  return info.playTimeTruncated ? `${total} (max)` : total;
}

function updateNowPlaying(playback, seconds) {
  const elapsed = formatSeconds(seconds);
  const total = getTotalTimeLabel(playback.fileName);
  const timeText = total ? `${elapsed} / ${total}` : elapsed;
  els.nowPlaying.textContent = `${playback.fileName} • ${timeText} • ${playback.pdxInfo}`;
}

function schedulePlaybackUi(playback) {
  if (playback.uiScheduled) return;
  playback.uiScheduled = true;

  requestAnimationFrame(() => {
    playback.uiScheduled = false;
    if (state.playback !== playback) return;

    if (playback.pendingNowPlayingSeconds !== null) {
      updateNowPlaying(playback, playback.pendingNowPlayingSeconds);
      playback.pendingNowPlayingSeconds = null;
    }
  });
}

function stopPlayback() {
  if (state.playback) {
    const playback = state.playback;
    state.playback = null;

    try { playback.node.onaudioprocess = null; } catch {}
    try { playback.node.disconnect(); } catch {}
    try { playback.gain.disconnect(); } catch {}
    try { playback.session.dispose(); } catch {}
  }

  state.playingName = null;
  els.nowPlaying.textContent = "Nothing playing";
}

async function ensureAudioContext() {
  if (!state.audioContext) {
    state.audioContext = new AudioContext({ sampleRate: DEFAULT_SAMPLE_RATE, latencyHint: "interactive" });
  }
  if (state.audioContext.state === "suspended") {
    await state.audioContext.resume();
  }
  return state.audioContext;
}

function startStreamPlayback(ctx, token, fileName, prepared, maxSeconds) {
  // TODO: add AudioWorklet backend and keep ScriptProcessor as fallback.
  if (typeof ctx.createScriptProcessor !== "function") {
    throw new Error("Live streaming playback requires ScriptProcessorNode support.");
  }

  const blockSize = prepared.session.blockSize || DEFAULT_BLOCK_SIZE;
  const node = ctx.createScriptProcessor(blockSize, 0, 2);
  const gain = ctx.createGain();

  const playback = {
    token,
    fileName,
    pdxInfo: buildPdxInfo(prepared.pdxName, prepared.pdxResolved),
    maxSeconds,
    session: prepared.session,
    node,
    gain,
    lastUiSeconds: -1,
    finishQueued: false,
    pendingNowPlayingSeconds: null,
    uiScheduled: false,
  };

  node.onaudioprocess = (ev) => {
    const outL = ev.outputBuffer.getChannelData(0);
    const outR = ev.outputBuffer.getChannelData(1);

    if (state.playback !== playback || token !== state.renderToken) {
      outL.fill(0);
      outR.fill(0);
      return;
    }

    const p = playback.session.renderFloatBlock(outL, outR);

    if (p.finished || p.seconds - playback.lastUiSeconds >= 0.5) {
      playback.lastUiSeconds = p.seconds;
      playback.pendingNowPlayingSeconds = p.seconds;
      schedulePlaybackUi(playback);
    }

    if (p.finished && !playback.finishQueued) {
      playback.finishQueued = true;
      queueMicrotask(() => {
        if (state.playback !== playback) return;
        stopPlayback();
        if (p.truncated) {
          setStatus(`Stopped at max seconds (${formatSeconds(playback.maxSeconds)}).`);
        } else {
          setStatus(`Finished ${fileName}.`);
        }
      });
    }
  };

  state.playback = playback;
  state.playingName = fileName;
  updateNowPlaying(playback, 0);

  node.connect(gain);
  gain.connect(ctx.destination);
  setStatus(`Playing ${fileName}.`);
}

function renderTrackList() {
  els.tracks.innerHTML = "";

  if (!state.mdxFiles.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Drop MDX/PDX files to start.";
    els.tracks.append(li);
    return;
  }

  for (const file of state.mdxFiles) {
    const li = document.createElement("li");
    li.className = "track";

    const text = document.createElement("div");
    text.className = "track-text";

    const name = document.createElement("div");
    name.className = "track-name";
    name.textContent = file.name;
    text.append(name);

    const info = state.trackInfoByKey.get(fileKey(file));
    if (!info) {
      appendMetaLine(text, "track-meta track-meta-pending", "Reading MDX info...");
    } else if (info.error) {
      appendMetaLine(text, "track-meta track-meta-error", `MDX error: ${info.error}`);
      appendMetaLine(text, "track-meta", `Size: ${formatBytes(info.fileSize || file.size)}`);
    } else {
      const title = info.title || "(untitled)";
      const pdxInfo = !info.pdxName
        ? "No PDX"
        : (info.pdxResolved ? `PDX: ${info.pdxName}` : `PDX missing: ${info.pdxName}`);

      appendMetaLine(text, "track-title", `Title: ${title}`);
      appendMetaLine(
        text,
        "track-meta",
        `Tracks: ${info.numTracks} • Voices: ${info.numVoices} • PCM8: ${info.pcm8 ? "yes" : "no"} • Cmds: ${info.totalCommands}`
      );

      const playTimeText = info.playTimePending
        ? "Play time: calculating..."
        : info.playTimeError
        ? `Play time: n/a (${info.playTimeError})`
        : `Play time: ${formatSeconds(info.playTimeSeconds || 0)}${info.playTimeTruncated ? " (max)" : ""}`;

      appendMetaLine(
        text,
        "track-meta",
        `${pdxInfo} • Data: ${formatBytes(info.dataSize)} / ${formatBytes(info.fileSize)} • ${playTimeText}`
      );
    }

    const actions = document.createElement("div");
    actions.className = "track-actions";

    const playBtn = document.createElement("button");
    playBtn.textContent = "Play";
    playBtn.className = "play-btn";
    playBtn.addEventListener("click", () => {
      void playTrack(file);
    });

    actions.append(playBtn);
    li.append(text, actions);
    els.tracks.append(li);
  }
}

async function playTrack(file) {
  const token = ++state.renderToken;
  const loops = Number.parseInt(els.loops.value, 10);
  const maxSeconds = Number.parseInt(els.maxSeconds.value, 10);
  const maxLoopsOpt = Number.isFinite(loops) ? Math.max(0, loops | 0) : 2;
  const maxSecondsOpt = Number.isFinite(maxSeconds) && maxSeconds > 0 ? maxSeconds : 600;

  stopPlayback();
  setStatus(`Preparing ${file.name}...`);

  try {
    const ctx = await ensureAudioContext();
    if (token !== state.renderToken) return;

    const renderer = getRenderer(ctx.sampleRate);
    const prepared = await renderer.createStreamSessionFromUploadedFiles(file, state.fileIndex, {
      maxLoops: maxLoopsOpt,
      maxSeconds: maxSecondsOpt,
    });

    if (token !== state.renderToken) {
      prepared.session.dispose();
      return;
    }

    try {
      startStreamPlayback(ctx, token, file.name, prepared, maxSecondsOpt);
    } catch (streamErr) {
      prepared.session.dispose();
      throw streamErr;
    }
  } catch (err) {
    if (token !== state.renderToken) return;
    setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function replaceFiles(files) {
  state.renderToken += 1;
  state.files = files;
  state.fileIndex = makeFileIndex(files);
  state.mdxFiles = BrowserMdxRenderer.pickMdxFiles(files);
  stopPlayback();
  refreshTrackInfo();
  setStatus(`${state.files.length} file(s) loaded, ${state.mdxFiles.length} MDX track(s) found.`);
}

function refreshTrackInfo() {
  const options = getTrackInfoOptions();
  const token = ++state.trackInfoToken;
  state.trackInfoByKey = new Map();
  state.playTimeQueue = Promise.resolve();
  renderTrackList();
  void populateTrackInfo(token, options);
}

function addFiles(fileList) {
  const next = [...state.files];
  const known = new Set(next.map((f) => f.name.toLowerCase()));
  for (const f of fileList) {
    const key = f.name.toLowerCase();
    if (!known.has(key)) {
      known.add(key);
      next.push(f);
    }
  }
  replaceFiles(next);
}

els.browseBtn.addEventListener("click", () => {
  els.picker.click();
});

els.picker.addEventListener("change", (ev) => {
  const input = ev.target;
  if (!input.files) return;
  addFiles([...input.files]);
  input.value = "";
});

els.clearBtn.addEventListener("click", () => {
  replaceFiles([]);
  setStatus("Cleared loaded files.");
});

els.stopBtn.addEventListener("click", () => {
  state.renderToken += 1;
  stopPlayback();
  setStatus("Stopped.");
});

for (const el of [els.loops, els.maxSeconds]) {
  el.addEventListener("change", () => {
    refreshTrackInfo();
  });
}

for (const type of ["dragenter", "dragover"]) {
  els.drop.addEventListener(type, (ev) => {
    ev.preventDefault();
    els.drop.classList.add("dragging");
  });
}

for (const type of ["dragleave", "drop"]) {
  els.drop.addEventListener(type, (ev) => {
    ev.preventDefault();
    if (type === "dragleave" && ev.target !== els.drop) return;
    els.drop.classList.remove("dragging");
  });
}

els.drop.addEventListener("drop", (ev) => {
  ev.preventDefault();
  const files = [...(ev.dataTransfer?.files || [])];
  if (!files.length) return;
  addFiles(files);
});

replaceFiles([]);
setStatus("Drop one or more MDX/PDX files, then press Play.");
