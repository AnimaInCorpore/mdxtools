import { BrowserMdxRenderer } from "./mdx_player.js";
import { makeFileIndex, formatSeconds } from "./tools.js";

const renderer = new BrowserMdxRenderer(44100, 2048);

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
  source: null,
  playingName: null,
  renderToken: 0,
};

function setStatus(msg) {
  els.status.textContent = msg;
}

function stopPlayback() {
  if (state.source) {
    try { state.source.stop(); } catch {}
    state.source.disconnect();
    state.source = null;
  }
  state.playingName = null;
  els.nowPlaying.textContent = "Nothing playing";
}

async function ensureAudioContext() {
  if (!state.audioContext) {
    state.audioContext = new AudioContext({ sampleRate: 44100, latencyHint: "interactive" });
  }
  if (state.audioContext.state === "suspended") {
    await state.audioContext.resume();
  }
  return state.audioContext;
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

  setStatus(`Rendering ${file.name}...`);

  try {
    const rendered = await renderer.renderFromUploadedFiles(file, state.fileIndex, {
      maxLoops: Number.isFinite(loops) ? loops : 2,
      maxSeconds: Number.isFinite(maxSeconds) ? maxSeconds : 600,
      onProgress: (p) => {
        if (token !== state.renderToken) return;
        setStatus(`Rendering ${file.name}... ${formatSeconds(p.seconds)}`);
      },
    });

    if (token !== state.renderToken) return;

    const ctx = await ensureAudioContext();
    stopPlayback();

    const buffer = ctx.createBuffer(2, rendered.left.length, rendered.sampleRate);
    buffer.copyToChannel(rendered.left, 0);
    buffer.copyToChannel(rendered.right, 1);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      if (state.source === source) {
        state.source = null;
        state.playingName = null;
        els.nowPlaying.textContent = "Nothing playing";
      }
    };
    source.start();

    state.source = source;
    state.playingName = file.name;

    const pdxInfo = rendered.pdxName
      ? (rendered.pdxResolved ? `PDX: ${rendered.pdxName}` : `PDX missing: ${rendered.pdxName}`)
      : "No PDX";
    const truncInfo = rendered.truncated ? " (cut at max seconds)" : "";

    els.nowPlaying.textContent = `${file.name} • ${formatSeconds(rendered.durationSeconds)} • ${pdxInfo}${truncInfo}`;
    setStatus(`Ready. Playing ${file.name}.`);
  } catch (err) {
    if (token !== state.renderToken) return;
    setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function replaceFiles(files) {
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
