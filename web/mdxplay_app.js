import { BrowserMdxRenderer } from "./mdx_player.js";
import { makeFileIndex, formatSeconds } from "./tools.js";

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
  audioContext: null,
  renderer: null,
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

function buildPdxInfo(pdxName, pdxResolved) {
  if (!pdxName) return "No PDX";
  return pdxResolved ? `PDX: ${pdxName}` : `PDX missing: ${pdxName}`;
}

function updateNowPlaying(playback, seconds) {
  const elapsed = formatSeconds(seconds);
  els.nowPlaying.textContent = `${playback.fileName} • ${elapsed} • ${playback.pdxInfo}`;
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
    if (playback.pendingStatus !== null) {
      setStatus(playback.pendingStatus);
      playback.pendingStatus = null;
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
    pendingStatus: null,
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
      if (!p.finished) {
        playback.pendingStatus = `Playing ${fileName}... ${formatSeconds(p.seconds)}`;
      }
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
  setStatus(`Playing ${fileName}...`);
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

    const name = document.createElement("div");
    name.className = "track-name";
    name.textContent = file.name;

    const actions = document.createElement("div");
    actions.className = "track-actions";

    const playBtn = document.createElement("button");
    playBtn.textContent = "Play";
    playBtn.className = "play-btn";
    playBtn.addEventListener("click", () => {
      void playTrack(file);
    });

    actions.append(playBtn);
    li.append(name, actions);
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
  renderTrackList();
  setStatus(`${state.files.length} file(s) loaded, ${state.mdxFiles.length} MDX track(s) found.`);
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
